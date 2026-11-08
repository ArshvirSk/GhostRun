-- Migration: 20261118018000_vm2_fix_start_game_player_status.sql
-- VM2 Hotfix: Remove invalid player_status enum check in start_game
-- (player_status enum only allows 'active', 'tagged', 'jailed', 'left'; 'lobby' and 'joined' do not exist)

-- 1. Canonical start_game -----------------------------------------------------
create or replace function public.start_game(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  active_runners integer;
  active_hunters integer;
  field_runners integer;
  field_hunters integer;
  unassigned integer;
  active_total integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  round_ends timestamptz;
  safe_zone_count integer;
  chosen_carrier_id uuid;
  chosen_vip_id uuid;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
  v_pulse_int integer;
  v_gm_interval integer;
  v_gm_max integer;
  v_new_mode_params jsonb;
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

  -- For Ghost Duel mode, enforce correct team assignment for solo player based on variant
  if current_game.mode_id = 'ghost_duel' then
    update public.players
    set team = case when coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial') = 'mirror_chase' then 'hunter'::public.team_type else 'runner'::public.team_type end
    where players.game_id = current_game.id and players.status = 'active';
  end if;

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'runner' and not p.is_remote),
         count(*) filter (where p.team = 'hunter' and not p.is_remote),
         count(*) filter (where p.team = 'unassigned'),
         count(*)
    into active_runners, active_hunters, field_runners, field_hunters, unassigned, active_total
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
    -- Operator Role: require at least 1 field player per squad
    if 'operator' = any(current_game.roles) then
      if field_runners = 0 then
        raise exception 'Runners require at least one active field runner.';
      end if;
      if field_hunters = 0 then
        raise exception 'Hunters require at least one active field hunter.';
      end if;
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

  -- VIP Escort: exactly 1 runner is VIP, other runners become bodyguard
  if 'vip' = any(current_game.roles) then
    select p.id into chosen_vip_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote
    order by random()
    limit 1;

    if chosen_vip_id is not null then
      update public.players
      set secret_role = 'vip'
      where id = chosen_vip_id;

      update public.players
      set secret_role = 'bodyguard'
      where players.game_id = current_game.id and players.team = 'runner' and players.status = 'active' and players.id <> chosen_vip_id and not players.is_remote;
    else
      raise exception '%', jsonb_build_object(
        'error', jsonb_build_object(
          'role', 'vip',
          'reason', 'VIP Escort requires at least 2 active field runners (1 VIP + 1 bodyguard).'
        )
      );
    end if;
  end if;

  -- Double Agent assignment (exclude remote operators)
  if 'double_agent' = any(current_game.roles) and current_game.mode_id <> 'assassin_ring' then
    if field_hunters >= 2 then
      select p.id into chosen_agent_id
      from public.players p
      where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active' and not p.is_remote
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
          'reason', 'Double Agent requires at least 2 active field hunters.'
        )
      );
    end if;
  end if;

  -- Territory Pulse setup: spawn 7 sector zones and initialize mode parameters
  if current_game.mode_id = 'territory_pulse' then
    perform public.spawn_territory_zones(current_game.id);
    v_pulse_int := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90);
    v_new_mode_params := coalesce(current_game.mode_params, '{}'::jsonb);
    v_new_mode_params := jsonb_set(
      v_new_mode_params,
      '{territory_pulse}',
      jsonb_build_object(
        'pulse_interval_s', v_pulse_int,
        'next_pulse_at', clock_timestamp() + make_interval(secs => 10 + current_game.head_start_s + v_pulse_int),
        'scores', jsonb_build_object('runner', 0, 'hunter', 0),
        'dominance_pct', 70,
        'consecutive_dominance', jsonb_build_object('runner', 0, 'hunter', 0)
      )
    );
    update public.games set mode_params = v_new_mode_params where id = current_game.id;
  end if;

  -- AI Game Master setup
  if 'ai_gm' = any(current_game.modifiers) then
    v_gm_interval := coalesce((current_game.mode_params->'ai_gm'->>'event_interval_s')::int, 180);
    v_gm_max := coalesce((current_game.mode_params->'ai_gm'->>'max_events')::int, 12);
    v_new_mode_params := coalesce(current_game.mode_params, '{}'::jsonb);
    v_new_mode_params := jsonb_set(
      v_new_mode_params,
      '{ai_gm}',
      jsonb_build_object(
        'event_interval_s', v_gm_interval,
        'max_events', v_gm_max,
        'event_count', 0,
        'next_event_at', clock_timestamp() + make_interval(secs => 10 + current_game.head_start_s + v_gm_interval),
        'shrink_scale', 1.0,
        'fog_ends_at', null,
        'last_event_type', null,
        'last_narration', null
      )
    );
    update public.games set mode_params = v_new_mode_params where id = current_game.id;
  end if;

  -- Spawn NPC ghosts if in haunted_map or ghost_duel
  if current_game.mode_id in ('haunted_map', 'ghost_duel') then
    perform public.spawn_ghost_npcs(current_game.id);
  end if;

  -- Spawn drops if dead_drops modifier is active
  if 'dead_drops' = any(current_game.modifiers) then
    perform public.spawn_drops(current_game.id);
  end if;

  -- For Relay Heist mode, assign initial carrier
  if current_game.mode_id = 'relay_heist' then
    select p.id into chosen_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and not p.is_remote
    order by random()
    limit 1;

    if chosen_carrier_id is not null then
      update public.entities
      set state = jsonb_build_object('carrier_player_id', chosen_carrier_id, 'status', 'carried', 'next_carrier_ping_at', clock_timestamp() + make_interval(secs => greatest(10, current_game.ping_interval_s * 2 / 3)))
      where entities.game_id = current_game.id and entities.kind = 'package';

      update public.players
      set status_detail = jsonb_build_object('is_carrier', true)
      where id = chosen_carrier_id;

      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id,
        'carrier_assigned',
        chosen_carrier_id,
        'runner',
        jsonb_build_object('message', 'You are carrying the package! Reach the extraction point.')
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
        next_ping_at = live_starts + make_interval(secs => current_game.ping_interval_s),
        ping_seq = 0
    where g.id = current_game.id;

  insert into public.events (game_id, type, payload)
    values (current_game.id, 'game_started', jsonb_build_object('status', 'countdown'));

  return jsonb_build_object('status', 'countdown', 'head_start_at', countdown_ends, 'live_at', live_starts);
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;
