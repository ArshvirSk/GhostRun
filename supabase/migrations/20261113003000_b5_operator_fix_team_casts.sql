-- Migration: 20261113003000_b5_operator_fix_team_casts.sql
-- Fix explicit team_type to text casting in operator entities queries and clock_timestamp() position checks

-- 1. place_marker -------------------------------------------------------------
create or replace function public.place_marker(
  p_game_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_label text default null
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
  v_marker_geog geography;
  v_marker_id uuid;
  v_active_markers int;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games where id = p_game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Tactical markers can only be placed while the round is live.';
  end if;

  select * into me from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;
  if not me.is_remote then
    raise exception 'Only remote Operators can place tactical markers.';
  end if;

  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid marker coordinates.';
  end if;

  v_marker_geog := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::geography;

  if extensions.st_distance(v_marker_geog, current_game.area_center) > current_game.area_radius_m * 1.5 then
    raise exception 'Marker coordinates must be within or near the play area.';
  end if;

  -- Limit to 3 concurrent active markers per team: prune oldest
  select count(*) into v_active_markers
  from public.entities
  where game_id = p_game_id
    and kind = 'marker'
    and team = me.team::text
    and (state->>'expires_at')::timestamptz > clock_timestamp();

  if v_active_markers >= 3 then
    delete from public.entities
    where id in (
      select id from public.entities
      where game_id = p_game_id
        and kind = 'marker'
        and team = me.team::text
        and (state->>'expires_at')::timestamptz > clock_timestamp()
      order by updated_at asc
      limit (v_active_markers - 2)
    );
  end if;

  insert into public.entities (
    game_id, kind, team, geog, state, visible_to, updated_at
  ) values (
    p_game_id,
    'marker',
    me.team::text,
    v_marker_geog,
    jsonb_build_object(
      'label', coalesce(nullif(trim(p_label), ''), 'Tactical Marker'),
      'placed_by', me.id,
      'placed_at', clock_timestamp(),
      'expires_at', clock_timestamp() + interval '90 seconds'
    ),
    me.team::text,
    clock_timestamp()
  ) returning id into v_marker_id;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'marker_placed',
    me.team,
    jsonb_build_object(
      'marker_id', v_marker_id,
      'latitude', p_lat,
      'longitude', p_lng,
      'label', coalesce(nullif(trim(p_label), ''), 'Tactical Marker'),
      'expires_in_s', 90
    )
  );

  return jsonb_build_object(
    'ok', true,
    'marker_id', v_marker_id,
    'latitude', p_lat,
    'longitude', p_lng,
    'label', coalesce(nullif(trim(p_label), ''), 'Tactical Marker'),
    'expires_at', clock_timestamp() + interval '90 seconds'
  );
end;
$$;

revoke all on function public.place_marker(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.place_marker(uuid, double precision, double precision, text) to authenticated;

-- 2. clear_marker -------------------------------------------------------------
create or replace function public.clear_marker(
  p_game_id uuid,
  p_marker_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;

  delete from public.entities
  where id = p_marker_id
    and game_id = p_game_id
    and kind = 'marker'
    and team = me.team::text;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'marker_removed',
    me.team,
    jsonb_build_object('marker_id', p_marker_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.clear_marker(uuid, uuid) from public, anon;
grant execute on function public.clear_marker(uuid, uuid) to authenticated;

-- 3. operator_scan ------------------------------------------------------------
create or replace function public.operator_scan(
  p_game_id uuid,
  p_lat double precision default null,
  p_lng double precision default null
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
  v_last_scan timestamptz;
  v_hunter_geog geography;
  v_bearing double precision;
  v_dist double precision;
  v_fuzzed_geog geography;
  v_scan_geog geography;
  v_runner_count int;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games where id = p_game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Operator scan can only be used while the round is live.';
  end if;
  if not ('operator' = any(current_game.roles)) then
    raise exception 'Operator role is not enabled in this game.';
  end if;

  select * into me from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;
  if not me.is_remote then
    raise exception 'Only remote Operators can trigger tactical reconnaissance scans.';
  end if;

  -- 90-second cooldown check
  select (pr.cooldowns->>'operator_scan')::timestamptz into v_last_scan
  from public.player_resources pr
  where pr.player_id = me.id;

  if v_last_scan is not null and clock_timestamp() - v_last_scan < interval '90 seconds' then
    raise exception 'Operator scan is on cooldown (% seconds remaining).',
      greatest(1, ceil(90 - extract(epoch from (clock_timestamp() - v_last_scan))))::int;
  end if;

  -- Update cooldown
  insert into public.player_resources (player_id, game_id, tokens, charges, cooldowns)
  values (me.id, p_game_id, 0, '{}'::jsonb, jsonb_build_object('operator_scan', clock_timestamp()))
  on conflict (player_id) do update
  set cooldowns = coalesce(public.player_resources.cooldowns, '{}'::jsonb) || jsonb_build_object('operator_scan', clock_timestamp());

  -- Runner Operator Scan: Vague 150m envelope around nearest hunter
  if me.team = 'runner' then
    select pp.geog into v_hunter_geog
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = p_game_id
      and p.team = 'hunter'
      and p.status = 'active'
      and not p.is_remote
      and pp.recorded_at >= clock_timestamp() - interval '45 seconds'
    order by (
      select coalesce(min(extensions.st_distance(pp.geog, rpp.geog)), 999999)
      from public.players rp
      join public.player_positions rpp on rpp.player_id = rp.id
      where rp.game_id = p_game_id and rp.team = 'runner' and rp.status = 'active' and not rp.is_remote
    ) asc
    limit 1;

    if v_hunter_geog is null then
      return jsonb_build_object(
        'ok', true,
        'found', false,
        'scan_type', 'runner_sweep',
        'message', 'No active hunter signals detected within 45 seconds.'
      );
    end if;

    -- Fuzz hunter position by 10 to 30 m using deterministic hash (Decision D19)
    v_bearing := (('x' || substr(md5(p_game_id::text || me.id::text || floor(extract(epoch from clock_timestamp()) / 90)::text || 'bearing'), 1, 8))::bit(32)::bigint % 360)::double precision;
    v_dist := 10.0 + (('x' || substr(md5(p_game_id::text || me.id::text || floor(extract(epoch from clock_timestamp()) / 90)::text || 'dist'), 1, 8))::bit(32)::bigint % 20)::double precision;
    v_fuzzed_geog := extensions.st_project(v_hunter_geog, v_dist, radians(v_bearing));

    -- Ephemeral entity for team map display (valid 10s)
    insert into public.entities (
      game_id, kind, team, geog, state, visible_to, updated_at
    ) values (
      p_game_id,
      'scan_envelope',
      'runner',
      v_fuzzed_geog,
      jsonb_build_object(
        'radius_m', 150,
        'expires_at', clock_timestamp() + interval '10 seconds',
        'scan_type', 'runner_sweep'
      ),
      'runner',
      clock_timestamp()
    );

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id,
      'operator_scan_used',
      'runner',
      jsonb_build_object(
        'scan_type', 'runner_sweep',
        'latitude', round(extensions.st_y(v_fuzzed_geog::geometry)::numeric, 6),
        'longitude', round(extensions.st_x(v_fuzzed_geog::geometry)::numeric, 6),
        'radius_m', 150,
        'valid_for_s', 10,
        'message', 'Tactical sweep detected nearest hunter within 150m envelope.'
      )
    );

    return jsonb_build_object(
      'ok', true,
      'found', true,
      'scan_type', 'runner_sweep',
      'latitude', round(extensions.st_y(v_fuzzed_geog::geometry)::numeric, 6),
      'longitude', round(extensions.st_x(v_fuzzed_geog::geometry)::numeric, 6),
      'radius_m', 150,
      'valid_for_s', 10
    );

  -- Hunter Operator Scan: Sector Proximity Census (Decision D20)
  elsif me.team = 'hunter' then
    if p_lat is null or p_lng is null then
      raise exception 'Sector coordinates (lat, lng) are required for Hunter census scan.';
    end if;

    if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
      raise exception 'Invalid sector coordinates.';
    end if;

    v_scan_geog := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::geography;

    if extensions.st_distance(v_scan_geog, current_game.area_center) > current_game.area_radius_m then
      raise exception 'Scan coordinates must fall within game boundary.';
    end if;

    select count(*) into v_runner_count
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = p_game_id
      and p.team = 'runner'
      and p.status = 'active'
      and not p.is_remote
      and pp.recorded_at >= clock_timestamp() - interval '45 seconds'
      and extensions.st_dwithin(pp.geog, v_scan_geog, 200);

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id,
      'operator_scan_used',
      'hunter',
      jsonb_build_object(
        'scan_type', 'hunter_census',
        'latitude', p_lat,
        'longitude', p_lng,
        'radius_m', 200,
        'count', v_runner_count
      )
    );

    return jsonb_build_object(
      'ok', true,
      'scan_type', 'hunter_census',
      'latitude', p_lat,
      'longitude', p_lng,
      'radius_m', 200,
      'count', v_runner_count
    );
  else
    raise exception 'Unrecognized team for operator scan.';
  end if;
end;
$$;

revoke all on function public.operator_scan(uuid, double precision, double precision) from public, anon;
grant execute on function public.operator_scan(uuid, double precision, double precision) to authenticated;

-- 4. get_game_state -----------------------------------------------------------
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
    'server_time', clock_timestamp(),
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
      'jail_rules', case
        when g.mode_id = 'jailbreak' then jsonb_build_object(
          'auto_release_s', coalesce((g.mode_params->'jailbreak'->>'auto_release_s')::int, 300),
          'release_hold_s', coalesce((g.mode_params->'jailbreak'->>'release_hold_s')::int, 10),
          'release_radius_m', coalesce((g.mode_params->'jailbreak'->>'release_radius_m')::int, 10)
        )
        else null
      end,
      'relay_heist', case
        when g.mode_id = 'relay_heist' then jsonb_build_object(
          'extraction', (
            select jsonb_build_object(
              'latitude', extensions.st_y(e.geog::extensions.geometry),
              'longitude', extensions.st_x(e.geog::extensions.geometry),
              'radius_m', coalesce((e.state->>'radius_m')::int, 25)
            )
            from public.entities e
            where e.game_id = g.id and e.kind = 'extraction'
            limit 1
          ),
          'package_status', (
            select e.state->>'status'
            from public.entities e
            where e.game_id = g.id and e.kind = 'package'
            limit 1
          ),
          'dropped_package_location', case
            when exists (
              select 1 from public.entities e
              where e.game_id = g.id and e.kind = 'package' and e.state->>'status' = 'dropped'
            ) then (
              select jsonb_build_object(
                'latitude', extensions.st_y(e.geog::extensions.geometry),
                'longitude', extensions.st_x(e.geog::extensions.geometry)
              )
              from public.entities e
              where e.game_id = g.id and e.kind = 'package'
              limit 1
            )
            else null
          end,
          'carrier_visible', (
            select case
              when e.state->>'status' = 'dropped' then true
              when mine.team = 'runner' then true
              when g.status in ('ended', 'cancelled') then true
              else false
            end
            from public.entities e
            where e.game_id = g.id and e.kind = 'package'
            limit 1
          )
        )
        else null
      end,
      'vip_escort', case
        when 'vip' = any(g.roles) then jsonb_build_object(
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
    'my_player_id', mine.id,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'team', p.team,
        'status', p.status,
        'is_ready', p.is_ready,
        'is_remote', coalesce(p.is_remote, false),
        'jailed_at', p.jailed_at,
        'frozen_until', p.frozen_until,
        'secret_role', case
          when g.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          when 'vip' = any(g.roles) and mine.team = 'runner' and p.team = 'runner' then p.secret_role
          else null
        end,
        'pending_role_swap', case
          when p.id = mine.id then p.pending_role_swap
          else null
        end,
        'display_name', pr.display_name,
        'color', pr.color,
        'joined_at', p.joined_at
      ) order by p.joined_at)
      from public.players p
      left join public.profiles pr on pr.id = p.user_id
      where p.game_id = g.id and p.status <> 'left'
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', pp.player_id,
        'latitude', extensions.st_y(pp.geog::extensions.geometry),
        'longitude', extensions.st_x(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'speed_mps', pp.speed_mps,
        'heading_deg', pp.heading_deg,
        'recorded_at', pp.recorded_at,
        'is_mock', pp.is_mock,
        'in_bounds', pp.in_bounds
      ))
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = g.id
        and not p.is_remote
        and (
          g.status in ('ended', 'cancelled')
          or p.id = mine.id
          or (mine.team <> 'solo' and p.team = mine.team and p.status <> 'jailed')
        )
    ), '[]'::jsonb),
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seq', pi.seq,
        'latitude', extensions.st_y(pi.geog::extensions.geometry),
        'longitude', extensions.st_x(pi.geog::extensions.geometry),
        'accuracy_m', pi.accuracy_m,
        'released_at', pi.released_at,
        'position_age_s', pi.position_age_s,
        'reason', pi.reason
      ) order by pi.seq desc)
      from public.pings pi
      where pi.game_id = g.id
        and (
          g.status in ('ended', 'cancelled')
          or pi.released_at >= (clock_timestamp() - make_interval(secs => g.ping_visible_s))
        )
    ), '[]'::jsonb),
    'markers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'label', coalesce(e.state->>'label', 'Marker'),
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'placed_by', e.state->>'placed_by',
        'placed_at', e.state->>'placed_at',
        'expires_at', e.state->>'expires_at'
      ))
      from public.entities e
      where e.game_id = g.id
        and e.kind = 'marker'
        and (e.visible_to = 'all' or e.visible_to = mine.team::text)
        and (e.state->>'expires_at')::timestamptz > clock_timestamp()
    ), '[]'::jsonb),
    'scan_envelope', (
      select jsonb_build_object(
        'id', e.id,
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'radius_m', coalesce((e.state->>'radius_m')::int, 150),
        'expires_at', e.state->>'expires_at'
      )
      from public.entities e
      where e.game_id = g.id
        and e.kind = 'scan_envelope'
        and (e.visible_to = 'all' or e.visible_to = mine.team::text)
        and (e.state->>'expires_at')::timestamptz > clock_timestamp()
      order by e.updated_at desc
      limit 1
    ),
    'operator', case
      when 'operator' = any(g.roles) then jsonb_build_object(
        'is_operator', coalesce(mine.is_remote, false),
        'scan_cooldown_s', (
          select greatest(0, ceil(extract(epoch from (
            (pr.cooldowns->>'operator_scan')::timestamptz + interval '90 seconds' - clock_timestamp()
          ))))
          from public.player_resources pr
          where pr.player_id = mine.id
        )
      )
      else null
    end,
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
          left join public.profiles prey_pr on prey_pr.id = prey_p.user_id
          where ra.game_id = g.id and ra.hunter_player_id = mine.id
        ),
        'safe_zones', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id,
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 20)
          ))
          from public.entities e
          where e.game_id = g.id and e.kind = 'safe_zone'
        ), '[]'::jsonb),
        'in_safe_zone', coalesce((
          select true from public.entities e
          join public.player_positions pp on pp.player_id = mine.id
          where e.game_id = g.id and e.kind = 'safe_zone'
            and extensions.st_dwithin(pp.geog, e.geog, coalesce((e.state->>'radius_m')::int, 20))
          limit 1
        ), false),
        'hunter_proximity', (
          select case
            when exists (
              select 1 from public.ring_assignments ra
              join public.players hp on hp.id = ra.hunter_player_id
              join public.player_positions hpp on hpp.player_id = hp.id
              join public.player_positions mypos on mypos.player_id = mine.id
              where ra.game_id = g.id
                and ra.prey_player_id = mine.id
                and hp.status = 'active'
                and extensions.st_dwithin(hpp.geog, mypos.geog, 40)
            ) then 'close'
            when exists (
              select 1 from public.ring_assignments ra
              join public.players hp on hp.id = ra.hunter_player_id
              join public.player_positions hpp on hpp.player_id = hp.id
              join public.player_positions mypos on mypos.player_id = mine.id
              where ra.game_id = g.id
                and ra.prey_player_id = mine.id
                and hp.status = 'active'
                and extensions.st_dwithin(hpp.geog, mypos.geog, 100)
            ) then 'near'
            else 'none'
          end
        )
      )
      else null
    end,
    'package_carrier', case
      when g.mode_id = 'relay_heist' then (
        select jsonb_build_object(
          'id', p.id,
          'display_name', pr.display_name,
          'color', pr.color,
          'is_carrier', (p.id = mine.id),
          'handoff_pending_from', (
            select e.state->>'handoff_from_id'
            from public.entities e
            where e.game_id = g.id and e.kind = 'package'
              and e.state->>'handoff_to_id' = mine.id::text
          )
        )
        from public.entities e
        join public.players p on p.id::text = e.state->>'carrier_player_id'
        left join public.profiles pr on pr.id = p.user_id
        where e.game_id = g.id and e.kind = 'package'
          and (
            e.state->>'status' = 'dropped'
            or mine.team = 'runner'
            or g.status in ('ended', 'cancelled')
          )
        limit 1
      )
      else null
    end,
    'events', coalesce((
      select jsonb_agg(to_jsonb(ev) order by ev.created_at desc)
      from public.events ev
      where ev.game_id = g.id
        and (
          ev.audience = 'all'
          or (ev.audience = 'runner' and mine.team = 'runner')
          or (ev.audience = 'hunter' and mine.team = 'hunter')
          or (ev.target_player is not null and ev.target_player = mine.id)
        )
    ), '[]'::jsonb),
    'ghosts', case when g.mode_id in ('haunted_map', 'ghost_duel') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', npc.id,
        'label', npc.label,
        'latitude', extensions.st_y(npc.current_point),
        'longitude', extensions.st_x(npc.current_point),
        'is_blip', true
      ))
      from public.game_npcs npc
      where npc.game_id = g.id
        and npc.status = 'active'
        and (
          g.ghost_mode = 'assist'
          or (
            g.ghost_mode = 'haunt'
            and mine.team = 'runner'
            and exists (
              select 1 from public.player_positions pp
              where pp.player_id = mine.id
                and extensions.st_dwithin(npc.geog, pp.geog, 50)
            )
          )
        )
    ), '[]'::jsonb) else '[]'::jsonb end,
    'target', case
      when mine.team = 'runner' or g.status in ('ended', 'cancelled') then (
        select jsonb_build_object(
          'id', p.id,
          'display_name', pr.display_name,
          'color', pr.color
        )
        from public.targets t
        join public.players p on p.id = t.runner_id
        left join public.profiles pr on pr.id = p.user_id
        where t.game_id = g.id
        limit 1
      )
      else null
    end,
    'heat_marks', case when mine.team = 'hunter' or g.status in ('ended', 'cancelled') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'latitude', round(extensions.st_y(hp.hunter_geog::extensions.geometry)::numeric, 6),
        'longitude', round(extensions.st_x(hp.hunter_geog::extensions.geometry)::numeric, 6),
        'result', hp.result,
        'pressed_at', hp.pressed_at,
        'fuzzed_radius_m', hp.fuzzed_radius_m
      ) order by hp.pressed_at desc)
      from public.heat_presses hp
      where hp.game_id = g.id and hp.pressed_at >= (clock_timestamp() - interval '5 minutes')
    ), '[]'::jsonb) else '[]'::jsonb end,
    'heat_charges', case when mine.team = 'hunter' then (
      select tr.heat_charges from public.team_resources tr
      where tr.game_id = g.id and tr.team = 'hunter'
    ) else null end
  ) into snapshot
  from public.games g
  where g.id = get_game_state.game_id;

  return snapshot;
end;
$$;

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;
