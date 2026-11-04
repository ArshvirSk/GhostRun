-- Migration: 20261111003000_b3_relay_heist_lifecycle.sql
-- B3 Relay Heist Lifecycle: start_game, apply_tag, submit_position, advance_game, get_game_state

-- 1. start_game ----------------------------------------------------------------

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
  active_total integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  round_ends timestamptz;
  hunter_heat_charges integer := 0;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
  safe_zone_count integer;
  initial_carrier_id uuid;
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

  -- For Jailbreak mode, jail must be placed before start
  if current_game.mode_id = 'jailbreak' then
    if not exists (select 1 from public.entities e where e.game_id = current_game.id and e.kind = 'jail') then
      raise exception 'Place the jail before starting the round.';
    end if;
  end if;

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'unassigned'),
         count(*)
    into active_runners, active_hunters, unassigned, active_total
    from public.players p
    where p.game_id = current_game.id and p.status = 'active';

  if current_game.mode_id = 'assassin_ring' then
    if active_total < 3 then
      raise exception 'Assassin Ring requires at least 3 players to form a ring.';
    end if;

    update public.players p
      set team = 'solo'
      where p.game_id = current_game.id and p.status = 'active';

    select count(*) into safe_zone_count
      from public.entities e
      where e.game_id = current_game.id and e.kind = 'safe_zone';

    if safe_zone_count < 2 then
      insert into public.entities (game_id, kind, geog, state, visible_to)
      values
        (current_game.id, 'safe_zone',
         extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.45, radians(0)),
         jsonb_build_object('zone_index', 1, 'radius_m', 20), 'all'),
        (current_game.id, 'safe_zone',
         extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.45, radians(180)),
         jsonb_build_object('zone_index', 2, 'radius_m', 20), 'all');
    end if;

    with shuffled as (
      select p.id,
             row_number() over (order by random()) as rn,
             count(*) over () as total
      from public.players p
      where p.game_id = current_game.id and p.status = 'active'
    ),
    ring as (
      select s1.id as hunter_id,
             s2.id as prey_id
      from shuffled s1
      join shuffled s2 on s2.rn = (case when s1.rn = s1.total then 1 else s1.rn + 1 end)
    )
    insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
    select current_game.id, hunter_id, prey_id, 'active'
    from ring;

  elsif current_game.mode_id not in ('haunted_map', 'ghost_duel') then
    if active_runners = 0 or active_hunters = 0 then
      raise exception 'Assign at least one runner and one hunter before starting.';
    end if;
    if unassigned > 0 then
      raise exception 'Every player must choose a team before the round starts.';
    end if;
  else
    if active_runners = 0 and active_hunters = 0 then
      raise exception 'Assign at least one player before starting.';
    end if;
  end if;

  -- Relay Heist initialization
  if current_game.mode_id = 'relay_heist' then
    if not exists (select 1 from public.entities e where e.game_id = current_game.id and e.kind = 'extraction') then
      insert into public.entities (game_id, kind, geog, state, visible_to)
      values (
        current_game.id,
        'extraction',
        extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.75, radians(45)),
        jsonb_build_object('radius_m', 25),
        'all'
      );
    end if;

    select p.id into initial_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
    order by (case when p.id = current_game.host_id then 0 else 1 end), random()
    limit 1;

    delete from public.entities e where e.game_id = current_game.id and e.kind = 'package';

    insert into public.entities (game_id, kind, team, geog, state, visible_to)
    values (
      current_game.id,
      'package',
      'runner',
      current_game.area_center,
      jsonb_build_object(
        'status', 'carried',
        'carrier_player_id', initial_carrier_id,
        'handoff_pending_to', null,
        'handoff_expires_at', null,
        'cooldown_until', null
      ),
      'runner'
    );

    insert into public.events (game_id, type, target_player, audience, payload)
    values (
      current_game.id,
      'carrier_designated',
      initial_carrier_id,
      'runner',
      jsonb_build_object('carrier_id', initial_carrier_id, 'message', 'Initial package carrier designated.')
    );
  end if;

  if current_game.mode_id = 'classic_chase'
     and not exists (select 1 from public.targets t where t.game_id = current_game.id) then
    raise exception 'Runners must save the secret target first.';
  end if;

  select count(*) into missing_consent
    from public.players p
    where p.game_id = current_game.id and p.status = 'active' and p.share_trail is null;
  if missing_consent > 0 then
    raise exception 'Every player must choose whether to share their route before the round starts.';
  end if;

  if 'double_agent' = any(current_game.roles) and current_game.mode_id <> 'assassin_ring' then
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
        'hunter',
        jsonb_build_object('message', 'You are secretly working as the Double Agent.')
      );
    else
      current_game.roles := array_remove(current_game.roles, 'double_agent');
    end if;
  end if;

  countdown_ends := now() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);
  round_ends := live_starts + make_interval(secs => current_game.duration_s);

  if 'hot_cold' = any(current_game.modifiers) then
    current_game.ping_interval_s := current_game.ping_interval_s * 3;
    hunter_heat_charges := coalesce((current_game.mode_params->'hot_cold'->>'initial_charges')::int, 6);
  end if;

  update public.games g set
    status = 'countdown',
    head_start_at = countdown_ends,
    live_at = live_starts,
    ends_at = round_ends,
    next_ping_at = live_starts + make_interval(secs => current_game.ping_interval_s),
    ping_seq = 0,
    roles = current_game.roles,
    ping_interval_s = current_game.ping_interval_s
    where g.id = current_game.id
    returning * into current_game;

  insert into public.team_resources (game_id, team, heat_charges)
  values
    (current_game.id, 'hunter', hunter_heat_charges),
    (current_game.id, 'runner', 0)
  on conflict (game_id, team) do update
  set heat_charges = excluded.heat_charges;

  insert into public.events (game_id, type, payload)
  values (
    current_game.id,
    'round_started',
    jsonb_build_object(
      'countdown_ends_at', current_game.head_start_at,
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at
    )
  );

  return to_jsonb(current_game);
end;
$$;

-- 2. apply_tag ----------------------------------------------------------------

create or replace function public.apply_tag(
  p_game_id uuid,
  p_hunter_id uuid,
  p_runner_id uuid,
  p_distance_m double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_game public.games%rowtype;
  target_runner public.players%rowtype;
  runner_name text;
  hunter_name text;
  active_runners integer;
  active_survivors integer;
  is_jailbreak boolean;
  is_assassin boolean;
  v_next_prey_id uuid;
begin
  select * into current_game from public.games g
    where g.id = p_game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into target_runner from public.players p
    where p.id = p_runner_id and p.game_id = p_game_id and p.status = 'active'
    for update;
  if not found then raise exception 'That player is not taggable.'; end if;

  select pr.display_name into runner_name
    from public.profiles pr where pr.id = target_runner.user_id;
  select pr.display_name into hunter_name
    from public.players hp join public.profiles pr on pr.id = hp.user_id
    where hp.id = p_hunter_id;

  insert into public.tags (game_id, hunter_id, runner_id, distance_m)
  values (p_game_id, p_hunter_id, target_runner.id, greatest(0, p_distance_m)::real);

  update public.players p set last_tag_attempt_at = null where p.id = p_hunter_id;

  is_jailbreak := (current_game.mode_id = 'jailbreak');
  is_assassin := (current_game.mode_id = 'assassin_ring');

  -- Relay Heist: carrier tag drops package
  if current_game.mode_id = 'relay_heist' then
    if exists (
      select 1 from public.entities e
      where e.game_id = p_game_id and e.kind = 'package'
        and (e.state->>'carrier_player_id') = target_runner.id::text
        and (e.state->>'status') = 'carried'
    ) then
      update public.entities e
      set geog = coalesce((select pp.geog from public.player_positions pp where pp.player_id = target_runner.id), e.geog),
          state = jsonb_build_object(
            'status', 'dropped',
            'carrier_player_id', null,
            'dropped_at', now(),
            'securing_hunter_id', null,
            'securing_started_at', null
          ),
          visible_to = 'all',
          updated_at = now()
      where e.game_id = p_game_id and e.kind = 'package';

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'package_dropped', 'all',
        jsonb_build_object(
          'carrier_id', target_runner.id,
          'carrier_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', 'The carrier was tagged! The package has been dropped!'
        )
      );
    end if;
  end if;

  if is_assassin then
    update public.players p
      set status = 'tagged',
          tagged_at = now(),
          is_ready = false
      where p.id = target_runner.id;

    update public.ring_assignments ra
      set status = 'eliminated', eliminated_at = now()
      where ra.game_id = p_game_id and ra.prey_player_id = target_runner.id and ra.status = 'active';

    select ra.prey_player_id into v_next_prey_id
    from public.ring_assignments ra
    where ra.game_id = p_game_id and ra.hunter_player_id = target_runner.id and ra.status = 'active';

    update public.ring_assignments ra
      set status = 'relinked'
      where ra.game_id = p_game_id and ra.hunter_player_id = target_runner.id and ra.status = 'active';

    if v_next_prey_id is not null and v_next_prey_id <> p_hunter_id then
      update public.ring_assignments ra
        set status = 'relinked'
        where ra.game_id = p_game_id and ra.hunter_player_id = p_hunter_id and ra.status = 'active';

      insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
      values (p_game_id, p_hunter_id, v_next_prey_id, 'active');
    end if;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'player_eliminated', 'all',
      jsonb_build_object(
        'hunter_id', p_hunter_id,
        'prey_id', target_runner.id,
        'hunter_name', hunter_name,
        'prey_name', runner_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    select count(*) into active_survivors
      from public.players sp
      where sp.game_id = p_game_id and sp.status = 'active';

    if active_survivors <= 1 then
      perform public.end_game(p_game_id, 'solo', 'last_survivor');
    end if;

  elsif is_jailbreak then
    update public.players p
      set status = 'jailed',
          tagged_at = now(),
          is_ready = false,
          status_detail = p.status_detail - 'free_started_at'
      where p.id = target_runner.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'runner_jailed', 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'hunter_id', p_hunter_id,
        'display_name', runner_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    select count(*) into active_runners
      from public.players p
      where p.game_id = p_game_id and p.team = 'runner' and p.status = 'active';

    if active_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_jailed');
    end if;

  else
    update public.players p
      set status = 'tagged', tagged_at = now(), is_ready = false
      where p.id = target_runner.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'runner_tagged', 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'hunter_id', p_hunter_id,
        'display_name', runner_name
      )
    );

    select count(*) into active_runners
      from public.players p
      where p.game_id = p_game_id and p.team = 'runner' and p.status = 'active';

    if active_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_tagged');
    end if;
  end if;

  select * into current_game from public.games g where g.id = p_game_id;

  return jsonb_build_object(
    'success', true,
    'runner_id', target_runner.id,
    'phase', current_game.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason
  );
end;
$$;

-- 3. submit_position -----------------------------------------------------------

create or replace function public.submit_position(
  game_id uuid,
  lat double precision,
  lng double precision,
  accuracy double precision default null,
  speed double precision default null,
  heading double precision default null,
  recorded_at timestamptz default null,
  is_mock boolean default false
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
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_radius double precision;
  v_in_bounds boolean;
  v_prev_out timestamptz;
  v_prev_noise integer;
  v_prev_alerted boolean;
  v_prev_smoothed real;
  v_prev_anchor extensions.geography;
  v_prev_anchor_since timestamptz;
  v_prev_updated timestamptz;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
  v_out_since timestamptz;
  v_dt double precision;
  v_smoothed real;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_noise_on boolean;
  v_noise integer := 0;
  v_alerted boolean := false;
  v_anchor extensions.geography;
  v_anchor_since timestamptz;
  v_camp_seq integer;
  v_noise_seq integer;
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
    raise exception 'Invalid GPS coordinates.';
  end if;

  fix_geog := extensions.st_setsrid(extensions.st_makepoint(submit_position.lng, submit_position.lat), 4326)::extensions.geography;
  fix_time := coalesce(submit_position.recorded_at, now());
  if fix_time > now() + interval '5 seconds' then
    fix_time := now() + interval '5 seconds';
  elsif fix_time < now() - interval '2 minutes' then
    fix_time := now() - interval '2 minutes';
  end if;

  v_accuracy := greatest(0, coalesce(submit_position.accuracy, 0))::real;
  v_speed := greatest(0, coalesce(submit_position.speed, 0))::real;
  v_heading := case
    when submit_position.heading is not null and submit_position.heading between 0 and 360
      then submit_position.heading::real
    else null
  end;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_dwithin(fix_geog, current_game.area_center, v_radius);

  select pp.out_of_bounds_since, pp.noise, pp.noise_alerted, pp.smoothed_speed_mps,
         pp.anchor_geog, pp.anchor_since, pp.updated_at, pp.fast_since, pp.vehicle_warned
    into v_prev_out, v_prev_noise, v_prev_alerted, v_prev_smoothed,
         v_prev_anchor, v_prev_anchor_since, v_prev_updated, v_prev_fast_since, v_prev_vehicle_warned
    from public.player_positions pp
    where pp.player_id = me.id;

  if v_in_bounds then
    v_out_since := null;
  else
    v_out_since := coalesce(v_prev_out, now());
  end if;

  v_dt := case
    when v_prev_updated is not null then
      greatest(0.5, least(30.0, extract(epoch from (now() - v_prev_updated))))
    else 1.0
  end;

  v_smoothed := case
    when v_prev_smoothed is not null then
      (0.3 * v_speed + 0.7 * v_prev_smoothed)::real
    else v_speed
  end;

  if v_smoothed >= 8.0 then
    v_fast_since := coalesce(v_prev_fast_since, now());
    v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);
    if not v_vehicle_warned and now() >= v_fast_since + interval '10 seconds' then
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'vehicle_warning',
        'all',
        jsonb_build_object(
          'player_id', me.id,
          'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id),
          'message', 'Vehicle-like speed detected; please stay on foot.'
        )
      );
      v_vehicle_warned := true;
    end if;
  else
    v_fast_since := null;
    v_vehicle_warned := false;
  end if;

  v_noise_on := 'noise_meter' = any(current_game.modifiers)
                and current_game.status = 'live'
                and me.team = 'runner';

  if v_noise_on then
    v_noise := coalesce(v_prev_noise, 0);
    v_alerted := coalesce(v_prev_alerted, false);
    v_anchor := v_prev_anchor;
    v_anchor_since := v_prev_anchor_since;

    if v_anchor is null or not extensions.st_dwithin(fix_geog, v_anchor, 20) then
      v_anchor := fix_geog;
      v_anchor_since := now();
    end if;

    if v_smoothed > 4.5 then
      v_noise := least(100, v_noise + round(v_dt * 8)::integer);
    elsif v_smoothed > 2.5 then
      v_noise := least(100, v_noise + round(v_dt * 4)::integer);
    elsif v_smoothed < 1.0 and v_anchor_since is not null and now() - v_anchor_since > interval '60 seconds' then
      v_noise := least(100, v_noise + round(v_dt * 3)::integer);
    else
      v_noise := greatest(0, v_noise - round(v_dt * 2)::integer);
    end if;

    if v_noise >= 80 and not v_alerted then
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

  -- Relay Heist: carrier position syncs package entity coordinates
  if current_game.status in ('head_start', 'live') and current_game.mode_id = 'relay_heist' and me.team = 'runner' then
    update public.entities e
    set geog = fix_geog, updated_at = now()
    where e.game_id = current_game.id and e.kind = 'package'
      and (e.state->>'carrier_player_id') = me.id::text
      and (e.state->>'status') = 'carried';
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
  elsif v_in_bounds and v_prev_out is not null then
    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'boundary_cleared',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id)
      )
    );
  end if;

  -- Classic chase arrival check
  if current_game.status = 'live'
     and current_game.mode_id = 'classic_chase'
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

  -- Relay Heist extraction check: carrier enters extraction zone
  if current_game.status = 'live'
     and current_game.mode_id = 'relay_heist'
     and me.team = 'runner'
     and exists (
       select 1
       from public.entities e_pkg
       join public.entities e_ext on e_ext.game_id = current_game.id and e_ext.kind = 'extraction'
       where e_pkg.game_id = current_game.id
         and e_pkg.kind = 'package'
         and (e_pkg.state->>'carrier_player_id') = me.id::text
         and (e_pkg.state->>'status') = 'carried'
         and extensions.st_dwithin(fix_geog, e_ext.geog, coalesce((e_ext.state->>'radius_m')::int, 25))
     ) then
    perform public.end_game(current_game.id, 'runners', 'extraction_complete');
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

-- 4. advance_game --------------------------------------------------------------

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
  duration_s int;
  effective_duration_s int;
  path_len_m double precision;
  elapsed_s float;
  loop_frac float;
  current_ghost_pt geometry;
  runner_fix record;
  active_runners_count int;
  jailed_runners_count int;
  active_survivors_count int;
  v_dwells jsonb;
  v_first_seen timestamptz;
  v_ghost_ping_seq integer;
  v_auto_release_s integer;
  jailed_rec record;
  jail_rec public.entities%rowtype;
  offline_rec record;
  v_next_prey_id uuid;
  pkg_offline record;
  carrier_rec record;
  v_carrier_ping_seq integer;
begin
  if caller_id is null or not public.is_member(advance_game.game_id) then
    -- health_ping or worker can call without membership
    null;
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
    insert into public.events (game_id, type, payload)
    values (current_game.id, 'head_start_began', jsonb_build_object('phase', 'head_start'));
  end if;

  if current_game.status = 'head_start'
     and current_game.live_at is not null
     and now() >= current_game.live_at then
    update public.games g set status = 'live'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type, payload)
    values (current_game.id, 'live_began', jsonb_build_object('phase', 'live'));
  end if;

  -- Shrinking zone progression
  zone_on := 'shrinking_zone' = any(current_game.modifiers);
  if zone_on and current_game.status = 'live' then
    stages := public.zone_stage_values(current_game.id);
    stage_count := coalesce(array_length(stages, 1), 0);

    if stage_count > 0 and current_game.zone_stage < stage_count then
      progress := extract(epoch from (now() - current_game.live_at))
        / greatest(1, extract(epoch from (current_game.ends_at - current_game.live_at)));
      stage_index := least(stage_count, floor(progress * stage_count)::integer + 1);

      if stage_index > current_game.zone_stage then
        update public.games g
          set zone_stage = stage_index
          where g.id = current_game.id
          returning * into current_game;

        insert into public.events (game_id, type, payload)
        values (
          current_game.id,
          'zone_shrink',
          jsonb_build_object(
            'stage', stage_index,
            'factor', stages[stage_index],
            'radius_m', round(public.effective_radius_m(current_game.id)::numeric, 1)
          )
        );
      end if;

      next_stage := current_game.zone_stage + 1;
      if next_stage <= stage_count then
        next_start := current_game.live_at
          + make_interval(secs => (extract(epoch from (current_game.ends_at - current_game.live_at)) * (next_stage - 1) / stage_count));
        if now() >= next_start - interval '60 seconds' and not exists (
          select 1 from public.events e
          where e.game_id = current_game.id
            and e.type = 'zone_warning'
            and (e.payload->>'stage')::integer = next_stage
        ) then
          insert into public.events (game_id, type, payload)
          values (
            current_game.id,
            'zone_warning',
            jsonb_build_object(
              'stage', next_stage,
              'starts_in_s', greatest(0, floor(extract(epoch from (next_start - now())))::integer)
            )
          );
        end if;
      end if;
    end if;
  end if;

  -- Jailbreak mode passive processing
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    v_auto_release_s := coalesce(
      (current_game.mode_params->'jailbreak'->>'auto_release_s')::int,
      300
    );

    for jailed_rec in
      select p.id, p.user_id, p.tagged_at as jailed_at, pr.display_name
      from public.players p
      join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id
        and p.status = 'jailed'
        and p.tagged_at is not null
        and now() >= p.tagged_at + make_interval(secs => v_auto_release_s)
    loop
      update public.players
        set status = 'active', tagged_at = null, status_detail = status_detail - 'free_started_at'
        where id = jailed_rec.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'player_released', 'all',
        jsonb_build_object(
          'player_id', jailed_rec.id,
          'display_name', jailed_rec.display_name,
          'reason', 'auto_release'
        )
      );
    end loop;

    select count(*) into active_runners_count
      from public.players p
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active';

    if active_runners_count = 0 then
      perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  -- Assassin Ring mode passive processing
  if current_game.status = 'live'
     and current_game.mode_id = 'assassin_ring'
     and current_game.live_at is not null
     and now() >= current_game.live_at + interval '180 seconds' then
    for offline_rec in
      select ra.id as assignment_id, ra.hunter_player_id, ra.prey_player_id, pr.display_name
      from public.ring_assignments ra
      join public.players prey_p on prey_p.id = ra.prey_player_id
      join public.profiles pr on pr.id = prey_p.user_id
      left join public.player_positions pp on pp.player_id = prey_p.id
      where ra.game_id = current_game.id
        and ra.status = 'active'
        and prey_p.status = 'active'
        and (pp.recorded_at is null or pp.recorded_at < now() - interval '180 seconds')
    loop
      select ra2.prey_player_id into v_next_prey_id
      from public.ring_assignments ra2
      where ra2.game_id = current_game.id and ra2.hunter_player_id = offline_rec.prey_player_id and ra2.status = 'active';

      if v_next_prey_id is not null and v_next_prey_id <> offline_rec.hunter_player_id then
        update public.players set status = 'tagged', tagged_at = now() where id = offline_rec.prey_player_id;
        update public.ring_assignments ra set status = 'eliminated', eliminated_at = now()
          where ra.game_id = current_game.id and ra.prey_player_id = offline_rec.prey_player_id and ra.status = 'active';
        update public.ring_assignments ra set status = 'relinked' where ra.id = offline_rec.assignment_id;

        insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
        values (current_game.id, offline_rec.hunter_player_id, v_next_prey_id, 'active');

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'player_timed_out', 'all',
          jsonb_build_object(
            'player_id', offline_rec.prey_player_id,
            'display_name', offline_rec.display_name,
            'reason', 'offline_timeout'
          )
        );
      end if;
    end loop;

    select count(*) into active_survivors_count
    from public.players sp
    where sp.game_id = current_game.id and sp.status = 'active';

    if active_survivors_count <= 1 then
      perform public.end_game(current_game.id, 'solo', 'last_survivor');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  -- Relay Heist: carrier offline auto-drop
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    for pkg_offline in
      select e.id as entity_id, p.id as carrier_id, pr.display_name, pp.geog as carrier_geog
      from public.entities e
      join public.players p on p.id = (e.state->>'carrier_player_id')::uuid
      join public.profiles pr on pr.id = p.user_id
      left join public.player_positions pp on pp.player_id = p.id
      where e.game_id = current_game.id
        and e.kind = 'package'
        and (e.state->>'status') = 'carried'
        and (pp.recorded_at is null or pp.recorded_at < now() - interval '60 seconds')
    loop
      update public.entities e
      set geog = coalesce(pkg_offline.carrier_geog, e.geog),
          state = jsonb_build_object(
            'status', 'dropped',
            'carrier_player_id', null,
            'dropped_at', now(),
            'securing_hunter_id', null,
            'securing_started_at', null
          ),
          visible_to = 'all',
          updated_at = now()
      where e.id = pkg_offline.entity_id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'package_dropped', 'all',
        jsonb_build_object(
          'carrier_id', pkg_offline.carrier_id,
          'carrier_name', pkg_offline.display_name,
          'reason', 'carrier_offline',
          'message', 'The carrier went offline. The package was dropped!'
        )
      );
    end loop;
  end if;

  -- Ghost NPC simulation loop for Haunted Map & Ghost Duel
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    for ghost_rec in
      select id, state, geog from public.entities
      where entities.game_id = current_game.id and kind = 'ghost'
    loop
      patrol_geom := null;
      if ghost_rec.state ? 'path_wkt' then
        patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
      elsif ghost_rec.state ? 'path_geojson' then
        patrol_geom := extensions.st_geomfromgeojson(ghost_rec.state->>'path_geojson');
      end if;

      if patrol_geom is not null and extensions.st_geometrytype(patrol_geom) in ('ST_LineString', 'ST_MultiLineString') then
        duration_s := coalesce((ghost_rec.state->>'duration_s')::int, 300);
        path_len_m := extensions.st_length(patrol_geom::extensions.geography);
        effective_duration_s := greatest(30, least(1800, coalesce(duration_s, round(path_len_m / 1.3)::int)));

        elapsed_s := extract(epoch from (now() - coalesce((ghost_rec.state->>'t0')::timestamptz, current_game.live_at)));
        loop_frac := (elapsed_s / effective_duration_s::float) - floor(elapsed_s / effective_duration_s::float);
        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);

        for runner_fix in
          select p.id as runner_id, pr.display_name as runner_name, pp.geog,
                 pp.accuracy_m, pp.recorded_at,
                 extensions.st_distance(pp.geog, current_ghost_pt::extensions.geography) as dist_m
          from public.players p
          join public.profiles pr on pr.id = p.user_id
          join public.player_positions pp on pp.player_id = p.id
          where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
            and pp.recorded_at > now() - interval '20 seconds'
            and coalesce(pp.accuracy_m, 10.0) <= 30.0
        loop
          if runner_fix.dist_m <= 40.0 then
            if current_game.ghost_mode = 'assist' then
              if not exists (
                select 1 from public.pings pi
                where pi.game_id = current_game.id
                  and pi.player_id = runner_fix.runner_id
                  and pi.reason = 'ghost_sighting'
                  and pi.released_at > now() - interval '30 seconds'
              ) then
                update public.games g set ping_seq = g.ping_seq + 1
                  where g.id = current_game.id
                  returning g.ping_seq into v_ghost_ping_seq;

                insert into public.pings (
                  game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
                ) values (
                  current_game.id,
                  v_ghost_ping_seq,
                  runner_fix.runner_id,
                  runner_fix.geog,
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

          if runner_fix.dist_m <= 12.0 then
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
            if v_dwells ? runner_fix.runner_id::text then
              v_dwells := v_dwells - runner_fix.runner_id::text;
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

  -- Relay Heist: carrier extra radar ping release (1.5x cadence)
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    for carrier_rec in
      select p.id as carrier_id, pp.geog as carrier_geog, pp.accuracy_m, pp.recorded_at,
             (e.state->>'next_carrier_ping_at')::timestamptz as next_carrier_ping
      from public.entities e
      join public.players p on p.id = (e.state->>'carrier_player_id')::uuid
      join public.player_positions pp on pp.player_id = p.id
      where e.game_id = current_game.id
        and e.kind = 'package'
        and (e.state->>'status') = 'carried'
        and p.status = 'active'
        and pp.recorded_at > now() - interval '2 minutes'
    loop
      if carrier_rec.next_carrier_ping is null then
        update public.entities e
        set state = jsonb_set(e.state, '{next_carrier_ping_at}', to_jsonb((now() + make_interval(secs => greatest(10, floor(current_game.ping_interval_s / 1.5)::int)))::text))
        where e.game_id = current_game.id and e.kind = 'package';
      elsif now() >= carrier_rec.next_carrier_ping then
        update public.entities e
        set state = jsonb_set(e.state, '{next_carrier_ping_at}', to_jsonb((now() + make_interval(secs => greatest(10, floor(current_game.ping_interval_s / 1.5)::int)))::text))
        where e.game_id = current_game.id and e.kind = 'package';

        update public.games g set ping_seq = g.ping_seq + 1
          where g.id = current_game.id
          returning g.ping_seq into v_carrier_ping_seq;

        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id,
          v_carrier_ping_seq,
          carrier_rec.carrier_id,
          carrier_rec.carrier_geog,
          carrier_rec.accuracy_m,
          greatest(0, floor(extract(epoch from (now() - carrier_rec.recorded_at)))::integer),
          'carrier_radar',
          now()
        );
      end if;
    end loop;
  end if;

  -- Scheduled radar ping release
  if current_game.status = 'live'
     and current_game.next_ping_at is not null
     and now() >= current_game.next_ping_at then
    next_ping := current_game.next_ping_at;
    while next_ping <= now() loop
      next_ping := next_ping + make_interval(secs => current_game.ping_interval_s);
    end loop;

    update public.games g set
      ping_seq = g.ping_seq + 1,
      next_ping_at = next_ping
      where g.id = current_game.id
      returning * into current_game;

    for runner in
      select p.id, pp.geog, pp.accuracy_m, pp.recorded_at, p.status_detail
      from public.players p
      join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and (
          (current_game.mode_id <> 'assassin_ring' and p.team = 'runner' and p.status = 'active')
          or (current_game.mode_id = 'assassin_ring' and p.status = 'active')
        )
        and pp.recorded_at > now() - interval '2 minutes'
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

      if current_game.mode_id = 'assassin_ring' and exists (
        select 1 from public.entities e
        where e.game_id = current_game.id and e.kind = 'safe_zone'
          and extensions.st_dwithin(e.geog, runner.geog, coalesce((e.state->>'radius_m')::int, 20))
      ) then
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
  end if;

  -- Match expiry
  if current_game.status = 'live'
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
    if current_game.mode_id = 'assassin_ring' then
      perform public.end_game(current_game.id, 'solo', 'time_expired');
    elsif current_game.mode_id in ('tag_hunt', 'jailbreak') then
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    else
      perform public.end_game(current_game.id, 'hunters', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
    return current_game.status;
  end if;

  return current_game.status;
end;
$$;

-- 5. get_game_state ------------------------------------------------------------

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
      'ghost_mode', g.ghost_mode,
      'jail', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = g.id and e.kind = 'jail'
        limit 1
      )
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
        'jailed_at', case when p.status = 'jailed' then p.tagged_at else null end,
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
        and (
          g.status in ('ended', 'cancelled')
          or p.id = mine.id
          or (mine.team <> 'solo' and p.team = mine.team and p.status <> 'jailed')
        )
    ), '[]'::jsonb),
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ping.id,
        'seq', ping.seq,
        'player_id', ping.player_id,
        'longitude', extensions.st_x(ping.geog::extensions.geometry),
        'latitude', extensions.st_y(ping.geog::extensions.geometry),
        'position_age_s', ping.position_age_s,
        'reason', ping.reason,
        'released_at', ping.released_at
      ) order by ping.seq)
      from public.pings ping
      where ping.game_id = g.id
        and (
          g.status in ('ended', 'cancelled')
          or (
            ping.released_at >= now() - make_interval(secs => coalesce(g.ping_visible_s, 10))
            and (
              g.mode_id <> 'assassin_ring'
              or ping.player_id = (
                select ra.prey_player_id from public.ring_assignments ra
                where ra.game_id = g.id and ra.hunter_player_id = mine.id and ra.status = 'active'
              )
            )
          )
        )
    ), '[]'::jsonb),
    'assassin_ring', case
      when g.mode_id = 'assassin_ring' then jsonb_build_object(
        'my_prey', (
          select jsonb_build_object(
            'player_id', prey_p.id,
            'display_name', prey_pr.display_name,
            'color', prey_pr.color,
            'status', prey_p.status
          )
          from public.ring_assignments ra
          join public.players prey_p on prey_p.id = ra.prey_player_id
          join public.profiles prey_pr on prey_pr.id = prey_p.user_id
          where ra.game_id = g.id
            and ra.hunter_player_id = mine.id
            and ra.status = 'active'
        ),
        'hunter_proximity', (
          select case
            when hunter_pp.geog is null or my_pp.geog is null then 'none'
            when extensions.st_dwithin(hunter_pp.geog, my_pp.geog, 40) then 'close'
            when extensions.st_dwithin(hunter_pp.geog, my_pp.geog, 100) then 'near'
            else 'none'
          end
          from public.ring_assignments ra
          join public.player_positions hunter_pp on hunter_pp.player_id = ra.hunter_player_id
          left join public.player_positions my_pp on my_pp.player_id = mine.id
          where ra.game_id = g.id
            and ra.prey_player_id = mine.id
            and ra.status = 'active'
        ),
        'safe_zones', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id,
            'zone_index', coalesce((e.state->>'zone_index')::int, 1),
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 20)
          ))
          from public.entities e
          where e.game_id = g.id and e.kind = 'safe_zone'
        ), '[]'::jsonb),
        'in_safe_zone', exists (
          select 1 from public.entities e
          join public.player_positions pp on pp.player_id = mine.id
          where e.game_id = g.id and e.kind = 'safe_zone'
            and extensions.st_dwithin(e.geog, pp.geog, coalesce((e.state->>'radius_m')::int, 20))
        ),
        'active_survivors', (
          select count(*) from public.players sp where sp.game_id = g.id and sp.status = 'active'
        )
      )
      else null
    end,
    'relay_heist', case
      when g.mode_id = 'relay_heist' then jsonb_build_object(
        'extraction', (
          select jsonb_build_object(
            'id', e.id,
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 25)
          )
          from public.entities e
          where e.game_id = g.id and e.kind = 'extraction'
          limit 1
        ),
        'package', (
          select case
            when (e.state->>'status') = 'dropped' then
              jsonb_build_object(
                'status', 'dropped',
                'longitude', extensions.st_x(e.geog::extensions.geometry),
                'latitude', extensions.st_y(e.geog::extensions.geometry),
                'dropped_at', e.state->>'dropped_at',
                'securing_hunter_id', e.state->>'securing_hunter_id',
                'securing_started_at', e.state->>'securing_started_at'
              )
            when mine.team = 'runner' or g.status in ('ended', 'cancelled') then
              jsonb_build_object(
                'status', 'carried',
                'carrier_player_id', e.state->>'carrier_player_id',
                'is_carrier', ((e.state->>'carrier_player_id') = mine.id::text),
                'longitude', extensions.st_x(e.geog::extensions.geometry),
                'latitude', extensions.st_y(e.geog::extensions.geometry),
                'handoff_pending_to', e.state->>'handoff_pending_to',
                'handoff_expires_at', e.state->>'handoff_expires_at'
              )
            else
              jsonb_build_object(
                'status', 'carried'
              )
          end
          from public.entities e
          where e.game_id = g.id and e.kind = 'package'
          limit 1
        ),
        'is_carrier', exists (
          select 1 from public.entities e
          where e.game_id = g.id and e.kind = 'package'
            and (e.state->>'carrier_player_id') = mine.id::text
            and (e.state->>'status') = 'carried'
        ),
        'handoff_pending_from', (
          select e.state->>'carrier_player_id'
          from public.entities e
          where e.game_id = g.id and e.kind = 'package'
            and (e.state->>'handoff_pending_to') = mine.id::text
            and (e.state->>'handoff_expires_at')::timestamptz > now()
          limit 1
        )
      )
      else null
    end,
    'target', case
      when mine.team = 'runner' or g.status in ('ended', 'cancelled') then (
        select jsonb_build_object(
          'longitude', extensions.st_x(t.geog::extensions.geometry),
          'latitude', extensions.st_y(t.geog::extensions.geometry)
        )
        from public.targets t where t.game_id = g.id
      )
      else null
    end,
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
        select * from public.events ev
        where ev.game_id = g.id
          and (
            (ev.target_player is null and (ev.audience = 'all' or ev.audience = mine.team::text))
            or ev.target_player = mine.id
          )
        order by ev.id desc limit 50
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
