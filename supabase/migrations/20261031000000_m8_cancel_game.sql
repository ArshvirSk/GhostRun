-- M8 cancel_game: host-only RPC to cancel a game from lobby or in-flight.

create or replace function public.cancel_game(game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g
    where g.id = cancel_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.host_id <> caller_id then
    raise exception 'Only the host can cancel the game.';
  end if;

  if current_game.status in ('ended', 'cancelled') then
    raise exception 'Game has already finished.';
  end if;

  update public.games g set
    status = 'cancelled',
    end_reason = 'host_cancelled',
    ended_at = now()
    where g.id = current_game.id;

  insert into public.events (game_id, type, payload)
  values (
    current_game.id,
    'game_cancelled',
    jsonb_build_object('cancelled_by', caller_id)
  );
end;
$$;

revoke all on function public.cancel_game(uuid) from public, anon;
grant execute on function public.cancel_game(uuid) to authenticated;
