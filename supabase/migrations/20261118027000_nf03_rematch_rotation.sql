-- GhostRun Migration: NF-03 Rematch & Role Rotation
-- Adds rotate_teams RPC and updates rematch_game to support automatic role rotation.

CREATE OR REPLACE FUNCTION public.rotate_teams(game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller_id uuid := auth.uid();
  game_rec public.games%rowtype;
  player_total int;
  target_hunters int;
  curr_hunter_ids uuid[];
  curr_runner_ids uuid[];
  new_hunter_ids uuid[];
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO game_rec FROM public.games WHERE id = rotate_teams.game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found.';
  END IF;

  IF game_rec.status <> 'lobby' THEN
    RAISE EXCEPTION 'Teams can only be rotated in the lobby.';
  END IF;

  IF game_rec.host_id <> caller_id THEN
    RAISE EXCEPTION 'Only the host can rotate teams.';
  END IF;

  SELECT count(*) INTO player_total
  FROM public.players
  WHERE game_id = game_rec.id AND status = 'active';

  IF player_total < 2 THEN
    RAISE EXCEPTION 'At least two players are required to rotate teams.';
  END IF;

  -- Hunter ratio guard: 1 hunter per 3-4 players, never more hunters than runners
  target_hunters := least(greatest(1, floor(player_total / 3)), floor((player_total - 1) / 2));

  -- Get current team arrays ordered by joined_at
  SELECT array_agg(id ORDER BY joined_at) INTO curr_hunter_ids
  FROM public.players
  WHERE game_id = game_rec.id AND status = 'active' AND team = 'hunter';

  SELECT array_agg(id ORDER BY joined_at) INTO curr_runner_ids
  FROM public.players
  WHERE game_id = game_rec.id AND status = 'active' AND team <> 'hunter';

  -- Select next batch of hunters from previous runners first
  IF curr_runner_ids IS NOT NULL AND array_length(curr_runner_ids, 1) > 0 THEN
    new_hunter_ids := curr_runner_ids[1:least(target_hunters, array_length(curr_runner_ids, 1))];
  ELSE
    new_hunter_ids := '{}'::uuid[];
  END IF;

  -- Set everyone to runner first
  UPDATE public.players
  SET team = 'runner'
  WHERE game_id = game_rec.id AND status = 'active';

  -- Promote the selected players to hunter
  IF array_length(new_hunter_ids, 1) > 0 THEN
    UPDATE public.players
    SET team = 'hunter'
    WHERE id = ANY(new_hunter_ids);
  END IF;

  -- Insert event
  INSERT INTO public.events (game_id, type, audience, payload)
  VALUES (
    game_rec.id, 'teams_rotated', 'all',
    jsonb_build_object(
      'rotated_by', caller_id,
      'hunter_count', array_length(new_hunter_ids, 1)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'hunter_count', array_length(new_hunter_ids, 1)
  );
END;
$$;

-- Overload rematch_game to support role rotation flag
CREATE OR REPLACE FUNCTION public.rematch_game(p_game_id uuid, p_rotate boolean DEFAULT true)
RETURNS TABLE (game_id uuid, code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller_id uuid := auth.uid();
  source_game public.games%rowtype;
  new_id uuid;
  new_code text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  attempt integer := 0;
  next_host uuid;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication is required.'; END IF;

  SELECT * INTO source_game FROM public.games g WHERE g.id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.game_id = source_game.id AND p.user_id = caller_id AND p.status <> 'left'
  ) THEN
    RAISE EXCEPTION 'You are not a member of this game.';
  END IF;
  IF source_game.status <> 'ended' THEN
    RAISE EXCEPTION 'A rematch can only start after the round ends.';
  END IF;

  IF source_game.rematch_game_id IS NOT NULL THEN
    RETURN QUERY SELECT g.id, g.code FROM public.games g WHERE g.id = source_game.rematch_game_id;
    RETURN;
  END IF;

  SELECT p.user_id INTO next_host
  FROM public.players p
  WHERE p.game_id = source_game.id
    AND p.user_id = source_game.host_id
    AND p.status <> 'left'
  LIMIT 1;
  next_host := coalesce(next_host, caller_id);

  LOOP
    attempt := attempt + 1;
    new_code := '';
    FOR i IN 1..4 LOOP
      new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    END LOOP;
    EXIT WHEN new_code <> source_game.code AND NOT EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.code = new_code AND g.status NOT IN ('ended', 'cancelled')
    );
    IF attempt >= 20 THEN RAISE EXCEPTION 'Could not allocate a game code. Try again.'; END IF;
  END LOOP;

  INSERT INTO public.games (
    code, host_id, mode, mode_id, roles, modifiers, mode_params,
    area_center, area_radius_m,
    head_start_s, duration_s, ping_interval_s, tag_radius_m, target_radius_m,
    boundary_grace_s, boundary_penalty
  ) VALUES (
    new_code, next_host, source_game.mode, source_game.mode_id,
    source_game.roles, source_game.modifiers, source_game.mode_params,
    source_game.area_center, source_game.area_radius_m,
    source_game.head_start_s, source_game.duration_s, source_game.ping_interval_s,
    source_game.tag_radius_m, source_game.target_radius_m,
    source_game.boundary_grace_s, source_game.boundary_penalty
  ) RETURNING id INTO new_id;

  INSERT INTO public.players (game_id, user_id, team, status, is_ready)
  SELECT new_id, p.user_id, p.team, 'active', false
  FROM public.players p
  WHERE p.game_id = source_game.id AND p.status <> 'left'
  ORDER BY p.joined_at;

  -- Apply role rotation if requested
  IF p_rotate AND source_game.mode_id NOT IN ('ghost_duel', 'assassin_ring') THEN
    BEGIN
      PERFORM public.rotate_teams(new_id);
    EXCEPTION WHEN OTHERS THEN
      -- Non-blocking: fallback to copied teams if rotation fails
    END;
  END IF;

  INSERT INTO public.events (game_id, type, payload)
  VALUES (
    new_id, 'rematch_created',
    jsonb_build_object('previous_game_id', source_game.id, 'started_by', caller_id, 'rotated', p_rotate)
  );

  UPDATE public.games SET rematch_game_id = new_id WHERE id = source_game.id;

  RETURN QUERY SELECT new_id, new_code;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_teams(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rotate_teams(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rematch_game(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.rematch_game(uuid, boolean) TO authenticated;
