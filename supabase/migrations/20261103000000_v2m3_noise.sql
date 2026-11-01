-- V2-M3.1 Noise Meter.
--
-- Movement has a cost: a runner's smoothed speed raises a per-runner noise
-- value. At 60 hunters get a direction-less "someone is loud" spark; at 100 the
-- server releases an extra ping and drops noise to 40. Standing still for four
-- minutes is a camping ping, and sustained vehicle speed raises a private
-- warning (fair play and safety).
--
-- C-9: noise is a secret stat. player_positions is shared with teammates, so
-- the table SELECT is revoked and re-granted column by column, leaving noise,
-- its alert latch, the anchor and the vehicle latch unreadable by any client.
-- The owner reads their own bar through get_my_status (v2m3 dead drops, which
-- also carries items); submit_position also returns it.
--
-- Everything is inert unless the game has the noise_meter modifier.

alter table public.player_positions
  add column noise integer not null default 0 check (noise between 0 and 100),
  add column noise_alerted boolean not null default false,
  add column smoothed_speed_mps real,
  add column anchor_geog extensions.geography(Point, 4326),
  add column anchor_since timestamptz,
  add column fast_since timestamptz,
  add column vehicle_warned boolean not null default false;

-- Replace every reason check on pings, whatever name the original migration
-- produced, so the new reasons are accepted exactly once.
do $$
declare
  existing record;
begin
  for existing in
    select conname
    from pg_constraint
    where conrelid = 'public.pings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reason%'
  loop
    execute format('alter table public.pings drop constraint %I', existing.conname);
  end loop;
end;
$$;

alter table public.pings add constraint pings_reason_check
  check (reason in ('scheduled', 'boundary', 'noise', 'camping', 'item'));

revoke select on public.player_positions from authenticated;
grant select (
  player_id, game_id, geog, accuracy_m, speed_mps, heading, is_mock,
  recorded_at, updated_at, out_of_bounds_since
) on public.player_positions to authenticated;

-- submit_position -------------------------------------------------------------
-- Replaced in full: adds noise, sparks, camping pings and the vehicle warning.
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
  -- Noise Meter state
  v_noise_on boolean;
  v_dt double precision;
  v_prev_smoothed real;
  v_prev_noise integer;
  v_prev_alerted boolean;
  v_prev_anchor extensions.geography;
  v_prev_anchor_since timestamptz;
  v_prev_updated timestamptz;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
  v_smoothed real;
  v_noise integer;
  v_alerted boolean;
  v_anchor extensions.geography;
  v_anchor_since timestamptz;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_noise_seq integer;
  v_camp_seq integer;
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

  -- Noise is a runner-only rule and only matters while the round is live.
  v_noise_on := current_game.status = 'live'
    and me.team = 'runner'
    and 'noise_meter' = any(current_game.modifiers);

  select pp.smoothed_speed_mps, pp.noise, pp.noise_alerted, pp.anchor_geog,
         pp.anchor_since, pp.updated_at, pp.fast_since, pp.vehicle_warned
    into v_prev_smoothed, v_prev_noise, v_prev_alerted, v_prev_anchor,
         v_prev_anchor_since, v_prev_updated, v_prev_fast_since, v_prev_vehicle_warned
    from public.player_positions pp
    where pp.player_id = me.id;

  v_dt := least(
    30::double precision,
    greatest(
      1::double precision,
      extract(epoch from (now() - coalesce(v_prev_updated, now() - interval '5 seconds')))
    )
  );

  if v_noise_on then
    -- Exponential smoothing over recent fixes. Poor-accuracy fixes never raise
    -- the estimate, so GPS jitter cannot fake a sprint.
    if v_accuracy is not null and v_accuracy > 50 then
      v_smoothed := coalesce(v_prev_smoothed, 0);
    elsif v_speed is null then
      v_smoothed := coalesce(v_prev_smoothed, 0) * 0.8;
    else
      v_smoothed := 0.75 * coalesce(v_prev_smoothed, v_speed) + 0.25 * v_speed;
    end if;

    if v_smoothed >= 8 then
      v_fast_since := coalesce(v_prev_fast_since, fix_time);
      v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);
      v_noise := round(coalesce(v_prev_noise, 0) + 8 * v_dt)::integer;
    else
      v_fast_since := null;
      v_vehicle_warned := false;
      v_noise := case
        when v_smoothed >= 4 then round(coalesce(v_prev_noise, 0) + 5 * v_dt)
        when v_smoothed >= 2.8 then round(coalesce(v_prev_noise, 0) + 2 * v_dt)
        when v_smoothed >= 1.6 then round(coalesce(v_prev_noise, 0) - 1.0 * v_dt)
        else round(coalesce(v_prev_noise, 0) - 2.5 * v_dt)
      end::integer;
    end if;
    v_noise := least(100, greatest(0, v_noise));

    -- Anchor for the anti-camping rule. Moving more than 15 m resets it.
    if v_prev_anchor is null
       or extensions.st_distance(fix_geog, v_prev_anchor) > 15 then
      v_anchor := fix_geog;
      v_anchor_since := fix_time;
    else
      v_anchor := v_prev_anchor;
      v_anchor_since := coalesce(v_prev_anchor_since, fix_time);
      if now() - v_anchor_since >= interval '240 seconds' then
        update public.games g
          set ping_seq = g.ping_seq + 1
          where g.id = current_game.id
          returning g.ping_seq into v_camp_seq;

        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason
        ) values (
          current_game.id, v_camp_seq, me.id, fix_geog, v_accuracy,
          greatest(0, floor(extract(epoch from (now() - fix_time)))::integer),
          'camping'
        );

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'camping_ping', 'all',
          jsonb_build_object('player_id', me.id, 'seq', v_camp_seq)
        );

        v_anchor_since := now();
      end if;
    end if;

    v_alerted := case when v_noise < 50 then false else coalesce(v_prev_alerted, false) end;

    -- 60: a location-less spark for the hunter team, once per crossing.
    if v_noise >= 60 and not v_alerted then
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'noise_spark', 'hunter',
        jsonb_build_object('player_id', me.id)
      );
      v_alerted := true;
    end if;

    -- 100: an immediate ping that bypasses the schedule, then back to 40.
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

    -- Sustained vehicle speed: warn the runner privately (safety and fair play).
    if v_smoothed >= 8 and not v_vehicle_warned then
      if v_fast_since is not null and now() - v_fast_since >= interval '10 seconds' then
        insert into public.events (game_id, type, audience, payload, target_player)
        values (
          current_game.id, 'vehicle_warning', 'all',
          jsonb_build_object('speed_mps', round(v_smoothed::numeric, 1)),
          me.id
        );
        v_vehicle_warned := true;
      end if;
    end if;
  else
    v_smoothed := null;
    v_noise := 0;
    v_alerted := false;
    v_anchor := null;
    v_anchor_since := null;
    v_fast_since := null;
    v_vehicle_warned := false;
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
    'end_reason', current_game.end_reason,
    'noise', v_noise,
    'smoothed_speed_mps', round(v_smoothed::numeric, 2)
  );
end;
$$;

revoke all on function public.submit_position(
  uuid, double precision, double precision, double precision, double precision,
  double precision, boolean, timestamptz
) from public, anon;
grant execute on function public.submit_position(
  uuid, double precision, double precision, double precision, double precision,
  double precision, boolean, timestamptz
) to authenticated;
