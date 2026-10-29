-- M3 fix: bound the ping catch-up. A live game that sat unread for weeks
-- iterated once per missed interval; restart the cadence after a gap instead.

create or replace function public.advance_game(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  next_ping timestamptz;
  ping_count integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(advance_game.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game from public.games g
    where g.id = advance_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status = 'countdown'
     and current_game.head_start_at is not null
     and now() >= current_game.head_start_at then
    update public.games g set status = 'head_start'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type) values (current_game.id, 'head_start_began');
  end if;

  if current_game.status = 'head_start'
     and current_game.live_at is not null
     and now() >= current_game.live_at then
    update public.games g set status = 'live'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type) values (current_game.id, 'live_began');
  end if;

  if current_game.status = 'live'
     and current_game.next_ping_at is not null
     and now() >= current_game.next_ping_at then
    insert into public.pings (
      game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
    )
    select
      current_game.id,
      current_game.ping_seq + 1,
      p.id,
      pp.geog,
      pp.accuracy_m,
      greatest(0, floor(extract(epoch from (now() - pp.recorded_at)))::integer),
      'scheduled',
      now()
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.status = 'active'
      and p.team = 'runner';
    get diagnostics ping_count = row_count;

    -- Skip missed rounds instead of replaying a burst of identical snapshots.
    -- A game unread for days must not loop once per missed interval, so restart
    -- the cadence from this read when more than one round is behind.
    next_ping := current_game.next_ping_at
      + make_interval(secs => current_game.ping_interval_s);
    if next_ping <= now() then
      next_ping := now() + make_interval(secs => current_game.ping_interval_s);
    end if;

    update public.games g
      set ping_seq = g.ping_seq + 1,
          next_ping_at = next_ping
      where g.id = current_game.id
      returning * into current_game;

    if ping_count > 0 then
      insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'ping_released',
        jsonb_build_object(
          'seq', current_game.ping_seq,
          'count', ping_count,
          'next_ping_at', current_game.next_ping_at
        )
      );
    end if;
  end if;

  if current_game.status = 'live'
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
    update public.games g set
      status = 'ended',
      winner = case when g.mode = 'classic_chase' then 'hunters' else 'runners' end,
      end_reason = 'time_expired',
      ended_at = now()
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type, payload) values (
      current_game.id,
      'game_ended',
      jsonb_build_object('winner', current_game.winner, 'reason', 'time_expired')
    );
  end if;

  return current_game.status;
end;
$$;
