-- M7 rematch: a finished round opens a fresh lobby with the same crew and
-- settings, and links the old game to it so every player can follow.

alter table public.games
  add column if not exists rematch_game_id uuid references public.games(id) on delete set null;

create index if not exists games_rematch_idx on public.games(rematch_game_id);

create or replace function public.rematch_game(game_id uuid)
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

  -- Serialise presses: two players hitting play again must get one lobby.
  select * into source_game from public.games g
    where g.id = rematch_game.game_id
    for update;
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

  -- Every later press returns the lobby the first press created.
  if source_game.rematch_game_id is not null then
    return query select g.id, g.code from public.games g where g.id = source_game.rematch_game_id;
    return;
  end if;

  -- The original host keeps the room if they are still in the crew; otherwise
  -- the player who opened the rematch takes over.
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
    code, host_id, mode, area_center, area_radius_m,
    head_start_s, duration_s, ping_interval_s, tag_radius_m, target_radius_m,
    boundary_grace_s, boundary_penalty
  ) values (
    new_code, next_host, source_game.mode, source_game.area_center, source_game.area_radius_m,
    source_game.head_start_s, source_game.duration_s, source_game.ping_interval_s,
    source_game.tag_radius_m, source_game.target_radius_m,
    source_game.boundary_grace_s, source_game.boundary_penalty
  ) returning id into new_id;

  -- Same crew and sides, but a fresh round: tagged runners are active again and
  -- nobody is ready until they see the new lobby.
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

revoke all on function public.rematch_game(uuid) from public, anon;
grant execute on function public.rematch_game(uuid) to authenticated;
