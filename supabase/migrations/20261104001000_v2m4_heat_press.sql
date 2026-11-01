-- V2-M4: Hot & Cold Hunt logic.
-- Provides heat_press RPC, updates start_game for 3x ping interval and charge init,
-- updates get_my_status and get_game_state for marks/charges, and turns on the feature flag.

-- 1. heat_press RPC -----------------------------------------------------------
create or replace function public.heat_press(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  my_pos public.player_positions%rowtype;
  team_res public.team_resources%rowtype;
  prev_press public.heat_presses%rowtype;
  last_press_at timestamptz;
  last_press_text text;

  chosen_variant text;
  max_charges integer;
  regen_s integer;
  cooldown_s integer;
  fuzz_pct double precision;
  base_r double precision;

  elapsed_s integer;
  new_charges integer;

  time_bucket bigint;
  seed_str text;
  hash_val integer;
  hash_norm double precision;
  fuzz_factor double precision;
  hunter_mult double precision := 1.0;

  runner record;
  dist double precision;
  dist_moved double precision;
  nearest_dist real := null;
  runner_noise_mult double precision;
  runner_effective_r double precision;
  is_hot boolean := false;
  sensed_runners uuid[] := array[]::uuid[];

  final_result text;
  refund_charge boolean := false;
  press_id bigint;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g where g.id = heat_press.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if not public.is_member(heat_press.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  perform public.advance_game(heat_press.game_id);

  select * into current_game from public.games g where g.id = heat_press.game_id for update;
  if current_game.status <> 'live' then
    raise exception 'HEAT can only be used while the round is live.';
  end if;
  if not ('hot_cold' = any(current_game.modifiers)) then
    raise exception 'Hot & Cold Hunt modifier is not enabled.';
  end if;

  select * into me from public.players p
  where p.game_id = current_game.id
    and p.user_id = caller_id
    and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;
  if me.status <> 'active' then raise exception 'Tagged players cannot use HEAT.'; end if;
  if me.team <> 'hunter' then raise exception 'Only hunters can use HEAT.'; end if;

  chosen_variant := coalesce(current_game.mode_params->'hot_cold'->>'variant', 'proximity');
  max_charges := coalesce((current_game.mode_params->'hot_cold'->>'heat_charges')::integer, 6);
  regen_s := coalesce((current_game.mode_params->'hot_cold'->>'regen_s')::integer, 30);
  cooldown_s := coalesce((current_game.mode_params->'hot_cold'->>'cooldown_s')::integer, 10);
  fuzz_pct := coalesce((current_game.mode_params->'hot_cold'->>'fuzz_pct')::double precision, 0.15);

  -- Personal cooldown check
  select pr.cooldowns->>'heat_press' into last_press_text
  from public.player_resources pr
  where pr.player_id = me.id;

  if last_press_text is not null then
    last_press_at := last_press_text::timestamptz;
    if now() < last_press_at + make_interval(secs => cooldown_s) then
      raise exception 'HEAT is on cooldown.';
    end if;
  end if;

  -- Hunter position freshness: must be under 20 s old
  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or my_pos.recorded_at < now() - interval '20 seconds' then
    return jsonb_build_object(
      'result', 'stale_position',
      'charges_left', (
        select tr.heat_charges from public.team_resources tr
        where tr.game_id = current_game.id and tr.team = 'hunter'
      ),
      'next_available_at', now()
    );
  end if;

  -- Team charge pool lock and lazy regeneration
  select * into team_res
  from public.team_resources tr
  where tr.game_id = current_game.id and tr.team = 'hunter'
  for update;

  if not found then
    insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
    values (current_game.id, 'hunter', max_charges, now())
    returning * into team_res;
  else
    elapsed_s := floor(extract(epoch from (now() - team_res.heat_updated_at)))::integer;
    if elapsed_s >= regen_s then
      new_charges := least(max_charges, team_res.heat_charges + (elapsed_s / regen_s));
      if new_charges = max_charges then
        team_res.heat_updated_at := now();
      else
        team_res.heat_updated_at := team_res.heat_updated_at + make_interval(secs => (elapsed_s / regen_s) * regen_s);
      end if;
      team_res.heat_charges := new_charges;
    end if;
  end if;

  if team_res.heat_charges <= 0 then
    raise exception 'No heat charges available.';
  end if;

  -- Heat radius R: default clamp(area radius x 0.25, 80 m, 250 m)
  base_r := coalesce(
    (current_game.mode_params->'hot_cold'->>'radius_m')::double precision,
    greatest(80.0, least(250.0, current_game.area_radius_m * 0.25))
  );

  -- Seeded fuzz: deterministically bound to (game, hunter, 60 s time bucket)
  time_bucket := floor(extract(epoch from now()) / 60.0)::bigint;
  seed_str := current_game.id::text || ':' || me.id::text || ':' || time_bucket::text;
  hash_val := abs(('x' || substr(md5(seed_str), 1, 8))::bit(32)::integer);
  hash_norm := (hash_val % 1000000) / 1000000.0;
  fuzz_factor := (1.0 - fuzz_pct) + (hash_norm * 2.0 * fuzz_pct);

  -- Counter-play / boost synergies
  if coalesce(me.status_detail ? 'thermal_boost', false) then
    hunter_mult := 1.7;
    update public.players p set status_detail = p.status_detail - 'thermal_boost' where p.id = me.id;
  end if;

  -- Evaluate active runners whose fixes are under 45 s old
  for runner in
    select p.id, p.status_detail, pp.geog, pp.noise, pp.recorded_at
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active'
      and pp.recorded_at >= now() - interval '45 seconds'
  loop
    dist := extensions.st_distance(my_pos.geog, runner.geog);
    if nearest_dist is null or dist < nearest_dist then
      nearest_dist := dist;
    end if;

    runner_noise_mult := case when coalesce(runner.noise, 0) >= 60 then 1.3 else 1.0 end;
    runner_effective_r := base_r * fuzz_factor * runner_noise_mult * hunter_mult;

    if dist <= runner_effective_r then
      if coalesce(runner.status_detail ? 'frost', false) then
        update public.players p set status_detail = p.status_detail - 'frost' where p.id = runner.id;
      else
        is_hot := true;
      end if;
    end if;

    if dist <= base_r * hunter_mult then
      sensed_runners := array_append(sensed_runners, runner.id);
    end if;
  end loop;

  if chosen_variant = 'proximity' then
    final_result := case when is_hot then 'hot' else 'cold' end;
  else
    -- Variant B: Trend
    select * into prev_press
    from public.heat_presses hp
    where hp.game_id = current_game.id
      and hp.hunter_id = me.id
    order by hp.pressed_at desc
    limit 1;

    if prev_press.id is null then
      refund_charge := true;
      final_result := 'no_change';
    else
      dist_moved := extensions.st_distance(my_pos.geog, prev_press.hunter_geog);
      if dist_moved < 40.0 then
        refund_charge := true;
        final_result := 'no_change';
      elsif nearest_dist is null or prev_press.nearest_runner_m is null then
        final_result := 'no_change';
      elsif nearest_dist <= prev_press.nearest_runner_m - 15.0 then
        final_result := 'hot';
      elsif nearest_dist >= prev_press.nearest_runner_m + 15.0 then
        final_result := 'cold';
      else
        final_result := 'no_change';
      end if;
    end if;
  end if;

  if refund_charge then
    update public.team_resources
    set heat_charges = team_res.heat_charges,
        heat_updated_at = team_res.heat_updated_at
    where team_resources.game_id = current_game.id and team_resources.team = 'hunter';

    return jsonb_build_object(
      'result', 'no_change',
      'charges_left', team_res.heat_charges,
      'next_available_at', now() + make_interval(secs => cooldown_s)
    );
  end if;

  -- Spend 1 charge
  team_res.heat_charges := team_res.heat_charges - 1;
  update public.team_resources
  set heat_charges = team_res.heat_charges,
      heat_updated_at = team_res.heat_updated_at
  where team_resources.game_id = current_game.id and team_resources.team = 'hunter';

  -- Update personal cooldown
  update public.player_resources
  set cooldowns = coalesce(cooldowns, '{}'::jsonb) || jsonb_build_object('heat_press', now())
  where player_id = me.id;

  -- Record press in audit table
  insert into public.heat_presses (
    game_id, hunter_id, variant, result, hunter_geog, nearest_runner_m, pressed_at
  ) values (
    current_game.id, me.id, chosen_variant, final_result, my_pos.geog, nearest_dist, now()
  ) returning id into press_id;

  -- Events
  -- 1. heat_used (all players, no result)
  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id, 'heat_used', 'all',
    jsonb_build_object('hunter_id', me.id)
  );

  -- 2. heat_mark (hunter team, result and spot)
  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id, 'heat_mark', 'hunter',
    jsonb_build_object(
      'id', press_id,
      'hunter_id', me.id,
      'result', final_result,
      'latitude', extensions.st_y(my_pos.geog::extensions.geometry),
      'longitude', extensions.st_x(my_pos.geog::extensions.geometry),
      'pressed_at', now()
    )
  );

  -- 3. sensed pulse for runners within R (target_player only)
  if array_length(sensed_runners, 1) > 0 then
    insert into public.events (game_id, type, audience, payload, target_player)
    select current_game.id, 'sensed', 'runner', '{}'::jsonb, unnest(sensed_runners);
  end if;

  return jsonb_build_object(
    'result', final_result,
    'charges_left', team_res.heat_charges,
    'next_available_at', now() + make_interval(secs => cooldown_s)
  );
end;
$$;

revoke all on function public.heat_press(uuid) from public, anon;
grant execute on function public.heat_press(uuid) to authenticated;

-- 2. start_game updated: 3x ping interval when Hot & Cold is enabled ----------
create or replace function public.start_game(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  countdown_ends timestamptz;
  live_starts timestamptz;
  active_runners integer;
  active_hunters integer;
  unassigned integer;
  missing_consent integer;
  hunter_heat_charges integer := 6;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g
    where g.id = start_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.host_id <> caller_id then
    raise exception 'Only the host can start the round.';
  end if;
  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'This game has already started.';
  end if;
  if current_game.mode = 'classic_chase' and current_game.status <> 'target_selection' then
    raise exception 'Choose the secret target before starting the round.';
  end if;
  if current_game.mode = 'tag_hunt' and current_game.status <> 'lobby' then
    raise exception 'This game is no longer in the lobby.';
  end if;

  perform public.assert_mode_config(
    current_game.mode_id, current_game.roles, current_game.modifiers
  );

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'unassigned')
    into active_runners, active_hunters, unassigned
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active';

  if active_runners = 0 or active_hunters = 0 then
    raise exception 'Assign at least one runner and one hunter before starting.';
  end if;
  if unassigned > 0 then
    raise exception 'Every player must choose a team before the round starts.';
  end if;
  if current_game.mode = 'classic_chase'
     and not exists (select 1 from public.targets t where t.game_id = start_game.game_id) then
    raise exception 'Runners must save the secret target first.';
  end if;

  select count(*) into missing_consent
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active' and p.share_trail is null;
  if missing_consent > 0 then
    raise exception 'Every player must choose whether to share their route before the round starts.';
  end if;

  countdown_ends := now() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);

  if 'hot_cold' = any(current_game.modifiers) then
    hunter_heat_charges := coalesce((current_game.mode_params->'hot_cold'->>'heat_charges')::integer, 6);
  end if;

  update public.games g set
    status = 'countdown',
    head_start_at = countdown_ends,
    live_at = live_starts,
    ends_at = live_starts + make_interval(secs => current_game.duration_s),
    next_ping_at = live_starts,
    ping_seq = 0,
    ping_interval_s = case
      when 'hot_cold' = any(g.modifiers) then least(900, g.ping_interval_s * 3)
      else g.ping_interval_s
    end,
    winner = null,
    end_reason = null,
    ended_at = null
  where g.id = start_game.game_id
  returning * into current_game;

  insert into public.player_resources (player_id, game_id)
  select p.id, p.game_id
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, now()),
    (current_game.id, 'hunter', hunter_heat_charges, now())
  on conflict on constraint team_resources_pkey do update
    set heat_charges = excluded.heat_charges,
        heat_updated_at = excluded.heat_updated_at;

  insert into public.events (game_id, type, payload) values (
    start_game.game_id,
    'game_started',
    jsonb_build_object(
      'mode', current_game.mode,
      'mode_id', current_game.mode_id,
      'modifiers', to_jsonb(current_game.modifiers),
      'roles', to_jsonb(current_game.roles),
      'head_start_at', current_game.head_start_at,
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at
    )
  );

  return jsonb_build_object(
    'status', current_game.status,
    'head_start_at', current_game.head_start_at,
    'live_at', current_game.live_at,
    'next_ping_at', current_game.next_ping_at,
    'ends_at', current_game.ends_at
  );
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- 3. get_my_status updated: include hot_cold modifier data --------------------
create or replace function public.get_my_status(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  current_game public.games%rowtype;
  my_noise integer := 0;
  my_smoothed real;
  charges jsonb := '{}'::jsonb;
  cooldowns jsonb := '{}'::jsonb;
  hunter_charges integer := null;
  max_charges integer := 6;
  regen_s integer := 30;
  elapsed_s integer;
  tr public.team_resources%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g where g.id = get_my_status.game_id;
  if not found then raise exception 'Game not found.'; end if;
  select * into me from public.players p
    where p.game_id = get_my_status.game_id
      and p.user_id = caller_id
      and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;

  select pp.noise, pp.smoothed_speed_mps into my_noise, my_smoothed
    from public.player_positions pp where pp.player_id = me.id;
  select pr.charges, pr.cooldowns into charges, cooldowns
    from public.player_resources pr where pr.player_id = me.id;

  if me.team = 'hunter' and 'hot_cold' = any(current_game.modifiers) then
    select * into tr from public.team_resources
    where team_resources.game_id = current_game.id and team_resources.team = 'hunter';
    if found then
      max_charges := coalesce((current_game.mode_params->'hot_cold'->>'heat_charges')::integer, 6);
      regen_s := coalesce((current_game.mode_params->'hot_cold'->>'regen_s')::integer, 30);
      elapsed_s := floor(extract(epoch from (now() - tr.heat_updated_at)))::integer;
      hunter_charges := least(max_charges, tr.heat_charges + (elapsed_s / regen_s));
    end if;
  end if;

  return jsonb_build_object(
    'player_id', me.id,
    'team', me.team,
    'status', me.status,
    'noise', coalesce(my_noise, 0),
    'smoothed_speed_mps', my_smoothed,
    'charges', coalesce(charges, '{}'::jsonb),
    'cooldowns', coalesce(cooldowns, '{}'::jsonb),
    'effects', jsonb_build_object(
      'veil', coalesce(me.status_detail ? 'veil', false),
      'decoy', coalesce(me.status_detail ? 'decoy', false)
    ),
    'noise_enabled', 'noise_meter' = any(current_game.modifiers),
    'drops_enabled', 'dead_drops' = any(current_game.modifiers),
    'hot_cold_enabled', 'hot_cold' = any(current_game.modifiers),
    'heat_charges', hunter_charges
  );
end;
$$;

revoke all on function public.get_my_status(uuid) from public, anon;
grant execute on function public.get_my_status(uuid) to authenticated;

-- 4. get_game_state updated: include heat_marks and heat_charges --------------
create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  snapshot jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select jsonb_build_object(
    'server_time', now(),
    'game', to_jsonb(g) || jsonb_build_object(
      'area', jsonb_build_object(
        'longitude', extensions.st_x(g.area_center::extensions.geometry),
        'latitude', extensions.st_y(g.area_center::extensions.geometry),
        'radius_m', public.effective_radius_m(g.id),
        'base_radius_m', g.area_radius_m,
        'zone_stage', g.zone_stage,
        'zone_stage_count', array_length(public.zone_stage_values(g.id), 1),
        'shrinking', 'shrinking_zone' = any(g.modifiers)
      ),
      'target_set', exists (select 1 from public.targets t where t.game_id = g.id)
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'user_id', p.user_id, 'display_name', pr.display_name, 'color', pr.color,
        'team', p.team, 'status', p.status, 'is_ready', p.is_ready, 'joined_at', p.joined_at
      ) order by p.joined_at)
      from public.players p join public.profiles pr on pr.id = p.user_id
      where p.game_id = g.id and p.status <> 'left'
    ), '[]'::jsonb),
    'my_player_id', mine.id,
    'my_team', mine.team,
    'my_position', (
      select jsonb_build_object(
        'player_id', pp.player_id,
        'longitude', extensions.st_x(pp.geog::extensions.geometry),
        'latitude', extensions.st_y(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'recorded_at', pp.recorded_at,
        'is_mock', pp.is_mock
      )
      from public.player_positions pp
      where pp.player_id = mine.id
    ),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', pp.player_id,
        'display_name', pr.display_name,
        'color', pr.color,
        'team', p.team,
        'longitude', extensions.st_x(pp.geog::extensions.geometry),
        'latitude', extensions.st_y(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'recorded_at', pp.recorded_at,
        'is_mock', pp.is_mock
      ) order by p.joined_at)
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      join public.profiles pr on pr.id = p.user_id
      where pp.game_id = g.id
        and p.status <> 'left'
        and (g.status = 'ended' or p.id = mine.id or p.team = mine.team)
    ), '[]'::jsonb),
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ping.id,
        'seq', ping.seq,
        'player_id', ping.player_id,
        'longitude', extensions.st_x(ping.geog::extensions.geometry),
        'latitude', extensions.st_y(ping.geog::extensions.geometry),
        'accuracy_m', ping.accuracy_m,
        'position_age_s', ping.position_age_s,
        'reason', ping.reason,
        'released_at', ping.released_at
      ) order by ping.released_at desc, ping.id desc)
      from (
        select * from public.pings
        where pings.game_id = g.id
          and (g.status = 'ended' or pings.released_at >= now() - interval '10 seconds')
        order by released_at desc, id desc limit 100
      ) ping
    ), '[]'::jsonb),
    'target', case when mine.team = 'runner' or g.status = 'ended' then (
      select jsonb_build_object(
        'longitude', extensions.st_x(t.geog::extensions.geometry),
        'latitude', extensions.st_y(t.geog::extensions.geometry)
      )
      from public.targets t where t.game_id = g.id
    ) else null end,
    'heat_marks', case when mine.team = 'hunter' or g.status = 'ended' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', hpf.id,
        'hunter_id', hpf.hunter_id,
        'result', hpf.result,
        'longitude', extensions.st_x(hpf.hunter_geog::extensions.geometry),
        'latitude', extensions.st_y(hpf.hunter_geog::extensions.geometry),
        'pressed_at', hpf.pressed_at
      ) order by hpf.pressed_at asc)
      from public.heat_press_feed hpf
      where hpf.game_id = g.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'heat_charges', case when mine.team = 'hunter' then (
      select tr.heat_charges from public.team_resources tr
      where tr.game_id = g.id and tr.team = 'hunter'
    ) else null end,
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.id)
      from (
        select * from public.events
        where events.game_id = g.id
          and (
            (target_player is null and (audience = 'all' or audience = mine.team::text))
            or target_player = mine.id
          )
        order by id desc limit 50
      ) e
    ), '[]'::jsonb)
  ) into snapshot
  from public.games g
  join public.players mine on mine.game_id = g.id and mine.user_id = caller_id and mine.status <> 'left'
  where g.id = get_game_state.game_id;

  if snapshot is null then raise exception 'Game could not be loaded.'; end if;
  return snapshot;
end;
$$;

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;

-- 5. Turn on the Hot & Cold Hunt feature flag ---------------------------------
insert into public.app_settings (key, value) values
  ('feature.modifier.hot_cold', 'true'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
