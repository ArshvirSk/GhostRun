-- V2-M2: start_game re-validates the mode configuration (a flag can flip
-- between lobby creation and start) and seeds per-player and per-team
-- resources. rematch_game now copies the v2 config so a rematch keeps the
-- modifiers and roles of the finished round.

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

  -- Flags or compatibility may have changed since the lobby was created.
  perform public.assert_mode_config(
    current_game.mode_id, current_game.roles, current_game.modifiers
  );

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

  -- Empty resource rows for every active player and both teams. Later
  -- modifiers fill them; creating them here keeps every lookup total.
  insert into public.player_resources (player_id, game_id)
  select p.id, p.game_id
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  insert into public.team_resources (game_id, team)
  values (current_game.id, 'runner'), (current_game.id, 'hunter')
  on conflict (game_id, team) do nothing;

  insert into public.events (game_id, type, payload) values (
    start_game.game_id,
    'game_started',
    jsonb_build_object(
      'mode', current_game.mode,
      'mode_id', current_game.mode_id,
      'modifiers', to_jsonb(current_game.modifiers),
      'roles', to_jsonb(current_game.roles),
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

create or replace function public.rematch_game(p_game_id uuid)
returns table (game_id uuid, code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  source_game public.games%rowtype;
  new_id uuid;
  new_code text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  attempt integer := 0;
  next_host uuid;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into source_game from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if not exists (
    select 1 from public.players p
    where p.game_id = source_game.id and p.user_id = caller_id and p.status <> 'left'
  ) then
    raise exception 'You are not a member of this game.';
  end if;
  if source_game.status <> 'ended' then
    raise exception 'A rematch can only start after the round ends.';
  end if;

  if source_game.rematch_game_id is not null then
    return query select g.id, g.code from public.games g where g.id = source_game.rematch_game_id;
    return;
  end if;

  select p.user_id into next_host
    from public.players p
    where p.game_id = source_game.id
      and p.user_id = source_game.host_id
      and p.status <> 'left'
    limit 1;
  next_host := coalesce(next_host, caller_id);

  loop
    attempt := attempt + 1;
    new_code := '';
    for i in 1..4 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when new_code <> source_game.code and not exists (
      select 1 from public.games g
      where g.code = new_code and g.status not in ('ended', 'cancelled')
    );
    if attempt >= 20 then raise exception 'Could not allocate a game code. Try again.'; end if;
  end loop;

  insert into public.games (
    code, host_id, mode, mode_id, roles, modifiers, mode_params,
    area_center, area_radius_m,
    head_start_s, duration_s, ping_interval_s, tag_radius_m, target_radius_m,
    boundary_grace_s, boundary_penalty
  ) values (
    new_code, next_host, source_game.mode, source_game.mode_id,
    source_game.roles, source_game.modifiers, source_game.mode_params,
    source_game.area_center, source_game.area_radius_m,
    source_game.head_start_s, source_game.duration_s, source_game.ping_interval_s,
    source_game.tag_radius_m, source_game.target_radius_m,
    source_game.boundary_grace_s, source_game.boundary_penalty
  ) returning id into new_id;

  insert into public.players (game_id, user_id, team, status, is_ready)
  select new_id, p.user_id, p.team, 'active', false
  from public.players p
  where p.game_id = source_game.id and p.status <> 'left'
  order by p.joined_at;

  insert into public.events (game_id, type, payload)
  values (
    new_id, 'rematch_created',
    jsonb_build_object('previous_game_id', source_game.id, 'started_by', caller_id)
  );

  update public.games set rematch_game_id = new_id where id = source_game.id;

  return query select new_id, new_code;
end;
$$;

revoke all on function public.start_game(uuid), public.rematch_game(uuid) from public, anon;
grant execute on function public.start_game(uuid), public.rematch_game(uuid) to authenticated;
