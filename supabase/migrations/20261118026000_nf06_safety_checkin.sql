-- GhostRun Migration: NF-06 Safety Check-in & Missed Check-in Alert
-- Adds report_missed_checkin and record_safety_checkin RPCs.

INSERT INTO public.app_settings (key, value)
VALUES ('feature.safety_checkin', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Record a successful check-in
CREATE OR REPLACE FUNCTION public.record_safety_checkin(game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller_id uuid := auth.uid();
  player_rec record;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO player_rec FROM public.players
  WHERE game_id = record_safety_checkin.game_id AND user_id = caller_id AND status <> 'left';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found in game.';
  END IF;

  UPDATE public.players
  SET status_detail = coalesce(status_detail, '{}'::jsonb) || jsonb_build_object('last_checkin_at', clock_timestamp())
  WHERE id = player_rec.id;

  RETURN jsonb_build_object('success', true, 'recorded_at', clock_timestamp());
END;
$$;

-- Report a missed check-in to teammates
CREATE OR REPLACE FUNCTION public.report_missed_checkin(game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  player_rec public.players%rowtype;
  profile_rec public.profiles%rowtype;
  latest_pos public.player_positions%rowtype;
  target_audience text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO current_game FROM public.games WHERE id = report_missed_checkin.game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found.';
  END IF;

  IF current_game.status NOT IN ('live', 'head_start') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'game_not_live');
  END IF;

  SELECT * INTO player_rec FROM public.players
  WHERE game_id = current_game.id AND user_id = caller_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'player_not_active');
  END IF;

  SELECT * INTO profile_rec FROM public.profiles WHERE id = caller_id;
  SELECT * INTO latest_pos FROM public.player_positions WHERE player_id = player_rec.id;

  -- Audience is player's team in team modes, or 'all' in solo modes (e.g. ghost_duel, assassin_ring)
  IF current_game.mode_id IN ('ghost_duel', 'assassin_ring') THEN
    target_audience := 'all';
  ELSE
    target_audience := player_rec.team;
  END IF;

  INSERT INTO public.events (game_id, type, audience, payload)
  VALUES (
    current_game.id,
    'checkin_missed',
    target_audience,
    jsonb_build_object(
      'player_id', player_rec.id,
      'display_name', profile_rec.display_name,
      'team', player_rec.team,
      'latitude', extensions.st_y(latest_pos.geog::extensions.geometry),
      'longitude', extensions.st_x(latest_pos.geog::extensions.geometry),
      'recorded_at', latest_pos.recorded_at,
      'message', profile_rec.display_name || ' missed safety check-in!'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event', 'checkin_missed',
    'audience', target_audience
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_safety_checkin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.record_safety_checkin(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.report_missed_checkin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.report_missed_checkin(uuid) TO authenticated;
