-- M4 gameplay endings: hunters tag runners, and Classic runners win by reaching
-- the secret target. Both endings are server-authoritative; the client only sends
-- the intent to tag or its position.

-- end_game -------------------------------------------------------------------
-- Internal helper. Players cannot end a round directly: execute is revoked from
-- every API role and only security-definer RPCs call it.
create or replace function public.end_game(
  game_id uuid,
  end_winner text,
  end_reason text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_game public.games%rowtype;
begin
  if end_winner not in ('runners', 'hunters') then
    raise exception 'Winner must be runners or hunters.';
  end if;
  if end_reason is null or length(trim(end_reason)) = 0 then
    raise exception 'An end reason is required.';
  end if;

  select * into current_game from public.games g
    where g.id = end_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status in ('ended', 'cancelled') then return; end if;
  if current_game.status <> 'live' then
    raise exception 'The round is not live.';
  end if;

  update public.games g set
    status = 'ended',
    winner = end_game.end_winner,
    end_reason = end_game.end_reason,
    ended_at = now()
    where g.id = current_game.id
    returning * into current_game;

  insert into public.events (game_id, type, payload)
  values (
    current_game.id,
    'game_ended',
    jsonb_build_object('winner', current_game.winner, 'reason', current_game.end_reason)
  );
end;
$$;

-- attempt_tag ----------------------------------------------------------------
-- Hunters only, live only. A failed attempt starts an 8-second cooldown; a
-- successful tag marks the runner tagged and ends the round when no active
-- runners remain. Failure payloads never reveal a direction or distance.
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
  target_runner public.players%rowtype;
  target_id uuid;
  target_distance double precision;
  runner_name text;
  active_runners integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  -- Lock the player before the game, matching leave_game, so a leave and a tag
  -- racing each other cannot deadlock. Two taps by one hunter also serialise here.
  select * into me from public.players p
    where p.game_id = attempt_tag.game_id
      and p.user_id = caller_id
      and p.status <> 'left'
    for update;
  if not found then raise exception 'You are not a player in this game.'; end if;
  if me.team <> 'hunter' then raise exception 'Only hunters can tag runners.'; end if;

  perform public.advance_game(attempt_tag.game_id);

  select * into current_game from public.games g
    where g.id = attempt_tag.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Tagging is only available while the round is live.';
  end if;

  if me.last_tag_attempt_at is not null
     and now() - me.last_tag_attempt_at < interval '8 seconds' then
    return jsonb_build_object('success', false, 'reason', 'cooldown');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  select p.id, extensions.st_distance(pp.geog, my_pos.geog)
    into target_id, target_distance
  from public.players p
  join public.player_positions pp on pp.player_id = p.id
  where p.game_id = current_game.id
    and p.team = 'runner'
    and p.status = 'active'
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
    update public.players p set last_tag_attempt_at = now() where p.id = me.id;
    return jsonb_build_object('success', false, 'reason', 'no_target');
  end if;

  select * into target_runner from public.players p where p.id = target_id;
  select pr.display_name into runner_name
    from public.profiles pr where pr.id = target_runner.user_id;

  insert into public.tags (game_id, hunter_id, runner_id, distance_m)
  values (current_game.id, me.id, target_runner.id, target_distance::real);

  update public.players p
    set status = 'tagged', tagged_at = now(), is_ready = false
    where p.id = target_runner.id;
  update public.players p set last_tag_attempt_at = null where p.id = me.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'runner_tagged',
    'all',
    jsonb_build_object(
      'runner_id', target_runner.id,
      'hunter_id', me.id,
      'display_name', runner_name
    )
  );

  select count(*) into active_runners
    from public.players p
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active';

  if active_runners = 0 then
    perform public.end_game(current_game.id, 'hunters', 'all_tagged');
  end if;

  select * into current_game from public.games g where g.id = current_game.id;

  return jsonb_build_object(
    'success', true,
    'runner_id', target_runner.id,
    'phase', current_game.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason
  );
end;
$$;

-- submit_position ------------------------------------------------------------
-- Replaced in full so a Classic runner standing on the target ends the round.
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

  -- Classic runners win by reaching the secret target. Reaching is checked
  -- after the position is stored so the final fix is the one that counts.
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
    'my_status', me.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason
  );
end;
$$;

revoke all on function public.end_game(uuid, text, text) from public, anon, authenticated;
revoke all on function public.attempt_tag(uuid) from public, anon;
grant execute on function public.attempt_tag(uuid) to authenticated;
