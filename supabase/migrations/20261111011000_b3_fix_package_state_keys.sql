-- Migration: 20261111011000_b3_fix_package_state_keys.sql
-- Fix package state keys in start_game to status = 'carried' and carrier_player_id

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

    -- In assassin_ring, all active players play as 'solo'
    update public.players p
      set team = 'solo'
      where p.game_id = current_game.id and p.status = 'active';

    -- Auto-place 2 safe zones if fewer than 2 exist
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

    -- Generate circular Hamiltonian cycle permutation
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

  -- For Relay Heist mode: designate initial package carrier
  if current_game.mode_id = 'relay_heist' then
    select p.id into chosen_carrier_id
    from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
    order by random()
    limit 1;

    if chosen_carrier_id is null then
      raise exception 'Relay Heist requires at least one active runner.';
    end if;

    delete from public.entities e where e.game_id = current_game.id and e.kind = 'package';

    insert into public.entities (
      game_id,
      kind,
      team,
      geog,
      state,
      visible_to
    ) values (
      current_game.id,
      'package',
      'runner',
      current_game.area_center,
      jsonb_build_object(
        'status', 'carried',
        'carrier_player_id', chosen_carrier_id,
        'handoff_pending_to', null,
        'handoff_expires_at', null,
        'cooldown_until', null
      ),
      'runner'
    );

    insert into public.events (
      game_id,
      type,
      target_player,
      audience,
      payload
    ) values (
      current_game.id,
      'carrier_designated',
      chosen_carrier_id,
      'runner',
      jsonb_build_object(
        'carrier_player_id', chosen_carrier_id,
        'message', 'Package carrier designated'
      )
    );
  end if;

  if 'hot_cold' = any(current_game.modifiers) or current_game.mode_id = 'hot_cold' then
    hunter_heat_charges := coalesce((current_game.mode_params->'hot_cold'->>'heat_charges')::integer, 6);
  end if;

  -- Ensure player_resources rows exist for all active players
  insert into public.player_resources (player_id, game_id)
  select p.id, p.game_id
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  -- Ensure team_resources rows exist for runner and hunter
  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, now()),
    (current_game.id, 'hunter', hunter_heat_charges, now())
  on conflict on constraint team_resources_pkey do update
    set heat_charges = excluded.heat_charges,
        heat_updated_at = excluded.heat_updated_at;

  insert into public.events (game_id, type, payload)
  values (
    start_game.game_id,
    'game_started',
    jsonb_build_object(
      'mode', current_game.mode,
      'mode_id', current_game.mode_id,
      'modifiers', to_jsonb(current_game.modifiers),
      'roles', to_jsonb(current_game.roles),
      'head_start_at', countdown_ends,
      'live_at', live_starts,
      'ends_at', round_ends
    )
  );

  return jsonb_build_object(
    'status', 'countdown',
    'head_start_at', countdown_ends,
    'live_at', live_starts,
    'ends_at', round_ends
  );
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;
