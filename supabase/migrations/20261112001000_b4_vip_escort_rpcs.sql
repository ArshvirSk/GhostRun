-- Migration: 20261112001000_b4_vip_escort_rpcs.sql
-- Role swap protocol RPCs for VIP Escort (request_role_swap, confirm_role_swap, cancel_role_swap)

create or replace function public.request_role_swap(
  p_game_id uuid,
  p_target_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  target_player public.players%rowtype;
  my_pos public.player_positions%rowtype;
  target_pos public.player_positions%rowtype;
  dist_m double precision;
  cooldown_until timestamptz;
  frozen_until timestamptz;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games where id = p_game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Role swaps can only happen while the round is live.';
  end if;
  if not ('vip' = any(current_game.roles)) then
    raise exception 'VIP Escort role is not enabled in this game.';
  end if;

  select * into me from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active'
  for update;
  if not found then raise exception 'You are not an active player in this game.'; end if;
  if me.team <> 'runner' then raise exception 'Only runners can participate in role swaps.'; end if;
  if me.secret_role not in ('vip', 'bodyguard') then
    raise exception 'Only the VIP or a bodyguard can initiate a role swap.';
  end if;

  -- Check if caller is frozen
  frozen_until := (me.status_detail->>'frozen_until')::timestamptz;
  if frozen_until is not null and frozen_until > now() then
    raise exception 'You cannot swap roles while frozen (frozen for % more seconds).',
      greatest(1, extract(epoch from (frozen_until - now()))::int);
  end if;

  -- Check swap cooldown
  cooldown_until := (me.status_detail->>'swap_cooldown_until')::timestamptz;
  if cooldown_until is not null and cooldown_until > now() then
    raise exception 'Role swap is on cooldown (% seconds remaining).',
      greatest(1, extract(epoch from (cooldown_until - now()))::int);
  end if;

  select * into target_player from public.players
  where id = p_target_player_id and game_id = p_game_id and status = 'active'
  for update;
  if not found then raise exception 'Target player not found or not active.'; end if;
  if target_player.id = me.id then raise exception 'You cannot swap roles with yourself.'; end if;
  if target_player.team <> 'runner' then raise exception 'Target player must be a runner teammate.'; end if;
  if target_player.secret_role not in ('vip', 'bodyguard') then
    raise exception 'Target player is not a VIP or bodyguard.';
  end if;

  -- Ensure one is VIP and the other is bodyguard
  if me.secret_role = target_player.secret_role then
    raise exception 'Role swaps must occur between a VIP and a bodyguard.';
  end if;

  -- Target cannot be frozen
  frozen_until := (target_player.status_detail->>'frozen_until')::timestamptz;
  if frozen_until is not null and frozen_until > now() then
    raise exception 'Target player is currently frozen and cannot swap roles.';
  end if;

  -- Target swap cooldown
  cooldown_until := (target_player.status_detail->>'swap_cooldown_until')::timestamptz;
  if cooldown_until is not null and cooldown_until > now() then
    raise exception 'Target player is on role swap cooldown.';
  end if;

  -- Check physical proximity (<= 5 m)
  select * into my_pos from public.player_positions where player_id = me.id;
  select * into target_pos from public.player_positions where player_id = target_player.id;
  if my_pos.geog is null or target_pos.geog is null then
    raise exception 'Both players must have an active GPS position.';
  end if;
  if now() - my_pos.recorded_at > interval '20 seconds' or now() - target_pos.recorded_at > interval '20 seconds' then
    raise exception 'Both players must have a fresh GPS fix to swap roles.';
  end if;

  dist_m := extensions.st_distance(my_pos.geog, target_pos.geog);
  if dist_m > (5.0 + least(10.0, (coalesce(my_pos.accuracy_m, 0) + coalesce(target_pos.accuracy_m, 0)) / 2.0)) then
    raise exception 'Target player is too far away (% m). Must be within 5 m to swap.', round(dist_m::numeric, 1);
  end if;

  -- Store pending swap on target player
  update public.players
  set status_detail = jsonb_set(
    coalesce(status_detail, '{}'::jsonb),
    '{pending_role_swap}',
    jsonb_build_object(
      'from_player_id', me.id,
      'from_role', me.secret_role,
      'requested_at', now()
    )
  )
  where id = target_player.id;

  insert into public.events (game_id, type, target_player, audience, payload)
  values (
    p_game_id,
    'role_swap_requested',
    target_player.id,
    'runner',
    jsonb_build_object(
      'requester_id', me.id,
      'requester_role', me.secret_role,
      'message', 'Incoming role swap request!'
    )
  );

  return jsonb_build_object(
    'success', true,
    'target_player_id', target_player.id,
    'distance_m', round(dist_m::numeric, 1)
  );
end;
$$;

create or replace function public.confirm_role_swap(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  requester public.players%rowtype;
  my_pos public.player_positions%rowtype;
  requester_pos public.player_positions%rowtype;
  pending jsonb;
  requester_id uuid;
  req_time timestamptz;
  dist_m double precision;
  cooldown_until timestamptz;
  frozen_until timestamptz;
  old_my_role text;
  old_req_role text;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games where id = p_game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Role swaps can only happen while the round is live.';
  end if;

  select * into me from public.players
  where game_id = p_game_id and user_id = caller_id and status = 'active'
  for update;
  if not found then raise exception 'You are not an active player in this game.'; end if;

  pending := me.status_detail->'pending_role_swap';
  if pending is null then
    raise exception 'No role swap request pending for you.';
  end if;

  requester_id := (pending->>'from_player_id')::uuid;
  req_time := (pending->>'requested_at')::timestamptz;

  if now() - req_time > interval '15 seconds' then
    update public.players
    set status_detail = status_detail - 'pending_role_swap'
    where id = me.id;
    raise exception 'The role swap request has expired.';
  end if;

  select * into requester from public.players
  where id = requester_id and game_id = p_game_id and status = 'active'
  for update;
  if not found then
    update public.players set status_detail = status_detail - 'pending_role_swap' where id = me.id;
    raise exception 'The requester is no longer active.';
  end if;

  -- Check freeze state
  frozen_until := (me.status_detail->>'frozen_until')::timestamptz;
  if frozen_until is not null and frozen_until > now() then
    raise exception 'You cannot swap roles while frozen.';
  end if;
  frozen_until := (requester.status_detail->>'frozen_until')::timestamptz;
  if frozen_until is not null and frozen_until > now() then
    raise exception 'The requester is currently frozen.';
  end if;

  -- Proximity check (5 m)
  select * into my_pos from public.player_positions where player_id = me.id;
  select * into requester_pos from public.player_positions where player_id = requester.id;
  if my_pos.geog is null or requester_pos.geog is null then
    raise exception 'Both players must have an active GPS position.';
  end if;

  dist_m := extensions.st_distance(my_pos.geog, requester_pos.geog);
  if dist_m > (5.0 + least(10.0, (coalesce(my_pos.accuracy_m, 0) + coalesce(requester_pos.accuracy_m, 0)) / 2.0)) then
    raise exception 'Requester is too far away (% m). Must be within 5 m to swap.', round(dist_m::numeric, 1);
  end if;

  old_my_role := me.secret_role;
  old_req_role := requester.secret_role;

  -- Cooldown of 3 minutes (180 s)
  cooldown_until := now() + interval '180 seconds';

  -- Swap roles
  update public.players
  set secret_role = old_req_role,
      status_detail = (status_detail - 'pending_role_swap') || jsonb_build_object(
        'is_vip', (old_req_role = 'vip'),
        'swap_cooldown_until', cooldown_until
      )
  where id = me.id;

  update public.players
  set secret_role = old_my_role,
      status_detail = coalesce(status_detail, '{}'::jsonb) || jsonb_build_object(
        'is_vip', (old_my_role = 'vip'),
        'swap_cooldown_until', cooldown_until
      )
  where id = requester.id;

  -- Emit event to runner squad only (hunters must NOT be notified!)
  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'roles_swapped',
    'runner',
    jsonb_build_object(
      'player1_id', me.id,
      'player2_id', requester.id,
      'new_vip_id', case when old_req_role = 'vip' then me.id else requester.id end,
      'message', 'VIP and Bodyguard have successfully swapped roles!'
    )
  );

  return jsonb_build_object(
    'success', true,
    'my_new_role', old_req_role,
    'swap_cooldown_s', 180
  );
end;
$$;

create or replace function public.cancel_role_swap(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into me from public.players where game_id = p_game_id and user_id = caller_id;
  if not found then raise exception 'Player not found.'; end if;

  update public.players
  set status_detail = status_detail - 'pending_role_swap'
  where id = me.id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.request_role_swap(uuid, uuid) to authenticated;
grant execute on function public.confirm_role_swap(uuid) to authenticated;
grant execute on function public.cancel_role_swap(uuid) to authenticated;

revoke all on function public.request_role_swap(uuid, uuid) from public, anon;
revoke all on function public.confirm_role_swap(uuid) from public, anon;
revoke all on function public.cancel_role_swap(uuid) from public, anon;
