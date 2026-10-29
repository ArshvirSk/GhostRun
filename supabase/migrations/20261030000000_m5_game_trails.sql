-- M5 round recap: trails for an ended round.
--
-- get_game_state already reveals final positions and the target once a game is
-- over. Trails are the last missing piece of the recap. They stay unavailable
-- while a round is live, inside the function and in the trail_points RLS policy,
-- so a member cannot reconstruct a live route.

create or replace function public.get_game_trails(game_id uuid)
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
  if not public.is_member(get_game_trails.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game
    from public.games g
    where g.id = get_game_trails.game_id;
  if not found then raise exception 'Game not found.'; end if;

  -- Only a played round has a recap. Cancelled games never had a live phase.
  if current_game.status <> 'ended' then
    raise exception 'Trails are only available after the round ends.';
  end if;

  -- One point is recorded per player at most every ten seconds. A four-hour
  -- round with twenty players stays under this ceiling; it is only a guard
  -- against an unexpectedly large payload.
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
      where tp.game_id = get_game_trails.game_id
      order by tp.recorded_at, tp.id
      limit 30000
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_game_trails(uuid) from public, anon;
grant execute on function public.get_game_trails(uuid) to authenticated;
