-- Migration: 20261112008000_b4_vip_escort_fix_canonical_rpcs.sql
-- Fix start_game() return keys (include legacy head_start_at, live_at alongside countdown_ends, live_starts)
-- Fix get_game_state() to return events, heat_marks, heat_charges, target, and relay_heist

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

      update public.players p
      set secret_role = 'vip',
          status_detail = jsonb_build_object('is_vip', true, 'swap_cooldown_until', null)
      where p.id = chosen_vip_id;

      update public.players p
      set secret_role = 'bodyguard',
          status_detail = jsonb_build_object('is_vip', false, 'frozen_until', null, 'swap_cooldown_until', null)
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active' and p.id <> chosen_vip_id;

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
  on conflict on constraint team_resources_pkey do update
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
    'head_start_at', countdown_ends,
    'live_at', live_starts,
    'next_ping_at', current_game.next_ping_at,
    'ends_at', round_ends,
    'countdown_ends', countdown_ends,
    'live_starts', live_starts,
    'roles', current_game.roles
  );
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- Canonical get_game_state() including all mode extensions, events, heat_marks, and heat_charges
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

  select * into current_game from public.games g where g.id = get_game_state.game_id;
  select * into mine from public.players p where p.game_id = get_game_state.game_id and p.user_id = caller_id;

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
          where e.game_id = g.id and e.kind in ('extraction', 'extraction_point')
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
          'latitude', extensions.st_y(t.geog::extensions.geometry),
          'radius_m', g.target_radius_m
        )
        from public.targets t
        where t.game_id = g.id
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
  where g.id = get_game_state.game_id;

  return snapshot;
end;
$$;

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;
