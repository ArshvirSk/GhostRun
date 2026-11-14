-- GhostRun Migration: NF-04 Pre-Game Ready Check & Tracking Health
-- Adds tracking_health enum column on players, feature flag, and submit_tracking_health RPC.

-- 1. Feature Flag
INSERT INTO public.app_settings (key, value)
VALUES ('feature.ready_check', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. Players tracking_health column
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS tracking_health text NOT NULL DEFAULT 'unknown'
  CHECK (tracking_health IN ('healthy', 'warning', 'degraded', 'unknown'));

-- 3. Security Definer RPC: submit_tracking_health
CREATE OR REPLACE FUNCTION public.submit_tracking_health(
  game_id uuid,
  health text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller_id uuid := auth.uid();
  game_rec record;
  player_rec record;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF health NOT IN ('healthy', 'warning', 'degraded') THEN
    RAISE EXCEPTION 'Invalid tracking health state: %', health;
  END IF;

  SELECT status INTO game_rec FROM public.games WHERE id = submit_tracking_health.game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found.';
  END IF;

  IF game_rec.status <> 'lobby' THEN
    RAISE EXCEPTION 'Tracking health can only be updated in lobby.';
  END IF;

  SELECT id INTO player_rec FROM public.players
  WHERE game_id = submit_tracking_health.game_id AND user_id = caller_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a player in this game.';
  END IF;

  UPDATE public.players
  SET tracking_health = submit_tracking_health.health
  WHERE id = player_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'tracking_health', health
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_tracking_health(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_tracking_health(uuid, text) TO authenticated;
