-- Migration: 20261111002000_b3_relay_heist_rpcs.sql
-- B3 Relay Heist Base Mode RPCs (docs/MODES.md §4.5)

-- 1. set_extraction_location ---------------------------------------------------

create or replace function public.set_extraction_location(
  p_game_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  new_geog extensions.geography;
  v_radius integer := greatest(10, coalesce(p_radius_m, 25));
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g
    where g.id = p_game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.host_id <> caller_id then
    raise exception 'Only the host can set the extraction location.';
  end if;

  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'Extraction location can only be set during setup.';
  end if;

  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid GPS coordinates.';
  end if;

  new_geog := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  -- Must be inside play area boundary
  if not extensions.st_dwithin(current_game.area_center, new_geog, current_game.area_radius_m) then
    raise exception 'Extraction location must be inside the play area.';
  end if;

  delete from public.entities e where e.game_id = p_game_id and e.kind = 'extraction';

  insert into public.entities (game_id, kind, geog, state, visible_to)
  values (
    p_game_id,
    'extraction',
    new_geog,
    jsonb_build_object('radius_m', v_radius),
    'all'
  );

  return jsonb_build_object(
    'success', true,
    'latitude', p_lat,
    'longitude', p_lng,
    'radius_m', v_radius
  );
end;
$$;

revoke all on function public.set_extraction_location(uuid, double precision, double precision, integer) from public, anon;
grant execute on function public.set_extraction_location(uuid, double precision, double precision, integer) to authenticated;

-- 2. request_handoff -----------------------------------------------------------

create or replace function public.request_handoff(
  p_game_id uuid,
  p_target_player_id uuid
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
  target_p public.players%rowtype;
  my_pos public.player_positions%rowtype;
  target_pos public.player_positions%rowtype;
  pkg_rec public.entities%rowtype;
  v_dist double precision;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = p_game_id and p.user_id = caller_id and p.status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;

  if me.team <> 'runner' then
    raise exception 'Only runners can execute a package handoff.';
  end if;

  select * into current_game from public.games g where g.id = p_game_id;
  if not found or current_game.status <> 'live' then
    raise exception 'Handoff is only available while the round is live.';
  end if;

  select * into pkg_rec from public.entities e
    where e.game_id = p_game_id and e.kind = 'package'
    for update;
  if not found or (pkg_rec.state->>'status') <> 'carried' then
    return jsonb_build_object('success', false, 'reason', 'package_not_carried');
  end if;

  if (pkg_rec.state->>'carrier_player_id') <> me.id::text then
    return jsonb_build_object('success', false, 'reason', 'not_the_carrier');
  end if;

  if (pkg_rec.state->>'cooldown_until') is not null
     and (pkg_rec.state->>'cooldown_until')::timestamptz > now() then
    return jsonb_build_object('success', false, 'reason', 'cooldown');
  end if;

  if p_target_player_id = me.id then
    return jsonb_build_object('success', false, 'reason', 'cannot_handoff_to_self');
  end if;

  select * into target_p from public.players p
    where p.id = p_target_player_id and p.game_id = p_game_id and p.team = 'runner' and p.status = 'active';
  if not found then
    return jsonb_build_object('success', false, 'reason', 'invalid_target');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  select * into target_pos from public.player_positions pp where pp.player_id = target_p.id;

  if my_pos.recorded_at is null or my_pos.recorded_at < now() - interval '20 seconds'
     or target_pos.recorded_at is null or target_pos.recorded_at < now() - interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  v_dist := extensions.st_distance(my_pos.geog, target_pos.geog);
  if v_dist > 5.0 + least(5.0::double precision, (coalesce(my_pos.accuracy_m, 0)::double precision + coalesce(target_pos.accuracy_m, 0)::double precision) / 2) then
    return jsonb_build_object('success', false, 'reason', 'too_far', 'distance_m', round(v_dist::numeric, 1));
  end if;

  update public.entities e
  set state = jsonb_set(
        jsonb_set(pkg_rec.state, '{handoff_pending_to}', to_jsonb(target_p.id::text)),
        '{handoff_expires_at}', to_jsonb((now() + interval '10 seconds')::text)
      ),
      updated_at = now()
  where e.id = pkg_rec.id;

  insert into public.events (game_id, type, target_player, audience, payload)
  values (
    p_game_id,
    'handoff_requested',
    target_p.id,
    'runner',
    jsonb_build_object(
      'from_player_id', me.id,
      'from_display_name', (select pr.display_name from public.profiles pr where pr.id = caller_id),
      'expires_in_s', 10
    )
  );

  return jsonb_build_object('success', true, 'target_player_id', target_p.id);
end;
$$;

revoke all on function public.request_handoff(uuid, uuid) from public, anon;
grant execute on function public.request_handoff(uuid, uuid) to authenticated;

-- 3. confirm_handoff ----------------------------------------------------------

create or replace function public.confirm_handoff(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  carrier_p public.players%rowtype;
  my_pos public.player_positions%rowtype;
  carrier_pos public.player_positions%rowtype;
  pkg_rec public.entities%rowtype;
  v_carrier_id uuid;
  v_dist double precision;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = p_game_id and p.user_id = caller_id and p.status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;

  if me.team <> 'runner' then
    raise exception 'Only runners can receive a package handoff.';
  end if;

  select * into current_game from public.games g where g.id = p_game_id;
  if not found or current_game.status <> 'live' then
    raise exception 'Handoff is only available while the round is live.';
  end if;

  select * into pkg_rec from public.entities e
    where e.game_id = p_game_id and e.kind = 'package'
    for update;
  if not found or (pkg_rec.state->>'status') <> 'carried' then
    return jsonb_build_object('success', false, 'reason', 'package_not_carried');
  end if;

  if (pkg_rec.state->>'handoff_pending_to') <> me.id::text
     or (pkg_rec.state->>'handoff_expires_at') is null
     or (pkg_rec.state->>'handoff_expires_at')::timestamptz < now() then
    return jsonb_build_object('success', false, 'reason', 'no_pending_handoff');
  end if;

  v_carrier_id := (pkg_rec.state->>'carrier_player_id')::uuid;
  select * into carrier_p from public.players p where p.id = v_carrier_id and p.status = 'active';
  if not found then
    return jsonb_build_object('success', false, 'reason', 'carrier_unavailable');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  select * into carrier_pos from public.player_positions pp where pp.player_id = carrier_p.id;

  if my_pos.recorded_at is null or my_pos.recorded_at < now() - interval '20 seconds'
     or carrier_pos.recorded_at is null or carrier_pos.recorded_at < now() - interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  v_dist := extensions.st_distance(my_pos.geog, carrier_pos.geog);
  if v_dist > 5.0 + least(5.0::double precision, (coalesce(my_pos.accuracy_m, 0)::double precision + coalesce(carrier_pos.accuracy_m, 0)::double precision) / 2) then
    return jsonb_build_object('success', false, 'reason', 'too_far', 'distance_m', round(v_dist::numeric, 1));
  end if;

  -- Swap carrier and set 20 s cooldown
  update public.entities e
  set state = jsonb_build_object(
        'status', 'carried',
        'carrier_player_id', me.id,
        'handoff_pending_to', null,
        'handoff_expires_at', null,
        'cooldown_until', (now() + interval '20 seconds')::text
      ),
      geog = my_pos.geog,
      updated_at = now()
  where e.id = pkg_rec.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'package_handed_off',
    'runner',
    jsonb_build_object(
      'new_carrier_id', me.id,
      'new_carrier_name', (select pr.display_name from public.profiles pr where pr.id = caller_id),
      'previous_carrier_id', v_carrier_id,
      'previous_carrier_name', (select pr.display_name from public.profiles pr where pr.id = carrier_p.user_id)
    )
  );

  return jsonb_build_object('success', true, 'carrier_player_id', me.id);
end;
$$;

revoke all on function public.confirm_handoff(uuid) from public, anon;
grant execute on function public.confirm_handoff(uuid) to authenticated;

-- 4. pickup_package -----------------------------------------------------------

create or replace function public.pickup_package(p_game_id uuid)
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
  pkg_rec public.entities%rowtype;
  v_dist double precision;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = p_game_id and p.user_id = caller_id and p.status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;

  if me.team <> 'runner' then
    raise exception 'Only runners can recover the package.';
  end if;

  select * into current_game from public.games g where g.id = p_game_id;
  if not found or current_game.status <> 'live' then
    raise exception 'Pickup is only available while the round is live.';
  end if;

  select * into pkg_rec from public.entities e
    where e.game_id = p_game_id and e.kind = 'package'
    for update;
  if not found or (pkg_rec.state->>'status') <> 'dropped' then
    return jsonb_build_object('success', false, 'reason', 'package_not_dropped');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if my_pos.recorded_at is null or my_pos.recorded_at < now() - interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  v_dist := extensions.st_distance(my_pos.geog, pkg_rec.geog);
  if v_dist > 10.0 + least(5.0::double precision, coalesce(my_pos.accuracy_m, 0)::double precision) then
    return jsonb_build_object('success', false, 'reason', 'too_far', 'distance_m', round(v_dist::numeric, 1));
  end if;

  update public.entities e
  set state = jsonb_build_object(
        'status', 'carried',
        'carrier_player_id', me.id,
        'handoff_pending_to', null,
        'handoff_expires_at', null,
        'cooldown_until', (now() + interval '10 seconds')::text
      ),
      visible_to = 'runner',
      geog = my_pos.geog,
      updated_at = now()
  where e.id = pkg_rec.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'package_recovered',
    'all',
    jsonb_build_object(
      'carrier_id', me.id,
      'carrier_name', (select pr.display_name from public.profiles pr where pr.id = caller_id)
    )
  );

  return jsonb_build_object('success', true, 'carrier_player_id', me.id);
end;
$$;

revoke all on function public.pickup_package(uuid) from public, anon;
grant execute on function public.pickup_package(uuid) to authenticated;

-- 5. start_securing_package ---------------------------------------------------

create or replace function public.start_securing_package(p_game_id uuid)
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
  pkg_rec public.entities%rowtype;
  v_dist double precision;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = p_game_id and p.user_id = caller_id and p.status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;

  if me.team <> 'hunter' then
    raise exception 'Only hunters can secure the dropped package.';
  end if;

  select * into current_game from public.games g where g.id = p_game_id;
  if not found or current_game.status <> 'live' then
    raise exception 'Securing is only available while the round is live.';
  end if;

  select * into pkg_rec from public.entities e
    where e.game_id = p_game_id and e.kind = 'package'
    for update;
  if not found or (pkg_rec.state->>'status') <> 'dropped' then
    return jsonb_build_object('success', false, 'reason', 'package_not_dropped');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if my_pos.recorded_at is null or my_pos.recorded_at < now() - interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  v_dist := extensions.st_distance(my_pos.geog, pkg_rec.geog);
  if v_dist > 10.0 + least(5.0::double precision, coalesce(my_pos.accuracy_m, 0)::double precision) then
    return jsonb_build_object('success', false, 'reason', 'too_far', 'distance_m', round(v_dist::numeric, 1));
  end if;

  update public.entities e
  set state = jsonb_set(
        jsonb_set(pkg_rec.state, '{securing_hunter_id}', to_jsonb(me.id::text)),
        '{securing_started_at}', to_jsonb(now()::text)
      ),
      updated_at = now()
  where e.id = pkg_rec.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'securing_started',
    'all',
    jsonb_build_object(
      'hunter_id', me.id,
      'hunter_name', (select pr.display_name from public.profiles pr where pr.id = caller_id),
      'hold_s', 20
    )
  );

  return jsonb_build_object('success', true, 'securing_hunter_id', me.id);
end;
$$;

revoke all on function public.start_securing_package(uuid) from public, anon;
grant execute on function public.start_securing_package(uuid) to authenticated;

-- 6. complete_secure_package --------------------------------------------------

create or replace function public.complete_secure_package(p_game_id uuid)
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
  pkg_rec public.entities%rowtype;
  v_started_at timestamptz;
  v_dist double precision;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = p_game_id and p.user_id = caller_id and p.status = 'active';
  if not found then raise exception 'You are not an active player in this game.'; end if;

  if me.team <> 'hunter' then
    raise exception 'Only hunters can secure the dropped package.';
  end if;

  select * into current_game from public.games g where g.id = p_game_id;
  if not found or current_game.status <> 'live' then
    raise exception 'Securing is only available while the round is live.';
  end if;

  select * into pkg_rec from public.entities e
    where e.game_id = p_game_id and e.kind = 'package'
    for update;
  if not found or (pkg_rec.state->>'status') <> 'dropped' then
    return jsonb_build_object('success', false, 'reason', 'package_not_dropped');
  end if;

  if (pkg_rec.state->>'securing_hunter_id') <> me.id::text then
    return jsonb_build_object('success', false, 'reason', 'not_the_securing_hunter');
  end if;

  v_started_at := (pkg_rec.state->>'securing_started_at')::timestamptz;
  if v_started_at is null or now() < v_started_at + interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'hold_incomplete');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if my_pos.recorded_at is null or my_pos.recorded_at < now() - interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  v_dist := extensions.st_distance(my_pos.geog, pkg_rec.geog);
  if v_dist > 10.0 + least(5.0::double precision, coalesce(my_pos.accuracy_m, 0)::double precision) then
    return jsonb_build_object('success', false, 'reason', 'too_far', 'distance_m', round(v_dist::numeric, 1));
  end if;

  update public.entities e
  set state = jsonb_build_object('status', 'secured', 'securing_hunter_id', me.id),
      updated_at = now()
  where e.id = pkg_rec.id;

  perform public.end_game(p_game_id, 'hunters', 'package_secured');

  return jsonb_build_object('success', true, 'winner', 'hunters', 'end_reason', 'package_secured');
end;
$$;

revoke all on function public.complete_secure_package(uuid) from public, anon;
grant execute on function public.complete_secure_package(uuid) to authenticated;

-- 7. cancel_securing_package --------------------------------------------------

create or replace function public.cancel_securing_package(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  pkg_rec public.entities%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = p_game_id and p.user_id = caller_id;
  if not found then raise exception 'Player not found.'; end if;

  select * into pkg_rec from public.entities e
    where e.game_id = p_game_id and e.kind = 'package'
    for update;
  if found and (pkg_rec.state->>'securing_hunter_id') = me.id::text then
    update public.entities e
    set state = jsonb_set(
          jsonb_set(pkg_rec.state, '{securing_hunter_id}', 'null'::jsonb),
          '{securing_started_at}', 'null'::jsonb
        ),
        updated_at = now()
    where e.id = pkg_rec.id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.cancel_securing_package(uuid) from public, anon;
grant execute on function public.cancel_securing_package(uuid) to authenticated;
