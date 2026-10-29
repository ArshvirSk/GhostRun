-- M6 replay: the tag and ping history for an ended round.
--
-- The result screen already reads final positions and trails. A replay also
-- needs the timestamped moments that tell the story: every tag and every
-- released ping. The RPC repeats the membership and ended checks rather than
-- relying on the caller's RLS view, which also keeps PostGIS coordinates out of
-- a raw PostgREST select.

create or replace function public.get_game_replay(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(get_game_replay.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game
    from public.games g
    where g.id = get_game_replay.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'ended' then
    raise exception 'The replay is only available after the round ends.';
  end if;

  return jsonb_build_object(
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tag.id,
        'hunter_id', tag.hunter_id,
        'runner_id', tag.runner_id,
        'hunter_name', hunter_profile.display_name,
        'runner_name', runner_profile.display_name,
        'distance_m', tag.distance_m,
        'tagged_at', tag.tagged_at
      ) order by tag.tagged_at, tag.id)
      from public.tags tag
      join public.players hunter on hunter.id = tag.hunter_id
      join public.profiles hunter_profile on hunter_profile.id = hunter.user_id
      join public.players runner on runner.id = tag.runner_id
      join public.profiles runner_profile on runner_profile.id = runner.user_id
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
      join public.players p on p.id = ping.player_id
      join public.profiles profile on profile.id = p.user_id
      where ping.game_id = get_game_replay.game_id
        and ping.geog is not null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_game_replay(uuid) from public, anon;
grant execute on function public.get_game_replay(uuid) to authenticated;
