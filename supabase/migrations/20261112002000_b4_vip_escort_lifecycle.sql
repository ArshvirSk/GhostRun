-- Migration: 20261112002000_b4_vip_escort_lifecycle.sql
-- VIP Escort lifecycle integration:
-- 1. start_game (role assignment)
-- 2. apply_tag & attempt_tag (VIP elimination vs Bodyguard 60s freeze)
-- 3. submit_position (VIP-only target arrival in Classic Chase)
-- 4. advance_game (VIP offline auto-promotion and return public.game_status)
-- 5. get_game_state (runner squad role visibility, hunter secrecy, frozen_until)

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
  chosen_carrier_id uuid;
  chosen_vip_id uuid;
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

  -- For Relay Heist mode, extraction point must be placed before start
  if current_game.mode_id = 'relay_heist' then
    if not exists (select 1 from public.entities e where e.game_id = current_game.id and e.kind in ('extraction', 'extraction_point')) then
      raise exception 'Place the extraction point before starting the round.';
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

  -- Double Agent assignment
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

  -- VIP Escort assignment
  if 'vip' = any(current_game.roles) and current_game.mode_id not in ('assassin_ring', 'relay_heist') then
    if active_runners >= 2 then
      select p.id into chosen_vip_id
      from public.players p
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
      order by random()
      limit 1;

      update public.players
      set secret_role = 'vip',
          status_detail = jsonb_build_object('is_vip', true, 'swap_cooldown_until', null)
      where id = chosen_vip_id;

      update public.players
      set secret_role = 'bodyguard',
          status_detail = jsonb_build_object('is_vip', false, 'frozen_until', null, 'swap_cooldown_until', null)
      where game_id = current_game.id and team = 'runner' and status = 'active' and id <> chosen_vip_id;

      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id,
        'vip_assigned',
        chosen_vip_id,
        'runner',
        jsonb_build_object('message', 'You are the VIP! Survive and reach extraction.')
      );

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'vip_role_active',
        'runner',
        jsonb_build_object('message', 'VIP Escort is active. Protect your squad VIP!')
      );
    else
      current_game.roles := array_remove(current_game.roles, 'vip');
      update public.games set roles = current_game.roles where id = current_game.id;
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'role_disabled',
        'all',
        jsonb_build_object(
          'role', 'vip',
          'reason', 'VIP Escort requires at least 2 active runners (1 VIP + 1 bodyguard).'
        )
      );
    end if;
  end if;

  countdown_ends := clock_timestamp() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);
  round_ends := live_starts + make_interval(secs => current_game.duration_s);

  update public.games g
    set status = 'countdown',
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = round_ends,
        ping_interval_s = case
          when 'hot_cold' = any(g.modifiers) or g.mode_id = 'hot_cold' then least(900, g.ping_interval_s * 3)
          else g.ping_interval_s
        end,
        next_ping_at = live_starts + make_interval(secs => case
          when 'hot_cold' = any(g.modifiers) or g.mode_id = 'hot_cold' then least(900, g.ping_interval_s * 3)
          else g.ping_interval_s
        end),
        ping_seq = 0,
        roles = current_game.roles
    where g.id = current_game.id
    returning * into current_game;

  if current_game.mode_id in ('haunted_map', 'ghost_duel') then
    perform public.spawn_ghost_npcs(current_game.id);
  end if;

  if 'dead_drops' = any(current_game.modifiers) then
    perform public.spawn_drops(start_game.game_id, null);
  end if;

  -- Relay Heist package carrier
  if current_game.mode_id = 'relay_heist' then
    select p.id into chosen_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
    order by random()
    limit 1;

    if chosen_carrier_id is not null then
      insert into public.entities (
        game_id,
        kind,
        state,
        visible_to
      ) values (
        current_game.id,
        'package',
        jsonb_build_object(
          'carrier_player_id', chosen_carrier_id,
          'status', 'carried',
          'dropped_at', null,
          'securing_hunter_id', null,
          'securing_started_at', null
        ),
        'runner'
      );
    end if;
  end if;

  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, now()),
    (current_game.id, 'hunter', case when 'hot_cold' = any(current_game.modifiers) then 6 else 0 end, now())
  on conflict (game_id, team) do update
    set heat_charges = excluded.heat_charges,
        heat_updated_at = excluded.heat_updated_at;

  insert into public.player_resources (player_id, game_id, tokens, charges, cooldowns)
  select p.id, current_game.id, 0, '{}'::jsonb, '{}'::jsonb
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'game_started',
    'all',
    jsonb_build_object(
      'countdown_ends', countdown_ends,
      'live_starts', live_starts,
      'ends_at', round_ends
    )
  );

  return jsonb_build_object(
    'status', current_game.status,
    'countdown_ends', countdown_ends,
    'live_starts', live_starts,
    'ends_at', round_ends,
    'roles', current_game.roles
  );
end;
$$;

-- 2. apply_tag -----------------------------------------------------------------

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
  is_vip boolean;
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
  is_vip := ('vip' = any(current_game.roles));

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

  -- VIP Escort: branch on secret_role
  if is_vip and target_runner.team = 'runner' then
    if target_runner.secret_role = 'vip' then
      -- VIP eliminated -> Hunters win immediately!
      update public.players p
        set status = 'tagged', tagged_at = now(), is_ready = false
        where p.id = target_runner.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'vip_eliminated', 'all',
        jsonb_build_object(
          'vip_id', target_runner.id,
          'vip_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', 'The VIP (' || runner_name || ') was eliminated by ' || hunter_name || '!'
        )
      );

      perform public.end_game(p_game_id, 'hunters', 'vip_eliminated');
      select * into current_game from public.games g where g.id = p_game_id;

      return jsonb_build_object(
        'success', true,
        'runner_id', target_runner.id,
        'phase', current_game.status,
        'winner', current_game.winner,
        'end_reason', current_game.end_reason
      );

    elsif target_runner.secret_role = 'bodyguard' then
      -- Bodyguard tagged -> Freeze for 60 seconds, do NOT eliminate
      if coalesce((target_runner.status_detail->>'frozen_until')::timestamptz > now(), false) then
        raise exception 'That bodyguard is already frozen.';
      end if;

      update public.players p
      set status_detail = jsonb_set(
        coalesce(status_detail, '{}'::jsonb),
        '{frozen_until}',
        to_jsonb((now() + interval '60 seconds')::text)
      )
      where p.id = target_runner.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'bodyguard_frozen', 'all',
        jsonb_build_object(
          'bodyguard_id', target_runner.id,
          'bodyguard_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'frozen_seconds', 60,
          'message', runner_name || ' is a bodyguard! Frozen for 60 seconds.'
        )
      );

      return jsonb_build_object(
        'success', true,
        'runner_id', target_runner.id,
        'phase', current_game.status,
        'frozen', true,
        'frozen_seconds', 60
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

-- 3. attempt_tag (filter out frozen bodyguards) ---------------------------------

create or replace function public.attempt_tag(game_id uuid)
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
  target_id uuid;
  target_distance double precision;
  v_my_prey_id uuid;
  frozen_target_exists boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = attempt_tag.game_id
      and p.user_id = caller_id
      and p.status = 'active'
    for update;
  if not found then raise exception 'You are not an active player in this game.'; end if;

  perform public.advance_game(attempt_tag.game_id);

  select * into current_game from public.games g
    where g.id = attempt_tag.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Tagging is only available while the round is live.';
  end if;

  if current_game.mode_id <> 'assassin_ring' and me.team <> 'hunter' then
    raise exception 'Only hunters can tag runners.';
  end if;

  if me.last_tag_attempt_at is not null
     and now() - me.last_tag_attempt_at < interval '8 seconds' then
    return jsonb_build_object('success', false, 'reason', 'cooldown');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  -- Safe zone check
  if exists (
    select 1 from public.entities e
    where e.game_id = current_game.id and e.kind = 'safe_zone'
      and extensions.st_dwithin(e.geog, my_pos.geog, coalesce((e.state->>'radius_m')::int, 20))
  ) then
    return jsonb_build_object('success', false, 'reason', 'in_safe_zone');
  end if;

  if current_game.mode_id = 'assassin_ring' then
    select ra.prey_player_id into v_my_prey_id
    from public.ring_assignments ra
    where ra.game_id = current_game.id and ra.hunter_player_id = me.id and ra.status = 'active';

    if v_my_prey_id is null then
      return jsonb_build_object('success', false, 'reason', 'no_prey_assigned');
    end if;

    if exists (
      select 1 from public.entities e
      join public.player_positions pp on pp.player_id = v_my_prey_id
      where e.game_id = current_game.id and e.kind = 'safe_zone'
        and extensions.st_dwithin(e.geog, pp.geog, coalesce((e.state->>'radius_m')::int, 20))
    ) then
      return jsonb_build_object('success', false, 'reason', 'in_safe_zone');
    end if;

    select p.id, extensions.st_distance(pp.geog, my_pos.geog)
      into target_id, target_distance
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.id = v_my_prey_id
      and p.game_id = current_game.id
      and p.status = 'active'
      and pp.recorded_at > now() - interval '20 seconds'
      and extensions.st_distance(pp.geog, my_pos.geog)
          <= current_game.tag_radius_m + least(
               10::double precision,
               (coalesce(my_pos.accuracy_m, 0)::double precision
                + coalesce(pp.accuracy_m, 0)::double precision) / 2
             );

    if target_id is null then
      update public.players p set last_tag_attempt_at = now() where p.id = me.id;
      return jsonb_build_object('success', false, 'reason', 'no_target');
    end if;

  else
    -- Standard Hunter vs Runner modes: pick nearest UN-FROZEN active runner
    select p.id, extensions.st_distance(pp.geog, my_pos.geog)
      into target_id, target_distance
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active'
      and (p.status_detail->>'frozen_until' is null or (p.status_detail->>'frozen_until')::timestamptz <= now())
      and pp.recorded_at > now() - interval '20 seconds'
      and extensions.st_distance(pp.geog, my_pos.geog)
          <= current_game.tag_radius_m + least(
               10::double precision,
               (coalesce(my_pos.accuracy_m, 0)::double precision
                + coalesce(pp.accuracy_m, 0)::double precision) / 2
             )
    order by extensions.st_distance(pp.geog, my_pos.geog) asc
    limit 1;

    if target_id is null then
      -- Check if only a frozen bodyguard was in range
      select exists (
        select 1
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.status = 'active'
          and (p.status_detail->>'frozen_until')::timestamptz > now()
          and pp.recorded_at > now() - interval '20 seconds'
          and extensions.st_distance(pp.geog, my_pos.geog)
              <= current_game.tag_radius_m + least(
                   10::double precision,
                   (coalesce(my_pos.accuracy_m, 0)::double precision
                    + coalesce(pp.accuracy_m, 0)::double precision) / 2
                 )
      ) into frozen_target_exists;

      if frozen_target_exists then
        return jsonb_build_object('success', false, 'reason', 'already_frozen');
      end if;

      update public.players p set last_tag_attempt_at = now() where p.id = me.id;
      return jsonb_build_object('success', false, 'reason', 'no_target');
    end if;
  end if;

  return public.apply_tag(current_game.id, me.id, target_id, target_distance);
end;
$$;

-- 4. submit_position (VIP extraction gate) --------------------------------------

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
  client_time timestamptz;
  fix_geog geography;
  v_in_bounds boolean;
  v_prev_out timestamptz;
  v_prev_noise integer;
  v_prev_speed real;
  v_prev_speed_at timestamptz;
  v_smoothed_speed real;
  v_noise integer;
  v_prev_anchor geography;
  v_prev_anchor_since timestamptz;
  v_anchor geography;
  v_anchor_since timestamptz;
  v_camp_seq integer;
  v_noise_seq integer;
  v_radius real;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = submit_position.game_id
      and p.user_id = caller_id
      and p.status in ('active', 'jailed')
    for update;
  if not found then raise exception 'You are not an active player in this game.'; end if;

  perform public.advance_game(submit_position.game_id);

  select * into current_game from public.games g
    where g.id = submit_position.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status = 'ended' then
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
    when submit_position.heading is null or submit_position.heading < 0 then null
    else (submit_position.heading::numeric % 360)::real
  end;

  client_time := coalesce(submit_position.recorded_at, now());
  if client_time > now() + interval '5 seconds' then fix_time := now();
  elsif client_time < now() - interval '2 minutes' then fix_time := now();
  else fix_time := client_time;
  end if;

  fix_geog := extensions.st_setsrid(
    extensions.st_makepoint(submit_position.lng, submit_position.lat), 4326
  )::geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_dwithin(fix_geog, current_game.area_center, v_radius);

  select pp.out_of_bounds_since, pp.noise, pp.smoothed_speed_mps, pp.updated_at,
         pp.anchor_geog, pp.anchor_since, pp.fast_since, pp.vehicle_warned
    into v_prev_out, v_prev_noise, v_prev_speed, v_prev_speed_at,
         v_prev_anchor, v_prev_anchor_since, v_prev_fast_since, v_prev_vehicle_warned
    from public.player_positions pp
    where pp.player_id = me.id;

  v_fast_since := v_prev_fast_since;
  v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);

  if v_speed is not null and v_speed >= 8.0 then
    if v_fast_since is null then v_fast_since := now();
    elsif (now() - v_fast_since) >= interval '10 seconds' and not v_vehicle_warned then
      v_vehicle_warned := true;
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'vehicle_warning',
        'all',
        jsonb_build_object(
          'player_id', me.id,
          'display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id),
          'message', 'Vehicle speeds detected. Please play safely on foot.'
        )
      );
    end if;
  else
    v_fast_since := null;
    v_vehicle_warned := false;
  end if;

  if 'noise_meter' = any(current_game.modifiers) and me.team = 'runner' then
    if v_speed is not null and (v_accuracy is null or v_accuracy <= 50) then
      v_smoothed_speed := case
        when v_prev_speed is null then v_speed
        else (0.3 * v_speed + 0.7 * v_prev_speed)::real
      end;
    else
      v_smoothed_speed := coalesce(v_prev_speed, 0);
    end if;

    v_noise := coalesce(v_prev_noise, 0);
    if v_smoothed_speed >= 4.0 then v_noise := least(100, v_noise + 10);
    elsif v_smoothed_speed >= 2.8 then v_noise := least(100, v_noise + 4);
    elsif v_smoothed_speed <= 1.6 then v_noise := greatest(0, v_noise - 3);
    end if;

    if v_noise >= 100 then
      select coalesce(max(seq), 0) + 1 into v_noise_seq
        from public.pings
        where game_id = current_game.id;
      insert into public.pings (game_id, seq, geog, reason, visible_until)
      values (
        current_game.id,
        v_noise_seq,
        fix_geog,
        'noise',
        now() + make_interval(secs => current_game.ping_visible_s)
      );
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'noise_ping',
        'all',
        jsonb_build_object('player_id', me.id, 'seq', v_noise_seq)
      );
      v_noise := 40;
    end if;

    if v_prev_anchor is null then
      v_anchor := fix_geog;
      v_anchor_since := now();
    else
      if extensions.st_distance(fix_geog, v_prev_anchor) > 10 then
        v_anchor := fix_geog;
        v_anchor_since := now();
      else
        v_anchor := v_prev_anchor;
        v_anchor_since := coalesce(v_prev_anchor_since, now());
        if now() - v_anchor_since >= interval '45 seconds' then
          select coalesce(max(seq), 0) + 1 into v_camp_seq
            from public.pings
            where game_id = current_game.id;
          insert into public.pings (game_id, seq, geog, reason, visible_until)
          values (
            current_game.id,
            v_camp_seq,
            fix_geog,
            'camping_runner',
            now() + make_interval(secs => current_game.ping_visible_s)
          );
          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id,
            'camping_ping',
            'all',
            jsonb_build_object('player_id', me.id)
          );
          v_anchor_since := now();
        end if;
      end if;
    end if;
  end if;

  -- Mock location detection
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
    coalesce(submit_position.is_mock, false),
    fix_time, now(),
    case
      when not v_in_bounds and v_prev_out is null then now()
      when not v_in_bounds then v_prev_out
      else null
    end,
    v_noise, coalesce(v_noise >= 60, false), v_smoothed_speed, v_anchor, v_anchor_since,
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
    insert into public.trail_points (
      player_id, game_id, geog, accuracy_m, speed_mps, heading, recorded_at
    )
    select me.id, current_game.id, fix_geog, v_accuracy, v_speed, v_heading, fix_time
    where not exists (
      select 1 from public.trail_points tp
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

  -- Classic Chase extraction arrival: if VIP Escort role is active, ONLY VIP can trigger target reached!
  if current_game.status = 'live'
     and current_game.mode = 'classic_chase'
     and me.team = 'runner'
     and (
       not ('vip' = any(current_game.roles))
       or me.secret_role = 'vip'
     )
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
       join public.entities e_ext on e_ext.game_id = current_game.id and e_ext.kind in ('extraction', 'extraction_point')
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
    'smoothed_speed_mps', v_smoothed_speed,
    'fast_since', v_fast_since,
    'vehicle_warned', v_vehicle_warned
  );
end;
$$;

-- 5. advance_game (VIP offline auto-promotion, canonical returns public.game_status) --

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
  active_vip public.players%rowtype;
  promoted_bodyguard public.players%rowtype;
  promoted_name text;
begin
  if caller_id is null or not public.is_member(advance_game.game_id) then
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
          'zone_shrunk',
          jsonb_build_object(
            'stage', stage_index,
            'radius_m', public.effective_radius_m(current_game.id)
          )
        );
      end if;
    end if;
  end if;

  -- Jailbreak auto-release and boundary overrun check
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    v_auto_release_s := coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::int, 300);

    select * into jail_rec
    from public.entities e
    where e.game_id = current_game.id and e.kind = 'jail'
    limit 1;

    for jailed_rec in
      select p.id, pr.display_name, p.tagged_at
      from public.players p
      join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id
        and p.status = 'jailed'
        and p.tagged_at is not null
        and now() - p.tagged_at >= make_interval(secs => v_auto_release_s)
    loop
      update public.players p
        set status = 'active', tagged_at = null
        where p.id = jailed_rec.id;

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
  end if;

  -- Assassin Ring offline auto-relink
  if current_game.status = 'live' and current_game.mode_id = 'assassin_ring' then
    for offline_rec in
      select ra.id as assignment_id, ra.hunter_player_id, ra.prey_player_id, pr.display_name
      from public.ring_assignments ra
      join public.players p on p.id = ra.prey_player_id
      join public.profiles pr on pr.id = p.user_id
      left join public.player_positions pp on pp.player_id = p.id
      where ra.game_id = current_game.id
        and ra.status = 'active'
        and p.status = 'active'
        and (pp.recorded_at is null or pp.recorded_at < now() - interval '180 seconds')
    loop
      update public.players set status = 'tagged', tagged_at = now() where id = offline_rec.prey_player_id;
      update public.ring_assignments set status = 'eliminated', eliminated_at = now() where id = offline_rec.assignment_id;

      select ra.prey_player_id into v_next_prey_id
      from public.ring_assignments ra
      where ra.game_id = current_game.id and ra.hunter_player_id = offline_rec.prey_player_id and ra.status = 'active';

      if v_next_prey_id is not null and v_next_prey_id <> offline_rec.hunter_player_id then
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

  -- Relay Heist carrier offline auto-drop
  if current_game.status = 'live'
     and current_game.mode_id = 'relay_heist'
     and current_game.live_at is not null
     and current_game.live_at < now() - interval '60 seconds' then
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

  -- VIP Escort: Auto-promote nearest bodyguard if VIP is inactive for > 60 s
  if current_game.status = 'live'
     and 'vip' = any(current_game.roles)
     and current_game.live_at is not null
     and current_game.live_at < now() - interval '60 seconds' then
    select * into active_vip from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active';

    if active_vip.id is not null then
      if not exists (
        select 1 from public.player_positions pp
        where pp.player_id = active_vip.id and pp.recorded_at > now() - interval '60 seconds'
      ) then
        select p.* into promoted_bodyguard
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.secret_role = 'bodyguard'
          and p.status = 'active'
          and (p.status_detail->>'frozen_until' is null or (p.status_detail->>'frozen_until')::timestamptz <= now())
          and pp.recorded_at > now() - interval '60 seconds'
        order by extensions.st_distance(
          pp.geog,
          coalesce((select vip_pos.geog from public.player_positions vip_pos where vip_pos.player_id = active_vip.id), current_game.area_center)
        ) asc
        limit 1;

        if promoted_bodyguard.id is not null then
          update public.players set secret_role = 'bodyguard' where id = active_vip.id;
          update public.players
          set secret_role = 'vip',
              status_detail = jsonb_set(coalesce(status_detail, '{}'::jsonb), '{is_vip}', 'true'::jsonb)
          where id = promoted_bodyguard.id;

          select pr.display_name into promoted_name
          from public.profiles pr where pr.id = promoted_bodyguard.user_id;

          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id,
            'vip_promoted',
            'runner',
            jsonb_build_object(
              'promoted_id', promoted_bodyguard.id,
              'promoted_name', promoted_name,
              'reason', 'vip_inactive',
              'message', promoted_name || ' has been promoted to VIP due to inactive VIP!'
            )
          );
        end if;
      end if;
    end if;
  end if;

  -- Ghost NPC simulation loop for Haunted Map & Ghost Duel
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    for ghost_rec in
      select id, state, geog from public.entities
      where entities.game_id = current_game.id and kind = 'ghost'
    loop
      patrol_geom := null;
      if ghost_rec.state ? 'path_wkt' then
        begin
          patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
        exception when others then
          patrol_geom := null;
        end;
      end if;

      if patrol_geom is not null and extensions.st_geometrytype(patrol_geom) = 'ST_LineString' then
        duration_s := coalesce((ghost_rec.state->>'duration_s')::int, 240);
        effective_duration_s := greatest(30, duration_s);

        path_len_m := extensions.st_length(patrol_geom::geography);
        if path_len_m > 0 and (path_len_m / effective_duration_s) > 2.0 then
          effective_duration_s := ceil(path_len_m / 2.0)::int;
        end if;

        elapsed_s := extract(epoch from (now() - current_game.live_at));
        loop_frac := (elapsed_s / effective_duration_s) - floor(elapsed_s / effective_duration_s);
        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        if extensions.st_distance(current_ghost_pt::geography, current_game.area_center) > current_game.area_radius_m then
          current_ghost_pt := extensions.st_project(
            current_game.area_center,
            greatest(10, current_game.area_radius_m - 10),
            extensions.st_azimuth(current_game.area_center::geometry, current_ghost_pt)
          )::geometry;
        end if;

        update public.entities
        set geog = current_ghost_pt::geography, updated_at = now()
        where entities.id = ghost_rec.id;

        -- Proximity hazard check
        v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);
        for runner_fix in
          select pp.player_id, pp.geog, pp.accuracy_m, pr.display_name, p.status
          from public.player_positions pp
          join public.players p on p.id = pp.player_id
          join public.profiles pr on pr.id = p.user_id
          where pp.game_id = current_game.id
            and p.team = 'runner'
            and p.status = 'active'
            and (pp.accuracy_m is null or pp.accuracy_m <= 30)
            and extensions.st_dwithin(pp.geog, current_ghost_pt::geography, 12)
        loop
          v_first_seen := (v_dwells->>(runner_fix.player_id::text))::timestamptz;
          if v_first_seen is null then
            v_dwells := jsonb_set(v_dwells, array[runner_fix.player_id::text], to_jsonb(now()));
          elsif now() - v_first_seen >= interval '3 seconds' then
            update public.players set status = 'tagged', tagged_at = now() where id = runner_fix.player_id;
            insert into public.events (game_id, type, payload)
            values (
              current_game.id, 'runner_haunted',
              jsonb_build_object(
                'player_id', runner_fix.player_id,
                'display_name', runner_fix.display_name,
                'message', runner_fix.display_name || ' was haunted by a patrolling ghost!'
              )
            );
            v_dwells := v_dwells - runner_fix.player_id::text;

            select count(*) into active_runners_count
            from public.players where players.game_id = current_game.id and team = 'runner' and status = 'active';

            if active_runners_count = 0 then
              perform public.end_game(current_game.id, 'hunters', 'all_haunted');
              select * into current_game from public.games g where g.id = advance_game.game_id;
              return current_game.status;
            end if;
          end if;
        end loop;

        update public.entities
        set state = jsonb_set(entities.state, '{dwells}', v_dwells)
        where entities.id = ghost_rec.id;
      end if;
    end loop;
  end if;

  -- Relay Heist: carrier extra pings at 1.5x cadence
  if current_game.status = 'live' and current_game.mode_id = 'relay_heist' then
    select p.id, pp.geog, pp.accuracy_m, pp.recorded_at,
           coalesce((e.state->>'last_carrier_ping_at')::timestamptz, current_game.live_at) as last_ping_at,
           e.id as entity_id
    into carrier_rec
    from public.entities e
    join public.players p on p.id = (e.state->>'carrier_player_id')::uuid
    left join public.player_positions pp on pp.player_id = p.id
    where e.game_id = current_game.id
      and e.kind = 'package'
      and (e.state->>'status') = 'carried'
      and p.status = 'active';

    if carrier_rec.id is not null and carrier_rec.geog is not null then
      if now() >= carrier_rec.last_ping_at + make_interval(secs => greatest(10, (current_game.ping_interval_s / 1.5)::int)) then
        select coalesce(max(seq), 0) + 1 into v_carrier_ping_seq
        from public.pings where game_id = current_game.id;

        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id,
          v_carrier_ping_seq,
          carrier_rec.id,
          carrier_rec.geog,
          carrier_rec.accuracy_m,
          greatest(0, floor(extract(epoch from (now() - carrier_rec.recorded_at)))::integer),
          'carrier_pulse',
          now()
        );

        update public.entities
        set state = jsonb_set(state, '{last_carrier_ping_at}', to_jsonb(now()))
        where id = carrier_rec.entity_id;
      end if;
    end if;
  end if;

  -- Scheduled radar pings
  if current_game.status = 'live'
     and current_game.next_ping_at is not null
     and now() >= current_game.next_ping_at then
    next_ping := current_game.next_ping_at + make_interval(secs => current_game.ping_interval_s);
    while next_ping <= now() loop
      next_ping := next_ping + make_interval(secs => current_game.ping_interval_s);
    end loop;

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
        and (
          (current_game.mode_id <> 'assassin_ring' and p.team = 'runner' and p.status = 'active')
          or (current_game.mode_id = 'assassin_ring' and p.status = 'active')
        )
        and pp.recorded_at > now() - interval '45 seconds'
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

-- 6. get_game_state (reveal teammate roles to runners, keep hidden from hunters) -

create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  snapshot jsonb;
  current_game public.games%rowtype;
  mine public.players%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select * into current_game from public.games where id = get_game_state.game_id;
  select * into mine from public.players where game_id = get_game_state.game_id and user_id = caller_id;

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
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = g.id and e.kind = 'jail'
        limit 1
      ),
      'extraction', (
        select jsonb_build_object(
          'id', e.id,
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 25)
        )
        from public.entities e
        where e.game_id = g.id and e.kind in ('extraction', 'extraction_point')
        limit 1
      ),
      'package', (
        select jsonb_build_object(
          'id', e.id,
          'status', e.state->>'status',
          'carrier_player_id', e.state->>'carrier_player_id',
          'dropped_at', e.state->>'dropped_at',
          'latitude', case when e.geog is not null then extensions.st_y(e.geog::extensions.geometry) else null end,
          'longitude', case when e.geog is not null then extensions.st_x(e.geog::extensions.geometry) else null end
        )
        from public.entities e
        where e.game_id = g.id and e.kind = 'package'
          and (
            e.state->>'status' = 'dropped'
            or mine.team = 'runner'
            or g.status in ('ended', 'cancelled')
          )
        limit 1
      ),
      'vip_escort', case
        when 'vip' = any(g.roles) then jsonb_build_object(
          'is_active', true,
          'vip_player_id', case
            when mine.team = 'runner' or g.status in ('ended', 'cancelled') then (
              select p.id from public.players p
              where p.game_id = g.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active'
              limit 1
            )
            else null
          end
        )
        else null
      end
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
        'frozen_until', p.status_detail->>'frozen_until',
        'pending_role_swap', case when p.id = mine.id then p.status_detail->'pending_role_swap' else null end,
        'secret_role', case
          when g.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          when 'vip' = any(g.roles) and mine.team = 'runner' and p.team = 'runner' then p.secret_role
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
        'safe_zones', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id,
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 20)
          )), '[]'::jsonb)
          from public.entities e
          where e.game_id = g.id and e.kind = 'safe_zone'
        )
      )
      else null
    end,
    'target', case
      when g.status in ('ended', 'cancelled')
           or (mine.team = 'runner' and g.mode = 'classic_chase') then (
        select jsonb_build_object(
          'latitude', extensions.st_y(t.geog::extensions.geometry),
          'longitude', extensions.st_x(t.geog::extensions.geometry),
          'radius_m', g.target_radius_m
        )
        from public.targets t
        where t.game_id = g.id
      )
      else null
    end
  ) into snapshot
  from public.games g
  where g.id = get_game_state.game_id;

  return snapshot;
end;
$$;
