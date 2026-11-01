-- V2-M1 privacy RPCs: consent choices, the C3 replay-sharing switch, data
-- export and account deletion. Every function is SECURITY DEFINER with
-- set search_path = public, extensions and validates auth.uid() itself.

-- set_consent ----------------------------------------------------------------
-- Appends one consent row. The latest row per (user, type) is the state; rows
-- are never updated or deleted, so the record survives as proof of consent.
create or replace function public.set_consent(
  consent_type text,
  granted boolean,
  policy_version integer default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if consent_type not in
     ('location', 'policy_ack', 'ghost', 'leaderboard_name', 'diagnostics') then
    raise exception 'Unknown consent type.';
  end if;
  if granted is null then raise exception 'Choose grant or decline.'; end if;
  if consent_type = 'policy_ack' and policy_version is null then
    raise exception 'A policy acknowledgement needs a policy version.';
  end if;

  insert into public.consents (user_id, consent_type, granted, policy_version)
  values (caller_id, consent_type, granted, policy_version);
end;
$$;

-- set_share_trail ------------------------------------------------------------
-- C3 for one game. Chosen in the lobby, changeable any time (revocable even
-- after the round ends, per MODES.md 7.4.2 withdrawal column).
create or replace function public.set_share_trail(game_id uuid, share boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if share is null then
    raise exception 'Choose whether to share your route.';
  end if;
  if not public.is_member(set_share_trail.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  update public.players p
    set share_trail = share, share_choice_at = now()
  where p.game_id = set_share_trail.game_id
    and p.user_id = caller_id
    and p.status <> 'left';
  if not found then raise exception 'You cannot change this choice right now.'; end if;
end;
$$;

-- export_my_data -------------------------------------------------------------
-- One JSON bundle: profile, consent history, games joined, own trail points,
-- own tags and own SOS events. Capped so a four-hour round cannot overflow the
-- response; the caps are guards, not a policy.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  bundle jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(pr) from public.profiles pr where pr.id = caller_id),
    'consents', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.consents c where c.user_id = caller_id
    ), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', p.game_id, 'team', p.team, 'status', p.status,
        'share_trail', p.share_trail, 'share_choice_at', p.share_choice_at,
        'joined_at', p.joined_at, 'tagged_at', p.tagged_at,
        'game', jsonb_build_object(
          'code', g.code, 'mode', g.mode, 'status', g.status,
          'winner', g.winner, 'end_reason', g.end_reason,
          'created_at', g.created_at, 'ended_at', g.ended_at
        )
      ) order by p.joined_at)
      from public.players p
      join public.games g on g.id = p.game_id
      where p.user_id = caller_id
    ), '[]'::jsonb),
    'trail_points', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', tp.game_id,
        'longitude', extensions.st_x(tp.geog::extensions.geometry),
        'latitude', extensions.st_y(tp.geog::extensions.geometry),
        'accuracy_m', tp.accuracy_m, 'recorded_at', tp.recorded_at
      ) order by tp.recorded_at)
      from (
        select tp.* from public.trail_points tp
        join public.players p on p.id = tp.player_id
        where p.user_id = caller_id
        order by tp.recorded_at desc
        limit 50000
      ) tp
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', t.game_id, 'as', case when hunter.user_id = caller_id
          then 'hunter' else 'runner' end,
        'distance_m', t.distance_m, 'tagged_at', t.tagged_at
      ) order by t.tagged_at)
      from public.tags t
      left join public.players hunter on hunter.id = t.hunter_id
      left join public.players runner on runner.id = t.runner_id
      where hunter.user_id = caller_id or runner.user_id = caller_id
    ), '[]'::jsonb),
    'sos_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.id)
      from public.events e
      where e.type = 'sos' and e.payload->>'user_id' = caller_id::text
      order by e.id desc
      limit 500
    ), '[]'::jsonb)
  ) into bundle;

  return bundle;
end;
$$;

-- delete_my_data -------------------------------------------------------------
-- Removes the profile and every personal row in one transaction. Games the
-- player hosted mid-flight pass to the earliest other member; in-flight rounds
-- treat the player as having left (with the same win checks as leave_game), so
-- the remaining crew can keep playing. Tag and target rows survive with a null
-- actor; the replay renders "Deleted player".
create or replace function public.delete_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  rec record;
  next_host uuid;
  active_runners integer;
  active_hunters integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not exists (select 1 from public.profiles where id = caller_id) then
    raise exception 'No profile to delete.';
  end if;

  -- Step 1: leave every in-flight round exactly as leave_game would.
  for rec in
    select p.id as player_id, p.game_id, p.team
    from public.players p
    join public.games g on g.id = p.game_id
    where p.user_id = caller_id
      and p.status = 'active'
      and g.status in ('countdown', 'head_start', 'live')
    for update of p
  loop
    update public.players p
      set status = 'left', is_ready = false
    where p.id = rec.player_id;

    insert into public.events (game_id, type, payload)
      values (rec.game_id, 'player_left', jsonb_build_object('user_id', caller_id));

    select count(*) filter (where p.team = 'runner'), count(*) filter (where p.team = 'hunter')
      into active_runners, active_hunters
    from public.players p
    where p.game_id = rec.game_id and p.status = 'active';

    if active_hunters = 0 then
      update public.games set status = 'ended', winner = 'runners',
        end_reason = 'all_hunters_left', ended_at = now()
      where id = rec.game_id and status in ('countdown', 'head_start', 'live');
      insert into public.events (game_id, type, payload)
        values (rec.game_id, 'game_ended',
          jsonb_build_object('winner', 'runners', 'reason', 'all_hunters_left'));
    elsif active_runners = 0 then
      update public.games set status = 'ended', winner = 'hunters',
        end_reason = 'all_tagged', ended_at = now()
      where id = rec.game_id and status in ('countdown', 'head_start', 'live');
      insert into public.events (game_id, type, payload)
        values (rec.game_id, 'game_ended',
          jsonb_build_object('winner', 'hunters', 'reason', 'all_tagged'));
    end if;
  end loop;

  -- Step 2: hand over unfinished games the player hosted.
  for rec in
    select g.id from public.games g
    where g.host_id = caller_id and g.status not in ('ended', 'cancelled')
  loop
    select p.user_id into next_host
    from public.players p
    where p.game_id = rec.id and p.user_id <> caller_id and p.status <> 'left'
    order by p.joined_at limit 1;
    update public.games set host_id = next_host where id = rec.id;
  end loop;

  -- Step 3: the delete itself. players.user_id cascades to positions, pings and
  -- trails; consents cascade with the profile; tags and targets lose their
  -- actor and stay as shared history. Deleting the auth.users row also needs
  -- admin privileges the API role may not hold; when that is refused we still
  -- remove the profile and every personal row, and report it.
  begin
    delete from auth.users where id = caller_id;
    return jsonb_build_object('deleted', true, 'account_removed', true, 'at', now());
  exception when insufficient_privilege then
    delete from public.profiles where id = caller_id;
    return jsonb_build_object('deleted', true, 'account_removed', false, 'at', now());
  end;
end;
$$;

-- get_my_consents -----------------------------------------------------------
-- The consents table is append-only and has no client grants, so the app reads
-- the latest state per type through this function.
create or replace function public.get_my_consents()
returns jsonb
language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(
    latest.consent_type,
    jsonb_build_object(
      'granted', latest.granted,
      'policy_version', latest.policy_version,
      'created_at', latest.created_at
    )
  ), '{}'::jsonb)
  from (
    select distinct on (c.consent_type) c.consent_type, c.granted, c.policy_version, c.created_at
    from public.consents c
    where c.user_id = auth.uid()
    order by c.consent_type, c.created_at desc
  ) latest;
$$;

revoke all on function public.get_my_consents() from public, anon;
grant execute on function public.get_my_consents() to authenticated;

-- get_game_trails -----------------------------------------------------------
-- Replaces the m5 version: after the round, a reader receives their own trail
-- plus only those players who chose to share (C3). The RLS policy applies the
-- same rule for direct selects; this function is SECURITY DEFINER, so it must
-- repeat the filter itself.
create or replace function public.get_game_trails(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(get_game_trails.game_id) then
    raise exception 'You are not a member of this game.';
  end if;
  if not public.game_ended(get_game_trails.game_id) then
    raise exception 'Trails are only available after the round ends.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'player_id', t.player_id,
      'longitude', extensions.st_x(t.geog::extensions.geometry),
      'latitude', extensions.st_y(t.geog::extensions.geometry),
      'accuracy_m', t.accuracy_m,
      'recorded_at', t.recorded_at
    ) order by t.recorded_at, t.id)
    from (
      select tp.id, tp.player_id, tp.geog, tp.accuracy_m, tp.recorded_at
      from public.trail_points tp
      join public.players p on p.id = tp.player_id
      where tp.game_id = get_game_trails.game_id
        and (p.share_trail = true or p.id = public.my_player_id(get_game_trails.game_id))
      order by tp.recorded_at, tp.id
      limit 30000
    ) t
  ), '[]'::jsonb);
end;
$$;

-- get_game_replay ------------------------------------------------------------
-- Replaces the m6 version so a deleted player's tags survive as "Deleted
-- player" (audit C-8): the profile joins become LEFT JOINs.
create or replace function public.get_game_replay(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(get_game_replay.game_id) then
    raise exception 'You are not a member of this game.';
  end if;
  if not public.game_ended(get_game_replay.game_id) then
    raise exception 'The replay is only available after the round ends.';
  end if;

  return jsonb_build_object(
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tag.id,
        'hunter_id', tag.hunter_id,
        'runner_id', tag.runner_id,
        'hunter_name', coalesce(hunter_profile.display_name, 'Deleted player'),
        'runner_name', coalesce(runner_profile.display_name, 'Deleted player'),
        'distance_m', tag.distance_m,
        'tagged_at', tag.tagged_at
      ) order by tag.tagged_at, tag.id)
      from public.tags tag
      left join public.players hunter on hunter.id = tag.hunter_id
      left join public.profiles hunter_profile on hunter_profile.id = hunter.user_id
      left join public.players runner on runner.id = tag.runner_id
      left join public.profiles runner_profile on runner_profile.id = runner.user_id
      where tag.game_id = get_game_replay.game_id
    ), '[]'::jsonb),
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ping.id,
        'seq', ping.seq,
        'player_id', ping.player_id,
        'display_name', profile.display_name,
        'color', profile.color,
        'longitude', extensions.st_x(ping.geog::extensions.geometry),
        'latitude', extensions.st_y(ping.geog::extensions.geometry),
        'accuracy_m', ping.accuracy_m,
        'position_age_s', ping.position_age_s,
        'reason', ping.reason,
        'released_at', ping.released_at
      ) order by ping.released_at, ping.id)
      from public.pings ping
      left join public.players p on p.id = ping.player_id
      left join public.profiles profile on profile.id = p.user_id
      where ping.game_id = get_game_replay.game_id
        and ping.geog is not null
    ), '[]'::jsonb)
  );
end;
$$;

-- set_ready ------------------------------------------------------------------
-- Replaces the m1 version: ready-up requires the C3 choice (MODES.md 7.4.3).
create or replace function public.set_ready(game_id uuid, ready boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  affected_game uuid;
  game_phase public.game_status;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select status into game_phase from public.games where id = set_ready.game_id for update;
  if not found or game_phase not in ('lobby', 'target_selection') then
    raise exception 'Ready status can only change before the game starts.';
  end if;
  if exists (
    select 1 from public.players p
    where p.game_id = set_ready.game_id and p.user_id = caller_id
      and p.status = 'active' and p.share_trail is null
  ) then
    raise exception 'Choose whether to share your route before readying up.';
  end if;
  update public.players p set is_ready = set_ready.ready
  from public.games g
  where p.game_id = g.id and p.game_id = set_ready.game_id
    and p.user_id = caller_id and p.status = 'active'
    and g.status in ('lobby', 'target_selection')
  returning p.game_id into affected_game;
  if affected_game is null then raise exception 'You cannot change ready status right now.'; end if;
  insert into public.events (game_id, type, payload) values (
    affected_game, 'ready_changed', jsonb_build_object('user_id', caller_id, 'ready', set_ready.ready)
  );
end;
$$;

-- start_game ------------------------------------------------------------------
-- Replaces the m8 force-start version: same rules plus the C3 gate for every
-- active player, so a forced start cannot skip anyone's route-sharing choice.
create or replace function public.start_game(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  countdown_ends timestamptz;
  live_starts timestamptz;
  active_runners integer;
  active_hunters integer;
  unassigned integer;
  missing_consent integer;
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
  if current_game.mode = 'classic_chase' and current_game.status <> 'target_selection' then
    raise exception 'Choose the secret target before starting the round.';
  end if;
  if current_game.mode = 'tag_hunt' and current_game.status <> 'lobby' then
    raise exception 'This game is no longer in the lobby.';
  end if;

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'unassigned')
    into active_runners, active_hunters, unassigned
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active';

  if active_runners = 0 or active_hunters = 0 then
    raise exception 'Assign at least one runner and one hunter before starting.';
  end if;
  if unassigned > 0 then
    raise exception 'Every player must choose a team before the round starts.';
  end if;
  if current_game.mode = 'classic_chase'
     and not exists (select 1 from public.targets t where t.game_id = start_game.game_id) then
    raise exception 'Runners must save the secret target first.';
  end if;

  -- C3: nobody enters a round without a route-sharing choice.
  select count(*) into missing_consent
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active' and p.share_trail is null;
  if missing_consent > 0 then
    raise exception 'Every player must choose whether to share their route before the round starts.';
  end if;

  countdown_ends := now() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);

  update public.games g set
    status = 'countdown',
    head_start_at = countdown_ends,
    live_at = live_starts,
    ends_at = live_starts + make_interval(secs => current_game.duration_s),
    next_ping_at = live_starts,
    ping_seq = 0,
    winner = null,
    end_reason = null,
    ended_at = null
  where g.id = start_game.game_id
  returning * into current_game;

  insert into public.events (game_id, type, payload) values (
    start_game.game_id,
    'game_started',
    jsonb_build_object(
      'mode', current_game.mode,
      'head_start_at', current_game.head_start_at,
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at
    )
  );

  return jsonb_build_object(
    'status', current_game.status,
    'head_start_at', current_game.head_start_at,
    'live_at', current_game.live_at,
    'next_ping_at', current_game.next_ping_at,
    'ends_at', current_game.ends_at
  );
end;
$$;

revoke all on function public.set_consent(text, boolean, integer),
  public.set_share_trail(uuid, boolean), public.export_my_data(),
  public.delete_my_data(), public.get_game_trails(uuid),
  public.get_game_replay(uuid), public.set_ready(uuid, boolean),
  public.start_game(uuid) from public, anon;
grant execute on function public.set_consent(text, boolean, integer),
  public.set_share_trail(uuid, boolean), public.export_my_data(),
  public.delete_my_data(), public.get_game_trails(uuid),
  public.get_game_replay(uuid), public.set_ready(uuid, boolean),
  public.start_game(uuid) to authenticated;
