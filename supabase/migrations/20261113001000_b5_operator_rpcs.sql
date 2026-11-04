-- Migration: 20261113001000_b5_operator_rpcs.sql
-- Operator Role RPCs: set_player_remote, place_marker, clear_marker, send_operator_message, operator_scan

-- 1. set_player_remote --------------------------------------------------------
create or replace function public.set_player_remote(
  p_game_id uuid,
  p_is_remote boolean,
  p_player_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  caller_player public.players%rowtype;
  target_player public.players%rowtype;
  v_existing_operator boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games where id = p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'lobby' then
    raise exception 'Operator role can only be assigned in the lobby.';
  end if;
  if not ('operator' = any(current_game.roles)) then
    raise exception 'Operator role is not enabled for this game.';
  end if;
  if current_game.mode_id in ('assassin_ring', 'ghost_duel') then
    raise exception 'Operator role is not supported in solo modes.';
  end if;

  select * into caller_player from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;

  if p_player_id is null or p_player_id = caller_player.id then
    target_player := caller_player;
  else
    if current_game.host_id <> caller_id then
      raise exception 'Only the host can toggle operator status for other players.';
    end if;
    select * into target_player from public.players
    where id = p_player_id and game_id = p_game_id and status = 'active'
    for update;
    if not found then raise exception 'Target player not found in this game.'; end if;
  end if;

  if p_is_remote then
    if target_player.team = 'unassigned' then
      raise exception 'Assign a team before becoming an Operator.';
    end if;

    -- Enforce max 1 Operator per squad
    select exists (
      select 1 from public.players p
      where p.game_id = p_game_id
        and p.team = target_player.team
        and p.is_remote = true
        and p.status = 'active'
        and p.id <> target_player.id
    ) into v_existing_operator;

    if v_existing_operator then
      raise exception 'Squad already has an Operator assigned (limit 1 per team).';
    end if;

    update public.players
    set is_remote = true
    where id = target_player.id;

    -- Remote operators do not hold physical GPS records
    delete from public.player_positions where player_id = target_player.id;
  else
    update public.players
    set is_remote = false
    where id = target_player.id;
  end if;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'operator_status_changed',
    'all',
    jsonb_build_object(
      'player_id', target_player.id,
      'is_remote', p_is_remote,
      'team', target_player.team
    )
  );

  return jsonb_build_object(
    'ok', true,
    'player_id', target_player.id,
    'is_remote', p_is_remote
  );
end;
$$;

revoke all on function public.set_player_remote(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_player_remote(uuid, boolean, uuid) to authenticated;

-- 2. place_marker -------------------------------------------------------------
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
    and team = me.team
    and (state->>'expires_at')::timestamptz > now();

  if v_active_markers >= 3 then
    delete from public.entities
    where id in (
      select id from public.entities
      where game_id = p_game_id
        and kind = 'marker'
        and team = me.team
        and (state->>'expires_at')::timestamptz > now()
      order by updated_at asc
      limit (v_active_markers - 2)
    );
  end if;

  insert into public.entities (
    game_id, kind, team, geog, state, visible_to, updated_at
  ) values (
    p_game_id,
    'marker',
    me.team,
    v_marker_geog,
    jsonb_build_object(
      'label', coalesce(nullif(trim(p_label), ''), 'Tactical Marker'),
      'placed_by', me.id,
      'placed_at', now(),
      'expires_at', now() + interval '90 seconds'
    ),
    me.team,
    now()
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
    'expires_at', now() + interval '90 seconds'
  );
end;
$$;

revoke all on function public.place_marker(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.place_marker(uuid, double precision, double precision, text) to authenticated;

-- 3. clear_marker -------------------------------------------------------------
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
    and team = me.team;

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

-- 4. send_operator_message ----------------------------------------------------
create or replace function public.send_operator_message(
  p_game_id uuid,
  p_message text
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
  v_display_name text;
  v_clean_msg text;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games where id = p_game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Operator messages can only be sent while the round is live.';
  end if;

  select * into me from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;
  if not me.is_remote then
    raise exception 'Only remote Operators can use the tactical comms channel.';
  end if;

  v_clean_msg := trim(p_message);
  if length(v_clean_msg) < 1 or length(v_clean_msg) > 200 then
    raise exception 'Message must be between 1 and 200 characters.';
  end if;

  select pr.display_name into v_display_name from public.profiles pr where pr.id = caller_id;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'operator_message',
    me.team,
    jsonb_build_object(
      'sender_id', me.id,
      'sender_name', coalesce(v_display_name, 'Operator'),
      'message', v_clean_msg,
      'sent_at', now()
    )
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.send_operator_message(uuid, text) from public, anon;
grant execute on function public.send_operator_message(uuid, text) to authenticated;

-- 5. operator_scan ------------------------------------------------------------
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
      and pp.recorded_at >= now() - interval '45 seconds'
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
        'expires_at', now() + interval '10 seconds',
        'scan_type', 'runner_sweep'
      ),
      'runner',
      now()
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
      raise exception 'Scan coordinates (lat, lng) are required for Hunter Operator.';
    end if;

    v_scan_geog := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::geography;

    -- Boundary constraint: must fall strictly within the play area circle
    if extensions.st_distance(v_scan_geog, current_game.area_center) > current_game.area_radius_m then
      raise exception 'Scan coordinates must fall strictly within the play area boundary.';
    end if;

    select count(*) into v_runner_count
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = p_game_id
      and p.team = 'runner'
      and p.status = 'active'
      and not p.is_remote
      and pp.recorded_at >= now() - interval '45 seconds'
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
        'runner_count', v_runner_count,
        'message', format('Sector census scan: %s runner(s) detected within 200m.', v_runner_count)
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
    raise exception 'Unknown squad for operator scan.';
  end if;
end;
$$;

revoke all on function public.operator_scan(uuid, double precision, double precision) from public, anon;
grant execute on function public.operator_scan(uuid, double precision, double precision) to authenticated;
