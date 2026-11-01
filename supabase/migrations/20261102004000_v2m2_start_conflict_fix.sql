-- V2-M2 fix: start_game failed with "column reference game_id is ambiguous"
-- because `on conflict (game_id, team)` is parsed against the function's own
-- game_id parameter (same class of bug as the m1 set_target fix). Name the
-- constraint instead.

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

  insert into public.player_resources (player_id, game_id)
  select p.id, p.game_id
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  insert into public.team_resources (game_id, team)
  values (current_game.id, 'runner'), (current_game.id, 'hunter')
  on conflict on constraint team_resources_pkey do nothing;

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

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;
