-- V2-M4: fix ambiguous game_id in heat_press team_resources updates.

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
    update public.team_resources tr
    set heat_charges = team_res.heat_charges,
        heat_updated_at = team_res.heat_updated_at
    where tr.game_id = current_game.id and tr.team = 'hunter';

    return jsonb_build_object(
      'result', 'no_change',
      'charges_left', team_res.heat_charges,
      'next_available_at', now() + make_interval(secs => cooldown_s)
    );
  end if;

  -- Spend 1 charge
  team_res.heat_charges := team_res.heat_charges - 1;
  update public.team_resources tr
  set heat_charges = team_res.heat_charges,
      heat_updated_at = team_res.heat_updated_at
  where tr.game_id = current_game.id and tr.team = 'hunter';

  -- Update personal cooldown
  update public.player_resources pr
  set cooldowns = coalesce(pr.cooldowns, '{}'::jsonb) || jsonb_build_object('heat_press', now())
  where pr.player_id = me.id;

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
