-- NF-09: Boundary Rule Options (reveal_live, auto_tag)

-- 1. Update constraint on public.games
alter table public.games drop constraint if exists games_boundary_penalty_check;
alter table public.games add constraint games_boundary_penalty_check
  check (boundary_penalty in ('warn', 'extra_ping', 'reveal_live', 'auto_tag'));

-- 2. RPC record_boundary_violation
-- Invoked during match lifecycle when a runner has stayed outside beyond grace threshold
create or replace function public.record_boundary_violation(
  p_game_id uuid,
  p_player_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_seconds_outside integer
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game record;
  v_player record;
  v_point extensions.geography;
  v_new_ping_id uuid;
  v_action text := 'none';
begin
  select * into v_game from public.games where id = p_game_id;
  if not found or v_game.status <> 'live' then
    return jsonb_build_object('status', 'ignored', 'reason', 'game_not_live');
  end if;

  select * into v_player from public.players where id = p_player_id and game_id = p_game_id;
  if not found or v_player.status <> 'active' or v_player.team <> 'runner' then
    return jsonb_build_object('status', 'ignored', 'reason', 'player_not_active_runner');
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  -- Case A: auto_tag penalty (exceeded 120s or threshold)
  if v_game.boundary_penalty = 'auto_tag' and p_seconds_outside >= 120 then
    update public.players
    set status = 'tagged',
        tagged_at = now()
    where id = p_player_id;

    insert into public.events (
      game_id,
      player_id,
      type,
      payload
    ) values (
      p_game_id,
      p_player_id,
      'runner_tagged',
      jsonb_build_object(
        'runner_id', p_player_id,
        'reason', 'auto_tag_boundary',
        'seconds_outside', p_seconds_outside
      )
    );

    v_action := 'auto_tagged';

  -- Case B: reveal_live penalty (frequent pings every 5s while outside)
  elsif v_game.boundary_penalty = 'reveal_live' and p_seconds_outside >= v_game.boundary_grace_s then
    insert into public.pings (
      game_id,
      player_id,
      seq,
      location,
      noise_factor,
      revealed_at
    ) values (
      p_game_id,
      p_player_id,
      v_game.ping_seq + 1,
      v_point,
      0,
      now()
    )
    returning id into v_new_ping_id;

    insert into public.events (
      game_id,
      player_id,
      type,
      payload
    ) values (
      p_game_id,
      p_player_id,
      'boundary_penalty',
      jsonb_build_object(
        'runner_id', p_player_id,
        'penalty', 'reveal_live',
        'ping_id', v_new_ping_id,
        'seconds_outside', p_seconds_outside
      )
    );

    v_action := 'live_ping_released';

  -- Case C: standard extra_ping (one-time extra ping upon breach)
  elsif v_game.boundary_penalty = 'extra_ping' then
    insert into public.pings (
      game_id,
      player_id,
      seq,
      location,
      noise_factor,
      revealed_at
    ) values (
      p_game_id,
      p_player_id,
      v_game.ping_seq + 1,
      v_point,
      0,
      now()
    )
    returning id into v_new_ping_id;

    insert into public.events (
      game_id,
      player_id,
      type,
      payload
    ) values (
      p_game_id,
      p_player_id,
      'boundary_penalty',
      jsonb_build_object(
        'runner_id', p_player_id,
        'penalty', 'extra_ping',
        'ping_id', v_new_ping_id
      )
    );

    v_action := 'extra_ping_released';
  end if;

  return jsonb_build_object(
    'status', 'success',
    'action', v_action,
    'penalty', v_game.boundary_penalty,
    'seconds_outside', p_seconds_outside
  );
end;
$$;
