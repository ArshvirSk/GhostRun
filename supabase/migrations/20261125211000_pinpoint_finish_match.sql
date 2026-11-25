-- Finalize a live Pinpoint match when all rounds complete on the client.
create or replace function public.finish_pinpoint_match(
  p_game_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game public.games%rowtype;
  v_runner_score bigint := 0;
  v_hunter_score bigint := 0;
  v_winner text := 'runners';
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_member(p_game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found.';
  end if;

  if v_game.status in ('ended', 'cancelled') then
    return jsonb_build_object('ok', true, 'status', v_game.status);
  end if;

  if v_game.mode_id <> 'pinpoint' then
    raise exception 'finish_pinpoint_match is only valid for Pinpoint mode.';
  end if;

  if v_game.status <> 'live' then
    raise exception 'The round is not live.';
  end if;

  select
    coalesce(sum(case when ps.team = 'runner' then ps.total_score else 0 end), 0),
    coalesce(sum(case when ps.team = 'hunter' then ps.total_score else 0 end), 0)
  into v_runner_score, v_hunter_score
  from public.pinpoint_submissions ps
  join public.pinpoint_rounds pr on pr.id = ps.round_id
  join public.pinpoint_games pg on pg.id = pr.pinpoint_game_id
  where pg.game_id = p_game_id;

  if v_hunter_score > v_runner_score then
    v_winner := 'hunters';
  else
    v_winner := 'runners';
  end if;

  perform public.end_game(p_game_id, v_winner, 'completed');

  return jsonb_build_object(
    'ok', true,
    'status', 'ended',
    'winner', v_winner,
    'runner_score', v_runner_score,
    'hunter_score', v_hunter_score
  );
end;
$$;

revoke all on function public.finish_pinpoint_match(uuid) from public, anon;
grant execute on function public.finish_pinpoint_match(uuid) to authenticated;
