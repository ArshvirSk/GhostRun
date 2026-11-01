-- Milestone S1: Security, Fairness & Timing
-- Implements D1-D8 requirements:
--   D1: Binary red/blue Heat confirmed (verified charge pool, personal cooldown, fuzz, repeat-press, heat_press_feed)
--   D2: Hot & Cold modifier enabled on Classic, Tag Hunt, Jailbreak, Relay Heist
--   D3: Ghost mode 'haunt' (default) and 'assist' (40m sighting pings + 12m haunt tag with 3s dwell and <=30m accuracy gating)
--   D4: Scramble charges and cooldown supported via host settings
--   D5: Server-side ping_visible_s (default 10) RLS and get_game_state enforcement
--   D6: Game clock advance_active_games(10) on 30s schedule + hardened bounded idempotent health_ping() keepalive/fallback
--   Safety Guards: Mock-location detection event + universal vehicle warning in submit_position

-- 1. Schema Extensions --------------------------------------------------------

alter table public.games
  add column if not exists ping_visible_s integer not null default 10,
  add column if not exists ghost_mode text not null default 'haunt' check (ghost_mode in ('haunt', 'assist'));

-- Add 'ghost_sighting' to allowed ping reasons
do $$
declare
  existing record;
begin
  for existing in
    select conname
    from pg_constraint
    where conrelid = 'public.pings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reason%'
  loop
    execute format('alter table public.pings drop constraint %I', existing.conname);
  end loop;
end;
$$;

alter table public.pings add constraint pings_reason_check
  check (reason in ('scheduled', 'boundary', 'noise', 'camping', 'item', 'ghost_sighting'));

-- 2. Ping Visibility Helper & RLS --------------------------------------------

create or replace function public.ping_is_visible(p_game_id uuid, p_released_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game_id
      and (
        g.status in ('ended', 'cancelled')
        or p_released_at >= now() - make_interval(secs => coalesce(g.ping_visible_s, 10))
      )
  );
$$;

drop policy if exists pings_member_read on public.pings;
create policy pings_member_read on public.pings for select to authenticated
  using (
    public.is_member(game_id)
    and public.ping_is_visible(game_id, released_at)
  );

-- 3. Update get_game_state to enforce ping_visible_s -------------------------

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
      'target_set', exists (select 1 from public.targets t where t.game_id = g.id),
      'ping_visible_s', g.ping_visible_s,
      'ghost_mode', g.ghost_mode
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'display_name', pr.display_name,
        'color', pr.color,
        'team', p.team,
        'status', p.status,
        'is_ready', p.is_ready,
        'joined_at', p.joined_at,
        'secret_role', case
          when g.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          else null
        end
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
        and (g.status in ('ended', 'cancelled') or p.id = mine.id or p.team = mine.team)
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
          and (
            g.status in ('ended', 'cancelled')
            or pings.released_at >= now() - make_interval(secs => coalesce(g.ping_visible_s, 10))
          )
        order by released_at desc, id desc limit 100
      ) ping
    ), '[]'::jsonb),
    'target', case when mine.team = 'runner' or g.status in ('ended', 'cancelled') then (
      select jsonb_build_object(
        'longitude', extensions.st_x(t.geog::extensions.geometry),
        'latitude', extensions.st_y(t.geog::extensions.geometry)
      )
      from public.targets t where t.game_id = g.id
    ) else null end,
    'heat_marks', case when mine.team = 'hunter' or g.status in ('ended', 'cancelled') then coalesce((
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

-- 4. Update create_game to accept ping_visible_s & ghost_mode ----------------

create or replace function public.create_game(
  mode public.game_mode,
  lat double precision,
  lng double precision,
  radius_m integer default 600,
  settings jsonb default '{}'::jsonb
)
returns table (game_id uuid, code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  new_id uuid;
  new_code text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  attempt integer := 0;
  chosen_mode public.game_mode := create_game.mode;
  chosen_settings jsonb := coalesce(create_game.settings, '{}'::jsonb);
  chosen_roles text[] := '{}';
  chosen_modifiers text[] := '{}';
  chosen_params jsonb := coalesce(create_game.settings->'mode_params', '{}'::jsonb);
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not exists (select 1 from public.profiles where id = caller_id) then
    raise exception 'Create a profile before creating a game.';
  end if;
  if chosen_mode is null then raise exception 'Choose a game mode.'; end if;
  if create_game.lat not between -90 and 90 or create_game.lng not between -180 and 180 then
    raise exception 'Map centre coordinates are invalid.';
  end if;
  if create_game.radius_m not between 100 and 5000 then
    raise exception 'Area radius must be 100-5000 metres.';
  end if;
  if jsonb_typeof(chosen_params) <> 'object' then
    raise exception 'Mode parameters must be an object.';
  end if;

  if jsonb_typeof(chosen_settings->'roles') = 'array' then
    select coalesce(array_agg(value), '{}') into chosen_roles
    from jsonb_array_elements_text(chosen_settings->'roles') value;
  end if;
  if jsonb_typeof(chosen_settings->'modifiers') = 'array' then
    select coalesce(array_agg(value), '{}') into chosen_modifiers
    from jsonb_array_elements_text(chosen_settings->'modifiers') value;
  end if;

  perform public.assert_mode_config(chosen_mode::text, chosen_roles, chosen_modifiers);

  loop
    attempt := attempt + 1;
    new_code := '';
    for i in 1..4 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (
      select 1 from public.games g
      where g.code = new_code and g.status not in ('ended', 'cancelled')
    );
    if attempt >= 20 then raise exception 'Could not allocate a game code. Try again.'; end if;
  end loop;

  insert into public.games (
    code, host_id, mode, mode_id, roles, modifiers, mode_params,
    area_center, area_radius_m,
    head_start_s, duration_s, ping_interval_s, tag_radius_m, target_radius_m,
    boundary_grace_s, boundary_penalty, ping_visible_s, ghost_mode
  ) values (
    new_code, caller_id, chosen_mode, chosen_mode::text, chosen_roles, chosen_modifiers,
    chosen_params,
    extensions.st_setsrid(extensions.st_makepoint(create_game.lng, create_game.lat), 4326)::extensions.geography,
    create_game.radius_m,
    coalesce((chosen_settings->>'head_start_s')::integer, 180),
    coalesce((chosen_settings->>'duration_s')::integer, 2700),
    coalesce((chosen_settings->>'ping_interval_s')::integer, 150),
    coalesce((chosen_settings->>'tag_radius_m')::integer, 20),
    coalesce((chosen_settings->>'target_radius_m')::integer, 25),
    coalesce((chosen_settings->>'boundary_grace_s')::integer, 30),
    coalesce(chosen_settings->>'boundary_penalty', 'warn'),
    coalesce((chosen_settings->>'ping_visible_s')::integer, 10),
    coalesce(chosen_settings->>'ghost_mode', 'haunt')
  ) returning id into new_id;

  insert into public.players (game_id, user_id) values (new_id, caller_id);
  insert into public.events (game_id, type, payload)
    values (new_id, 'player_joined', jsonb_build_object('user_id', caller_id));
  return query select new_id, new_code;
exception
  when check_violation or invalid_text_representation then
    raise exception 'Game settings are invalid. Check the allowed ranges and try again.';
end;
$$;

-- 5. Start Game: support Scramble charges/cooldown host settings (D4) --------

create or replace function public.start_game(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  active_runners integer;
  active_hunters integer;
  unassigned integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  hunter_heat_charges integer := 0;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
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
  if current_game.mode_id = 'classic_chase' and current_game.status <> 'target_selection' then
    raise exception 'Choose the secret target before starting the round.';
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

  if current_game.mode_id not in ('haunted_map', 'ghost_duel') then
    if active_runners = 0 or active_hunters = 0 then
      raise exception 'Assign at least one runner and one hunter before starting.';
    end if;
  else
    if active_runners = 0 and active_hunters = 0 then
      raise exception 'Assign at least one player before starting.';
    end if;
  end if;

  if unassigned > 0 then
    raise exception 'Every player must choose a team before the round starts.';
  end if;
  if current_game.mode_id = 'classic_chase'
     and not exists (select 1 from public.targets t where t.game_id = start_game.game_id) then
    raise exception 'Runners must save the secret target first.';
  end if;

  select count(*) into missing_consent
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active' and p.share_trail is null;
  if missing_consent > 0 then
    raise exception 'Every player must choose whether to share their route before the round starts.';
  end if;

  if 'double_agent' = any(current_game.roles) then
    if active_hunters >= 2 then
      select p.id into chosen_agent_id
      from public.players p
      where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active'
      order by random()
      limit 1;

      agent_charges := coalesce((current_game.mode_params->'double_agent'->>'scramble_charges')::int, 1);
      agent_cooldown := coalesce((current_game.mode_params->'double_agent'->>'scramble_cooldown_s')::int, 120);

      update public.players
      set secret_role = 'agent',
          status_detail = jsonb_build_object(
            'scramble_available', true,
            'scramble_charges', agent_charges,
            'scramble_cooldown_s', agent_cooldown,
            'whisper_available', true
          )
      where id = chosen_agent_id;

      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id,
        'agent_assigned',
        chosen_agent_id,
        'player',
        jsonb_build_object('message', 'You are secretly working as the Double Agent.')
      );
    else
      current_game.roles := array_remove(current_game.roles, 'double_agent');
      update public.games set roles = current_game.roles where id = current_game.id;
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'role_disabled',
        'all',
        jsonb_build_object(
          'role', 'double_agent',
          'reason', 'Requires at least 2 active hunters to maintain mystery.'
        )
      );
    end if;
  end if;

  countdown_ends := clock_timestamp() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);

  update public.games
    set status = 'countdown',
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = live_starts + make_interval(secs => current_game.duration_s),
        next_ping_at = live_starts + make_interval(secs => current_game.ping_interval_s),
        ping_seq = 0
    where id = current_game.id;

  if 'hot_cold' = any(current_game.modifiers) then
    hunter_heat_charges := coalesce((current_game.mode_params->'hot_cold'->>'heat_charges')::integer, 6);
    insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
    values (current_game.id, 'hunter', hunter_heat_charges, now())
    on conflict (game_id, team) do update
      set heat_charges = excluded.heat_charges,
          heat_updated_at = excluded.heat_updated_at;
  end if;

  insert into public.events (game_id, type) values (current_game.id, 'game_started');

  return jsonb_build_object(
    'status', 'countdown',
    'countdown_ends', countdown_ends,
    'live_starts', live_starts
  );
end;
$$;

-- 6. agent_scramble RPC: respect charges & personal cooldown (D4) ------------

create or replace function public.agent_scramble(
  game_id uuid,
  runner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  target_runner public.players%rowtype;
  current_game public.games%rowtype;
  v_charges integer;
  v_cooldown_s integer;
  v_last_used timestamptz;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = agent_scramble.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then raise exception 'Round must be live.'; end if;

  select * into me from public.players p
  where p.game_id = current_game.id and p.user_id = caller_id and p.status <> 'left';
  if not found or me.status <> 'active' then raise exception 'Active player required.'; end if;
  if me.secret_role is distinct from 'agent' then
    raise exception 'Only the Double Agent can scramble pings.';
  end if;

  v_charges := coalesce((me.status_detail->>'scramble_charges')::int, case when (me.status_detail->>'scramble_available')::boolean then 1 else 0 end);
  v_cooldown_s := coalesce((me.status_detail->>'scramble_cooldown_s')::int, 120);
  v_last_used := (me.status_detail->>'last_scramble_at')::timestamptz;

  if v_charges <= 0 or coalesce((me.status_detail->>'scramble_available')::boolean, false) is not true then
    raise exception 'Scramble has already been used.';
  end if;

  if v_last_used is not null and now() < v_last_used + make_interval(secs => v_cooldown_s) then
    raise exception 'Scramble is on cooldown.';
  end if;

  select * into target_runner from public.players p
  where p.id = agent_scramble.runner_id
    and p.game_id = current_game.id
    and p.team = 'runner'
    and p.status = 'active';
  if not found then raise exception 'Target must be an active runner in this game.'; end if;

  v_charges := v_charges - 1;

  -- Consume charge / update cooldown
  update public.players
  set status_detail = jsonb_set(
    jsonb_set(
      jsonb_set(status_detail, '{scramble_charges}', to_jsonb(v_charges)),
      '{scramble_available}', to_jsonb(v_charges > 0)
    ),
    '{last_scramble_at}', to_jsonb(now())
  )
  where id = me.id;

  -- Arm scramble on runner
  update public.players
  set status_detail = jsonb_set(status_detail, '{scramble}', 'true'::jsonb)
  where id = target_runner.id;

  insert into public.events (game_id, type, audience, target_player, payload) values (
    current_game.id,
    'scramble_armed',
    'hunter',
    me.id,
    jsonb_build_object(
      'runner_id', target_runner.id,
      'charges_left', v_charges,
      'cooldown_s', v_cooldown_s
    )
  );

  return jsonb_build_object('success', true, 'runner_id', target_runner.id, 'charges_left', v_charges);
end;
$$;

-- 7. Submit Position: Safety Guards (Mock Location + Universal Speed Check) ---

create or replace function public.submit_position(
  game_id uuid,
  lat double precision,
  lng double precision,
  accuracy double precision default null,
  speed double precision default null,
  heading double precision default null,
  is_mock boolean default false,
  recorded_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  fix_time timestamptz;
  fix_geog extensions.geography;
  v_radius double precision;
  v_in_bounds boolean;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_prev_out timestamptz;
  v_out_since timestamptz;
  v_penalty_seq integer;
  v_noise_on boolean;
  v_dt double precision;
  v_prev_smoothed real;
  v_prev_noise integer;
  v_prev_alerted boolean;
  v_prev_anchor extensions.geography;
  v_prev_anchor_since timestamptz;
  v_prev_updated timestamptz;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
  v_smoothed real;
  v_noise integer;
  v_alerted boolean;
  v_anchor extensions.geography;
  v_anchor_since timestamptz;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_noise_seq integer;
  v_camp_seq integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if submit_position.game_id is null then raise exception 'Game not found.'; end if;

  perform public.advance_game(submit_position.game_id);

  select * into current_game from public.games g
    where g.id = submit_position.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p
    where p.game_id = submit_position.game_id
      and p.user_id = caller_id
      and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;

  if current_game.status in ('ended', 'cancelled') or me.status <> 'active' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', now(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner
    );
  end if;

  if current_game.status = 'countdown' then
    return jsonb_build_object(
      'phase', current_game.status,
      'server_time', now(),
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at,
      'next_ping_at', current_game.next_ping_at,
      'in_bounds', null,
      'my_status', me.status,
      'winner', current_game.winner
    );
  end if;

  if current_game.status not in ('head_start', 'live') then
    raise exception 'The round is not accepting positions.';
  end if;
  if submit_position.lat is null
     or submit_position.lng is null
     or submit_position.lat not between -90 and 90
     or submit_position.lng not between -180 and 180 then
    raise exception 'Position coordinates are invalid.';
  end if;

  v_accuracy := case
    when submit_position.accuracy is null or submit_position.accuracy < 0 then null
    else least(submit_position.accuracy, 100000)::real
  end;
  v_speed := case
    when submit_position.speed is null or submit_position.speed < 0 then null
    else least(submit_position.speed, 200)::real
  end;
  v_heading := case
    when submit_position.heading is null then null
    else least(greatest(submit_position.heading, 0), 360)::real
  end;

  fix_time := coalesce(submit_position.recorded_at, now());
  if fix_time > now() + interval '5 seconds' or fix_time < now() - interval '2 minutes' then
    fix_time := now();
  end if;

  fix_geog := extensions.st_setsrid(
    extensions.st_makepoint(submit_position.lng, submit_position.lat),
    4326
  )::extensions.geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_distance(fix_geog, current_game.area_center) <= v_radius;

  select out_of_bounds_since, noise, noise_alerted,
         smoothed_speed_mps, anchor_geog, anchor_since, updated_at,
         fast_since, vehicle_warned
    into v_prev_out, v_prev_noise, v_prev_alerted,
         v_prev_smoothed, v_prev_anchor, v_prev_anchor_since, v_prev_updated,
         v_prev_fast_since, v_prev_vehicle_warned
    from public.player_positions
    where player_id = me.id;

  if v_in_bounds then
    v_out_since := null;
  else
    v_out_since := coalesce(v_prev_out, fix_time);
  end if;

  v_dt := case
    when v_prev_updated is null then 1.0
    else greatest(0.5, least(10.0, extract(epoch from (now() - v_prev_updated))))
  end;

  -- Universal Speed Smoothing & Vehicle Safety Warning (Safety Guard)
  if v_speed is null then
    v_smoothed := coalesce(v_prev_smoothed, 0.0);
  elsif v_prev_smoothed is null then
    v_smoothed := v_speed;
  else
    v_smoothed := 0.75 * v_prev_smoothed + 0.25 * v_speed;
  end if;

  if v_smoothed >= 8.0 then
    v_fast_since := coalesce(v_prev_fast_since, fix_time);
    v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);
    if not v_vehicle_warned and v_fast_since is not null and now() - v_fast_since >= interval '10 seconds' then
      insert into public.events (game_id, type, audience, payload, target_player)
      values (
        current_game.id, 'vehicle_warning', 'all',
        jsonb_build_object(
          'player_id', me.id,
          'speed_mps', round(v_smoothed::numeric, 1),
          'message', 'Vehicle speed detected (>8 m/s for 10 s)'
        ),
        me.id
      );
      v_vehicle_warned := true;
    end if;
  else
    v_fast_since := null;
    v_vehicle_warned := false;
  end if;

  -- Noise modifier logic
  v_noise_on := 'noise' = any(current_game.modifiers);
  if v_noise_on then
    if v_smoothed >= 8 then
      v_noise := round(coalesce(v_prev_noise, 0) + 8 * v_dt)::integer;
    else
      v_noise := case
        when v_smoothed >= 4 then round(coalesce(v_prev_noise, 0) + 5 * v_dt)
        when v_smoothed >= 2.8 then round(coalesce(v_prev_noise, 0) + 2 * v_dt)
        when v_smoothed >= 1.6 then round(coalesce(v_prev_noise, 0) - 1.0 * v_dt)
        else round(coalesce(v_prev_noise, 0) - 2.5 * v_dt)
      end::integer;
    end if;
    v_noise := least(100, greatest(0, v_noise));

    if v_prev_anchor is null
       or extensions.st_distance(fix_geog, v_prev_anchor) > 15 then
      v_anchor := fix_geog;
      v_anchor_since := fix_time;
    else
      v_anchor := v_prev_anchor;
      v_anchor_since := coalesce(v_prev_anchor_since, fix_time);
      if now() - v_anchor_since >= interval '240 seconds' then
        update public.games g
          set ping_seq = g.ping_seq + 1
          where g.id = current_game.id
          returning g.ping_seq into v_camp_seq;

        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason
        ) values (
          current_game.id, v_camp_seq, me.id, fix_geog, v_accuracy,
          greatest(0, floor(extract(epoch from (now() - fix_time)))::integer),
          'camping'
        );

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'camping_ping', 'all',
          jsonb_build_object('player_id', me.id, 'seq', v_camp_seq)
        );

        v_anchor_since := now();
      end if;
    end if;

    v_alerted := case when v_noise < 50 then false else coalesce(v_prev_alerted, false) end;

    if v_noise >= 60 and not v_alerted then
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'noise_spark', 'hunter',
        jsonb_build_object('player_id', me.id)
      );
      v_alerted := true;
    end if;

    if v_noise >= 100 then
      update public.games g
        set ping_seq = g.ping_seq + 1
        where g.id = current_game.id
        returning g.ping_seq into v_noise_seq;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason
      ) values (
        current_game.id, v_noise_seq, me.id, fix_geog, v_accuracy,
        greatest(0, floor(extract(epoch from (now() - fix_time)))::integer),
        'noise'
      );

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'noise_ping', 'all',
        jsonb_build_object('player_id', me.id, 'seq', v_noise_seq)
      );

      v_noise := 40;
      v_alerted := false;
    end if;
  else
    v_noise := 0;
    v_alerted := false;
    v_anchor := null;
    v_anchor_since := null;
  end if;

  -- Mock Location Detection (Safety Guard)
  if coalesce(submit_position.is_mock, false) then
    if not exists (
      select 1 from public.events ev
      where ev.game_id = current_game.id
        and ev.type = 'mock_location_detected'
        and (ev.payload->>'player_id') = me.id::text
        and ev.created_at > now() - interval '60 seconds'
    ) then
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'mock_location_detected',
        'all',
        jsonb_build_object(
          'player_id', me.id,
          'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id),
          'message', 'Mock location detected from player'
        )
      );
    end if;
  end if;

  insert into public.player_positions (
    player_id, game_id, geog, accuracy_m, speed_mps, heading, is_mock,
    recorded_at, updated_at, out_of_bounds_since,
    noise, noise_alerted, smoothed_speed_mps, anchor_geog, anchor_since,
    fast_since, vehicle_warned
  ) values (
    me.id, current_game.id, fix_geog, v_accuracy, v_speed, v_heading,
    coalesce(submit_position.is_mock, false), fix_time, now(), v_out_since,
    v_noise, v_alerted, v_smoothed, v_anchor, v_anchor_since,
    v_fast_since, v_vehicle_warned
  )
  on conflict (player_id) do update set
    game_id = excluded.game_id,
    geog = excluded.geog,
    accuracy_m = excluded.accuracy_m,
    speed_mps = excluded.speed_mps,
    heading = excluded.heading,
    is_mock = excluded.is_mock,
    recorded_at = excluded.recorded_at,
    updated_at = excluded.updated_at,
    out_of_bounds_since = excluded.out_of_bounds_since,
    noise = excluded.noise,
    noise_alerted = excluded.noise_alerted,
    smoothed_speed_mps = excluded.smoothed_speed_mps,
    anchor_geog = excluded.anchor_geog,
    anchor_since = excluded.anchor_since,
    fast_since = excluded.fast_since,
    vehicle_warned = excluded.vehicle_warned;

  if not coalesce(submit_position.is_mock, false) then
    insert into public.trail_points (game_id, player_id, geog, accuracy_m, recorded_at)
    select current_game.id, me.id, fix_geog, v_accuracy, fix_time
    where not exists (
      select 1
      from public.trail_points tp
      where tp.player_id = me.id
        and tp.recorded_at > fix_time - interval '10 seconds'
    );
  end if;

  if not v_in_bounds and v_prev_out is null then
    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'boundary_warning',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id)
      )
    );
  end if;

  if not v_in_bounds
     and current_game.boundary_penalty = 'extra_ping'
     and me.team = 'runner'
     and v_out_since is not null
     and now() >= v_out_since + make_interval(secs => current_game.boundary_grace_s)
     and not exists (
       select 1
       from public.events e
       where e.game_id = current_game.id
         and e.type = 'boundary_penalty'
         and e.payload->>'player_id' = me.id::text
         and e.created_at > v_out_since
     ) then
    update public.games g
      set ping_seq = g.ping_seq + 1
      where g.id = current_game.id
      returning g.ping_seq into v_penalty_seq;

    insert into public.pings (
      game_id, seq, player_id, geog, accuracy_m, position_age_s, reason
    ) values (
      current_game.id,
      v_penalty_seq,
      me.id,
      fix_geog,
      v_accuracy,
      greatest(0, floor(extract(epoch from (now() - fix_time)))::integer),
      'boundary'
    );

    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'boundary_penalty',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'seq', v_penalty_seq,
        'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id)
      )
    );
  end if;

  if current_game.status = 'live'
     and current_game.mode = 'classic_chase'
     and me.team = 'runner'
     and exists (
       select 1
       from public.targets t
       where t.game_id = current_game.id
         and extensions.st_dwithin(fix_geog, t.geog, current_game.target_radius_m)
     ) then
    perform public.end_game(current_game.id, 'runners', 'target_reached');
    select * into current_game from public.games g where g.id = current_game.id;
  end if;

  return jsonb_build_object(
    'phase', current_game.status,
    'server_time', now(),
    'live_at', current_game.live_at,
    'ends_at', current_game.ends_at,
    'next_ping_at', current_game.next_ping_at,
    'in_bounds', v_in_bounds,
    'effective_radius_m', v_radius,
    'my_status', me.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason,
    'noise', v_noise,
    'smoothed_speed_mps', round(v_smoothed::numeric, 2)
  );
end;
$$;

revoke all on function public.submit_position(
  uuid, double precision, double precision, double precision, double precision,
  double precision, boolean, timestamptz
) from public, anon;
grant execute on function public.submit_position(
  uuid, double precision, double precision, double precision, double precision,
  double precision, boolean, timestamptz
) to authenticated;

-- 8. advance_game: Internal Caller Support, Ghost Fairness & Assist Mode -----

create or replace function public.advance_game(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  next_ping timestamptz;
  ping_count integer := 0;
  runner record;
  ping_geog extensions.geography;
  shift_m double precision;
  bearing double precision;
  dist_from_center double precision;
  zone_on boolean;
  stages numeric[];
  stage_count integer;
  stage_index integer;
  progress double precision;
  next_stage integer;
  next_start timestamptz;
  ghost_rec record;
  patrol_geom geometry;
  path_len_m double precision;
  duration_s int;
  effective_duration_s int;
  elapsed_s float;
  loop_frac float;
  current_ghost_pt geometry;
  runner_fix record;
  active_runners_count int;
  v_dwells jsonb;
  v_first_seen timestamptz;
begin
  -- Allow internal background jobs (caller_id is null) or game members
  if caller_id is not null and not public.is_member(advance_game.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game from public.games g
    where g.id = advance_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status = 'countdown'
     and current_game.head_start_at is not null
     and now() >= current_game.head_start_at then
    update public.games g set status = 'head_start'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type) values (current_game.id, 'head_start_began');
  end if;

  if current_game.status = 'head_start'
     and current_game.live_at is not null
     and now() >= current_game.live_at then
    update public.games g set status = 'live'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type) values (current_game.id, 'live_began');

    if 'dead_drops' = any(current_game.modifiers)
       and not exists (
         select 1 from public.entities e
         where e.game_id = current_game.id and e.kind = 'drop'
       ) then
      perform public.spawn_drops(current_game.id, null);
    end if;

    if current_game.mode_id in ('haunted_map', 'ghost_duel')
       and not exists (
         select 1 from public.entities e
         where e.game_id = current_game.id and e.kind = 'ghost'
       ) then
      perform public.spawn_ghost_npcs(current_game.id);
    end if;
  end if;

  -- Shrinking Zone: advance stage and announce 60 s before
  if current_game.status = 'live'
     and 'shrinking_zone' = any(current_game.modifiers)
     and current_game.live_at is not null
     and current_game.duration_s > 0 then
    zone_on := true;
    stages := public.zone_stage_values(current_game.id);
    stage_count := array_length(stages, 1);
    progress := greatest(
      0,
      least(1, extract(epoch from (now() - current_game.live_at)) / current_game.duration_s)
    );
    stage_index := public.zone_stage_at(current_game.id, progress);

    if current_game.zone_stage = 0 then
      update public.games g set zone_stage = 1 where g.id = current_game.id
        returning * into current_game;
    elsif stage_index > current_game.zone_stage then
      update public.games g set zone_stage = stage_index where g.id = current_game.id
        returning * into current_game;
      insert into public.events (game_id, type, payload)
      values (
        current_game.id, 'zone_shrunk',
        jsonb_build_object(
          'stage', stage_index,
          'stages', stage_count,
          'percent', stages[stage_index],
          'radius_m', round(current_game.area_radius_m * stages[stage_index] / 100.0)
        )
      );
    end if;

    next_stage := current_game.zone_stage + 1;
    if next_stage <= stage_count and current_game.zone_announced < next_stage then
      next_start := current_game.live_at
        + make_interval(secs => (
            current_game.duration_s * (
              2.0 / 3.0 + (next_stage - 2) * (1.0 / 3.0) / (stage_count - 1)
            )
          )::double precision);
      if now() >= next_start - interval '60 seconds' then
        update public.games g set zone_announced = next_stage where g.id = current_game.id
          returning * into current_game;
        insert into public.events (game_id, type, payload)
        values (
          current_game.id, 'zone_shrink_soon',
          jsonb_build_object(
            'stage', next_stage,
            'stages', stage_count,
            'percent', stages[next_stage],
            'radius_m', round(current_game.area_radius_m * stages[next_stage] / 100.0),
            'at', next_start
          )
        );
      end if;
    end if;
  end if;

  -- Ghost NPC simulation loop for Haunted Map & Ghost Duel
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    for ghost_rec in
      select * from public.entities e where e.game_id = current_game.id and e.kind = 'ghost'
    loop
      if (ghost_rec.state->>'path_wkt') is not null or (ghost_rec.state->>'path_geojson') is not null then
        if (ghost_rec.state->>'path_wkt') is not null then
          patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
        else
          patrol_geom := extensions.st_geomfromgeojson(ghost_rec.state->>'path_geojson');
        end if;

        duration_s := greatest(30, coalesce((ghost_rec.state->>'duration_s')::int, 240));
        -- Fairness: clamp ghost velocity to <= 2.0 m/s along its patrol line
        path_len_m := coalesce(extensions.st_length(patrol_geom::geography), 0.0);
        effective_duration_s := greatest(duration_s, ceil(path_len_m / 2.0)::int);

        elapsed_s := extract(epoch from (now() - (ghost_rec.state->>'t0')::timestamptz));
        loop_frac := greatest(0.0, least(1.0, (mod(elapsed_s::numeric, effective_duration_s::numeric) / effective_duration_s::numeric)::float));

        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        -- Keep ghosts inside play boundary
        if current_game.area_center is not null and current_game.area_radius_m is not null then
          if extensions.st_distance(current_ghost_pt::geography, current_game.area_center) > current_game.area_radius_m then
            current_ghost_pt := extensions.st_project(
              current_game.area_center,
              greatest(5.0, current_game.area_radius_m - 10.0),
              extensions.st_azimuth(current_game.area_center::geometry, current_ghost_pt)
            )::geometry;
          end if;
        end if;

        v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);

        -- Evaluate active runners: ignore fixes with accuracy_m > 30.0 (fairness)
        for runner_fix in
          select p.id as runner_id, p.user_id, pr.display_name as runner_name, pp.geog as runner_geog,
                 pp.accuracy_m,
                 extensions.st_distance(current_ghost_pt::geography, pp.geog) as dist_m
          from public.players p
          join public.player_positions pp on pp.player_id = p.id
          left join public.profiles pr on pr.id = p.user_id
          where p.game_id = current_game.id
            and p.team = 'runner'
            and p.status = 'active'
            and pp.recorded_at > now() - interval '30 seconds'
            and coalesce(pp.accuracy_m, 999.0) <= 30.0
        loop
          if runner_fix.dist_m <= 12.0 then
            -- 3-second continuous dwell gating
            if not (v_dwells ? runner_fix.runner_id::text) then
              v_dwells := jsonb_set(v_dwells, array[runner_fix.runner_id::text], to_jsonb(now()));
            else
              v_first_seen := (v_dwells->>runner_fix.runner_id::text)::timestamptz;
              if now() >= v_first_seen + interval '3 seconds' then
                v_dwells := v_dwells - runner_fix.runner_id::text;

                update public.players
                set status = 'tagged', tagged_at = now()
                where id = runner_fix.runner_id;

                insert into public.events (game_id, type, audience, payload)
                values (
                  current_game.id,
                  'runner_tagged',
                  'all',
                  jsonb_build_object(
                    'runner_id', runner_fix.runner_id,
                    'runner_name', runner_fix.runner_name,
                    'by', 'ghost',
                    'reason', 'haunted',
                    'tagged_at', now()
                  )
                );

                select count(*) into active_runners_count
                from public.players pl
                where pl.game_id = current_game.id and pl.team = 'runner' and pl.status = 'active';

                if active_runners_count = 0 then
                  perform public.end_game(current_game.id, 'hunters', 'all_tagged');
                  select * into current_game from public.games g where g.id = advance_game.game_id;
                  return current_game.status;
                end if;
              end if;
            end if;

          else
            -- Outside 12 m: clear dwell timer
            if v_dwells ? runner_fix.runner_id::text then
              v_dwells := v_dwells - runner_fix.runner_id::text;
            end if;

            -- 40 m proximity interaction:
            if runner_fix.dist_m <= 40.0 then
              if current_game.ghost_mode = 'assist' then
                -- Assist Mode (D3): emit sighting pings to hunters
                if not exists (
                  select 1 from public.pings pi
                  where pi.game_id = current_game.id
                    and pi.player_id = runner_fix.runner_id
                    and pi.reason = 'ghost_sighting'
                    and pi.released_at > now() - interval '20 seconds'
                ) then
                  insert into public.pings (
                    game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
                  ) values (
                    current_game.id,
                    current_game.ping_seq,
                    runner_fix.runner_id,
                    current_ghost_pt::geography,
                    coalesce(runner_fix.accuracy_m, 15.0),
                    greatest(0, floor(extract(epoch from (now() - runner_fix.recorded_at)))::integer),
                    'ghost_sighting',
                    now()
                  );

                  insert into public.events (game_id, type, audience, payload)
                  values (
                    current_game.id,
                    'ghost_sighting',
                    'hunter',
                    jsonb_build_object(
                      'ghost_index', ghost_rec.state->>'ghost_index',
                      'runner_id', runner_fix.runner_id,
                      'approx_lat', round(extensions.st_y(current_ghost_pt)::numeric, 5),
                      'approx_lng', round(extensions.st_x(current_ghost_pt)::numeric, 5),
                      'message', 'Ghost assisted hunters with a sighting ping!'
                    )
                  );
                end if;
              else
                -- Haunt Mode: advisory event only
                if not exists (
                  select 1 from public.events ev
                  where ev.game_id = current_game.id
                    and ev.type = 'ghost_sighting'
                    and (ev.payload->>'runner_id') = runner_fix.runner_id::text
                    and ev.created_at > now() - interval '20 seconds'
                ) then
                  insert into public.events (game_id, type, audience, payload)
                  values (
                    current_game.id,
                    'ghost_sighting',
                    'hunter',
                    jsonb_build_object(
                      'ghost_index', ghost_rec.state->>'ghost_index',
                      'runner_id', runner_fix.runner_id,
                      'approx_lat', round(extensions.st_y(current_ghost_pt)::numeric, 5),
                      'approx_lng', round(extensions.st_x(current_ghost_pt)::numeric, 5),
                      'message', 'A ghost sighted a runner!'
                    )
                  );
                end if;
              end if;
            end if;
          end if;
        end loop;

        update public.entities
        set geog = current_ghost_pt::geography,
            state = jsonb_set(
              jsonb_set(
                jsonb_set(ghost_rec.state, '{current_lat}', to_jsonb(extensions.st_y(current_ghost_pt))),
                '{current_lng}', to_jsonb(extensions.st_x(current_ghost_pt))
              ),
              '{dwells}', v_dwells
            ),
            updated_at = now()
        where id = ghost_rec.id;
      end if;
    end loop;
  end if;

  if current_game.status = 'live'
     and current_game.next_ping_at is not null
     and now() >= current_game.next_ping_at then
    next_ping := current_game.next_ping_at
      + make_interval(secs => current_game.ping_interval_s);
    if next_ping <= now() then
      next_ping := now() + make_interval(secs => current_game.ping_interval_s);
    end if;

    update public.games g
      set ping_seq = g.ping_seq + 1,
          next_ping_at = next_ping
      where g.id = current_game.id
      returning * into current_game;

    for runner in
      select p.id, p.status_detail, pp.geog, pp.accuracy_m, pp.recorded_at
      from public.players p
      join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and p.status = 'active'
        and p.team = 'runner'
    loop
      if runner.status_detail ? 'veil' then
        update public.players p
          set status_detail = p.status_detail - 'veil'
          where p.id = runner.id;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'veil_used', 'runner',
          jsonb_build_object('player_id', runner.id)
        );
        continue;
      end if;

      ping_geog := runner.geog;
      if (runner.status_detail ? 'decoy') or (runner.status_detail ? 'scramble') then
        shift_m := 150 + random() * 100;
        ping_geog := extensions.st_project(runner.geog, shift_m, radians(random() * 360));

        dist_from_center := extensions.st_distance(ping_geog, current_game.area_center);
        if dist_from_center > current_game.area_radius_m - 10 then
          bearing := extensions.st_azimuth(
            current_game.area_center::extensions.geometry,
            ping_geog::extensions.geometry
          );
          ping_geog := extensions.st_project(
            current_game.area_center,
            greatest(10, current_game.area_radius_m - 10),
            bearing
          );
        end if;

        if runner.status_detail ? 'scramble' then
          update public.players p
            set status_detail = p.status_detail - 'scramble'
            where p.id = runner.id;
        end if;

        if runner.status_detail ? 'decoy' then
          update public.players p
            set status_detail = p.status_detail - 'decoy'
            where p.id = runner.id;
          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id, 'decoy_used', 'runner',
            jsonb_build_object('player_id', runner.id)
          );
        end if;
      end if;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id,
        current_game.ping_seq,
        runner.id,
        ping_geog,
        runner.accuracy_m,
        greatest(0, floor(extract(epoch from (now() - runner.recorded_at)))::integer),
        'scheduled',
        now()
      );
      ping_count := ping_count + 1;
    end loop;

    if ping_count > 0 then
      insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'ping_released',
        jsonb_build_object(
          'seq', current_game.ping_seq,
          'count', ping_count,
          'released_at', now()
        )
      );
    end if;
  end if;

  if current_game.status in ('countdown', 'head_start', 'live')
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
    if current_game.mode = 'classic_chase' then
      perform public.end_game(current_game.id, 'hunters', 'time_expired');
    else
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated, service_role, postgres;

-- 9. Game Clock: advance_active_games & Keep-Alive health_ping (D6) -----------

create or replace function public.advance_active_games(limit_count integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  g_rec record;
  advanced_ids uuid[] := array[]::uuid[];
  v_lim integer := least(greatest(1, limit_count), 50);
begin
  for g_rec in
    select id from public.games
    where status in ('countdown', 'head_start', 'live')
    order by
      case
        when status = 'countdown' then 1
        when status = 'head_start' then 2
        when status = 'live' then 3
        else 4
      end,
      coalesce(next_ping_at, live_at, head_start_at, ends_at, started_at) asc
    limit v_lim
  loop
    begin
      perform public.advance_game(g_rec.id);
      advanced_ids := array_append(advanced_ids, g_rec.id);
    exception when others then
      -- Bounded failure: skip individual game errors
      null;
    end;
  end loop;

  return jsonb_build_object(
    'advanced_count', coalesce(array_length(advanced_ids, 1), 0),
    'advanced_ids', to_jsonb(advanced_ids),
    'advanced_at', now()
  );
end;
$$;

revoke all on function public.advance_active_games(integer) from public;
grant execute on function public.advance_active_games(integer) to anon, authenticated, service_role, postgres;

-- Hardened health_ping RPC: idempotent, bounded, secret-validated fallback
create or replace function public.health_ping(body jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_configured_secret text;
  v_adv jsonb;
  v_last_cleanup timestamptz;
  v_retention_swept boolean := false;
begin
  -- Optional shared-secret validation
  select value into v_configured_secret from public.server_secrets where key = 'health_ping_secret';
  if v_configured_secret is not null and length(v_configured_secret) > 0 then
    if coalesce(body->>'secret', body->>'request_secret', '') <> v_configured_secret then
      return jsonb_build_object(
        'ok', false,
        'error', 'unauthorized',
        'server_time', now()
      );
    end if;
  end if;

  -- Advance up to 5 active games (bounded fallback)
  v_adv := public.advance_active_games(5);

  -- Rate-limited 30-day retention cleanup (at most once every 10 minutes)
  select value::timestamptz into v_last_cleanup from public.server_secrets where key = 'last_retention_sweep';
  if v_last_cleanup is null or now() - v_last_cleanup >= interval '10 minutes' then
    begin
      perform public.cleanup_old_games();
      insert into public.server_secrets (key, value)
      values ('last_retention_sweep', now()::text)
      on conflict (key) do update set value = excluded.value;
      v_retention_swept := true;
    exception when others then
      v_retention_swept := false;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'app', 'ghostrun',
    'server_time', now(),
    'games_advanced', coalesce((v_adv->>'advanced_count')::int, 0),
    'retention_swept', v_retention_swept
  );
end;
$$;

revoke all on function public.health_ping(jsonb) from public;
grant execute on function public.health_ping(jsonb) to anon, authenticated, service_role;

-- 10. Schedule 30-second pg_cron Job (D6) --------------------------------------

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(jobid) from cron.job where jobname = 'ghostrun-advance-games';
    exception when others then null;
    end;

    begin
      perform cron.schedule(
        'ghostrun-advance-games',
        '30 seconds',
        'select public.advance_active_games(10)'
      );
    exception when others then
      raise notice 'Could not schedule ghostrun-advance-games with pg_cron: %', sqlerrm;
    end;
  end if;
end;
$$;
