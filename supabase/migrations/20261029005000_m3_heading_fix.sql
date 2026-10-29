-- M3 fix: `%` has no double precision overload, so submit_position raised
-- "operator does not exist: double precision % integer" before storing a fix.
-- Replace the heading normalisation with a plain 0-360 clamp.

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
  v_in_bounds boolean;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_prev_out timestamptz;
  v_out_since timestamptz;
  v_penalty_seq integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if submit_position.game_id is null then raise exception 'Game not found.'; end if;

  -- Keep the phase clock current before deciding whether a fix is accepted.
  perform public.advance_game(submit_position.game_id);

  -- Serialise position writes for this game so an out-of-bounds warning and its
  -- optional penalty ping can only be emitted once per excursion.
  select * into current_game from public.games g
    where g.id = submit_position.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p
    where p.game_id = submit_position.game_id
      and p.user_id = caller_id
      and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;

  -- A finished round keeps no tracker running, and a tagged player is a spectator.
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

  -- Positions sent during the countdown are accepted without being stored: the
  -- runner is allowed to stand ready before the head start begins.
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

  -- Client clocks are untrusted. A fix older than two minutes is still useful,
  -- but one "from the future" is rewritten to arrival time so it cannot appear
  -- fresher than it is.
  fix_time := coalesce(submit_position.recorded_at, now());
  if fix_time > now() + interval '5 seconds' or fix_time < now() - interval '2 minutes' then
    fix_time := now();
  end if;

  fix_geog := extensions.st_setsrid(
    extensions.st_makepoint(submit_position.lng, submit_position.lat),
    4326
  )::extensions.geography;

  v_in_bounds := extensions.st_distance(fix_geog, current_game.area_center)
    <= current_game.area_radius_m;

  select pp.out_of_bounds_since into v_prev_out
    from public.player_positions pp
    where pp.player_id = me.id;
  v_out_since := case when v_in_bounds then null else coalesce(v_prev_out, now()) end;

  insert into public.player_positions (
    player_id, game_id, geog, accuracy_m, speed_mps, heading, is_mock,
    recorded_at, updated_at, out_of_bounds_since
  ) values (
    me.id, current_game.id, fix_geog, v_accuracy, v_speed, v_heading,
    coalesce(submit_position.is_mock, false), fix_time, now(), v_out_since
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
    out_of_bounds_since = excluded.out_of_bounds_since;

  -- One trail point every ten seconds is enough for replay. Mock fixes are kept
  -- out of the trail so debug teleports never appear in a recap.
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

  -- Announce a fresh excursion once. The eventual penalty ping is what makes a
  -- boundary rule hurt; the warning is what makes it fair.
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

  -- With the extra-ping penalty, one ping is released for this excursion once the
  -- grace period has passed. The event doubles as the once-only marker.
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

  return jsonb_build_object(
    'phase', current_game.status,
    'server_time', now(),
    'live_at', current_game.live_at,
    'ends_at', current_game.ends_at,
    'next_ping_at', current_game.next_ping_at,
    'in_bounds', v_in_bounds,
    'my_status', me.status,
    'winner', current_game.winner
  );
end;
$$;
