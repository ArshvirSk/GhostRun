-- Wave 6: FL-P2 Echo Scoring Engine Schema & RPCs

-- 1. Anti-Cheat Flags on Players
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS mock_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vehicle_speed_detected boolean NOT NULL DEFAULT false;

-- 2. Scoring Profiles Table
CREATE TABLE IF NOT EXISTS public.scoring_profiles (
  mode_id text PRIMARY KEY,
  ranked boolean NOT NULL DEFAULT false,
  weights jsonb NOT NULL,
  outcome_map jsonb NOT NULL,
  params jsonb NOT NULL
);

ALTER TABLE public.scoring_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY scoring_profiles_select ON public.scoring_profiles
  FOR SELECT TO authenticated, anon
  USING (true);

-- Seed Ranked & Unranked Mode Profiles
INSERT INTO public.scoring_profiles (mode_id, ranked, weights, outcome_map, params)
VALUES
  ('classic_chase', true, '{"o": 0.4, "y": 0.4, "p": 0.2}'::jsonb, '{"win": 1.0, "tagged_win": 0.8, "loss": 0.0}'::jsonb, '{"r_press_m": 200, "active_move_m": 50, "k": 3}'::jsonb),
  ('tag_hunt', true, '{"o": 0.4, "y": 0.4, "p": 0.2}'::jsonb, '{"win": 1.0, "tagged_win": 0.6, "loss": 0.0}'::jsonb, '{"r_press_m": 200, "active_move_m": 50, "k": 3}'::jsonb),
  ('jailbreak', true, '{"o": 0.4, "y": 0.4, "p": 0.2}'::jsonb, '{"win": 1.0, "tagged_win": 0.6, "loss": 0.0}'::jsonb, '{"r_press_m": 200, "active_move_m": 50, "k": 3}'::jsonb),
  ('assassin_ring', false, '{"o": 0.4, "y": 0.4, "p": 0.2}'::jsonb, '{"win": 1.0, "loss": 0.0}'::jsonb, '{"r_press_m": 200, "active_move_m": 50, "k": 3}'::jsonb),
  ('relay_heist', false, '{"o": 0.4, "y": 0.4, "p": 0.2}'::jsonb, '{"win": 1.0, "loss": 0.0}'::jsonb, '{"r_press_m": 200, "active_move_m": 50, "k": 3}'::jsonb),
  ('territory_pulse', false, '{"o": 0.4, "y": 0.4, "p": 0.2}'::jsonb, '{"win": 1.0, "loss": 0.0}'::jsonb, '{"r_press_m": 200, "active_move_m": 50, "k": 3}'::jsonb)
ON CONFLICT (mode_id) DO UPDATE
  SET ranked = excluded.ranked,
      weights = excluded.weights,
      outcome_map = excluded.outcome_map,
      params = excluded.params;

-- 3. Round Scores Table
CREATE TABLE IF NOT EXISTS public.round_scores (
  game_id uuid REFERENCES public.games(id) ON DELETE CASCADE,
  player_id uuid REFERENCES public.players(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode_id text NOT NULL,
  role text NOT NULL,
  o real,
  y real,
  p real,
  d real,
  echo real,
  contested int,
  hit int,
  counted boolean NOT NULL DEFAULT false,
  excluded_reason text,
  ended_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS round_scores_user_idx ON public.round_scores(user_id, ended_at desc);
CREATE INDEX IF NOT EXISTS round_scores_game_idx ON public.round_scores(game_id);

ALTER TABLE public.round_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY round_scores_select_own ON public.round_scores
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 4. Season Scores Table
CREATE TABLE IF NOT EXISTS public.season_scores (
  season text NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  echo_total real NOT NULL,
  rounds_counted int NOT NULL,
  avg_best real,
  avg_ghost real,
  avg_cash real,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, user_id)
);

CREATE INDEX IF NOT EXISTS season_scores_ranking_idx ON public.season_scores(season, echo_total desc);

ALTER TABLE public.season_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY season_scores_select_own ON public.season_scores
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 5. RPC: compute_round_scores
CREATE OR REPLACE FUNCTION public.compute_round_scores(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_game record;
  v_profile record;
  v_player record;
  v_h_count int;
  v_r_count int;
  v_ratio real;
  v_d_runner real;
  v_d_hunter real;
  v_live_duration_s real;
  v_round_valid boolean := true;
  v_fail_reason text := null;
  v_ping_count int;
  v_active_share real;
  v_score_count int := 0;
  v_o real;
  v_y real;
  v_p real;
  v_d real;
  v_echo real;
  v_contested int;
  v_hit int;
BEGIN
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  SELECT * INTO v_profile FROM public.scoring_profiles WHERE mode_id = v_game.mode_id;
  IF NOT FOUND OR NOT v_profile.ranked THEN
    v_round_valid := false;
    v_fail_reason := 'mode_unranked';
  END IF;

  -- Count hunters and runners
  SELECT count(*) FILTER (WHERE team = 'hunter' AND NOT is_remote),
         count(*) FILTER (WHERE team = 'runner' AND NOT is_remote)
  INTO v_h_count, v_r_count
  FROM public.players
  WHERE game_id = p_game_id;

  IF v_h_count < 1 OR v_r_count < 2 THEN
    v_round_valid := false;
    v_fail_reason := 'insufficient_players';
  END IF;

  -- Live duration check (at least 5 min / 300s)
  IF v_game.live_at IS NOT NULL AND v_game.ended_at IS NOT NULL THEN
    v_live_duration_s := EXTRACT(EPOCH FROM (v_game.ended_at - v_game.live_at));
    IF v_live_duration_s < 300 THEN
      v_round_valid := false;
      v_fail_reason := 'duration_too_short';
    END IF;
  ELSE
    v_round_valid := false;
    v_fail_reason := 'incomplete_game';
  END IF;

  -- Calculate Difficulty D
  v_ratio := (v_h_count::real / greatest(v_r_count::real, 1.0));
  v_d_runner := 1.0 + 0.15 * greatest(-1.0, least(1.0, (v_ratio - 0.5) / 0.5));
  v_d_hunter := 1.0 - 0.15 * greatest(-1.0, least(1.0, (v_ratio - 0.5) / 0.5));

  -- Process each player
  FOR v_player IN SELECT * FROM public.players WHERE game_id = p_game_id LOOP
    -- Remote operators earn 0 Echo
    IF v_player.is_remote THEN
      INSERT INTO public.round_scores (
        game_id, player_id, user_id, mode_id, role, o, y, p, d, echo,
        contested, hit, counted, excluded_reason, ended_at
      ) VALUES (
        p_game_id, v_player.id, v_player.user_id, v_game.mode_id, 'operator',
        0, 0, 0, 1.0, 0, 0, 0, false, 'operator_role', coalesce(v_game.ended_at, now())
      ) ON CONFLICT (game_id, player_id) DO NOTHING;
      CONTINUE;
    END IF;

    -- Early leave penalty
    IF v_player.status = 'left' THEN
      INSERT INTO public.round_scores (
        game_id, player_id, user_id, mode_id, role, o, y, p, d, echo,
        contested, hit, counted, excluded_reason, ended_at
      ) VALUES (
        p_game_id, v_player.id, v_player.user_id, v_game.mode_id, v_player.team::text,
        0, 0, 0, 1.0, 0, 0, 0, false, 'left_early', coalesce(v_game.ended_at, now())
      ) ON CONFLICT (game_id, player_id) DO NOTHING;
      CONTINUE;
    END IF;

    -- Mock GPS or vehicle detected
    IF v_player.mock_detected OR v_player.vehicle_speed_detected THEN
      INSERT INTO public.round_scores (
        game_id, player_id, user_id, mode_id, role, o, y, p, d, echo,
        contested, hit, counted, excluded_reason, ended_at
      ) VALUES (
        p_game_id, v_player.id, v_player.user_id, v_game.mode_id, v_player.team::text,
        0, 0, 0, 1.0, 0, 0, 0, false, 'anti_cheat_flag', coalesce(v_game.ended_at, now())
      ) ON CONFLICT (game_id, player_id) DO NOTHING;
      CONTINUE;
    END IF;

    -- Outcome O
    IF v_game.end_reason = 'host_ended' THEN
      v_o := 0.0;
    ELSIF v_player.team = 'runner' THEN
      IF v_game.winner = 'runners' THEN
        v_o := 1.0;
      ELSE
        v_o := 0.0;
      END IF;
    ELSIF v_player.team = 'hunter' THEN
      IF v_game.winner = 'hunters' THEN
        v_o := 1.0;
      ELSE
        v_o := 0.0;
      END IF;
    ELSE
      v_o := 0.0;
    END IF;

    -- Yield Y & Contested
    SELECT count(*) INTO v_ping_count FROM public.pings WHERE game_id = p_game_id;
    IF v_player.team = 'runner' THEN
      v_d := v_d_runner;
      v_contested := greatest(1, v_ping_count);
      IF v_player.status = 'active' THEN
        v_hit := greatest(1, (v_contested * 2) / 3);
      ELSE
        v_hit := (v_contested / 3);
      END IF;
      v_y := (v_hit::real + 1.5) / (v_contested::real + 3.0);
      v_p := CASE WHEN v_player.status = 'active' THEN 0.95 ELSE 0.65 END;
    ELSE
      v_d := v_d_hunter;
      v_contested := greatest(1, v_ping_count);
      IF v_game.winner = 'hunters' THEN
        v_hit := greatest(1, (v_contested / 2));
      ELSE
        v_hit := 0;
      END IF;
      v_y := (v_hit::real + 1.5) / (v_contested::real + 3.0);
      v_p := 0.85;
    END IF;

    v_echo := round(100.0 * (0.40 * v_o + 0.40 * v_y + 0.20 * v_p) * v_d);

    INSERT INTO public.round_scores (
      game_id, player_id, user_id, mode_id, role, o, y, p, d, echo,
      contested, hit, counted, excluded_reason, ended_at
    ) VALUES (
      p_game_id, v_player.id, v_player.user_id, v_game.mode_id, v_player.team::text,
      v_o, v_y, v_p, v_d, v_echo, v_contested, v_hit, v_round_valid, v_fail_reason,
      coalesce(v_game.ended_at, now())
    ) ON CONFLICT (game_id, player_id) DO UPDATE
      SET o = excluded.o,
          y = excluded.y,
          p = excluded.p,
          d = excluded.d,
          echo = excluded.echo,
          contested = excluded.contested,
          hit = excluded.hit,
          counted = excluded.counted,
          excluded_reason = excluded.excluded_reason;

    v_score_count := v_score_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'scores_computed', v_score_count,
    'counted', v_round_valid,
    'reason', v_fail_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_round_scores(uuid) TO authenticated;

-- 6. RPC: refresh_season_scores
CREATE OR REPLACE FUNCTION public.refresh_season_scores(p_season text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_season text := coalesce(p_season, to_char(now(), 'YYYY-MM'));
  v_user record;
  v_rounds record;
  v_best12_sum real;
  v_count int;
  v_avg_best real;
  v_avg_ghost real;
  v_avg_cash real;
BEGIN
  FOR v_user IN
    SELECT DISTINCT user_id FROM public.round_scores
    WHERE to_char(ended_at, 'YYYY-MM') = v_season AND counted = true
  LOOP
    -- Fetch top 12 counted rounds
    SELECT
      coalesce(sum(sub.echo), 0),
      count(*),
      coalesce(avg(sub.echo), 0),
      coalesce(avg(sub.y) FILTER (WHERE sub.role = 'runner'), 0),
      coalesce(avg(sub.y) FILTER (WHERE sub.role = 'hunter'), 0)
    INTO v_best12_sum, v_count, v_avg_best, v_avg_ghost, v_avg_cash
    FROM (
      SELECT echo, y, role
      FROM public.round_scores
      WHERE user_id = v_user.user_id
        AND to_char(ended_at, 'YYYY-MM') = v_season
        AND counted = true
      ORDER BY echo DESC
      LIMIT 12
    ) sub;

    INSERT INTO public.season_scores (
      season, user_id, echo_total, rounds_counted, avg_best, avg_ghost, avg_cash, updated_at
    ) VALUES (
      v_season, v_user.user_id, v_best12_sum, v_count, v_avg_best, v_avg_ghost, v_avg_cash, now()
    ) ON CONFLICT (season, user_id) DO UPDATE
      SET echo_total = excluded.echo_total,
          rounds_counted = excluded.rounds_counted,
          avg_best = excluded.avg_best,
          avg_ghost = excluded.avg_ghost,
          avg_cash = excluded.avg_cash,
          updated_at = now();
  END LOOP;

  RETURN jsonb_build_object('success', true, 'season', v_season);
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_season_scores(text) TO authenticated;

-- 7. RPC: get_player_echo_profile
CREATE OR REPLACE FUNCTION public.get_player_echo_profile(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_season text := to_char(now(), 'YYYY-MM');
  v_rec record;
  v_tier text := 'Whisper';
  v_best_round real := 0;
BEGIN
  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('has_profile', false);
  END IF;

  SELECT * INTO v_rec FROM public.season_scores
  WHERE season = v_season AND user_id = v_target_id;

  SELECT coalesce(max(echo), 0) INTO v_best_round
  FROM public.round_scores
  WHERE user_id = v_target_id AND counted = true;

  IF FOUND AND v_rec.avg_best IS NOT NULL THEN
    IF v_rec.avg_best >= 85 THEN
      v_tier := 'Revenant';
    ELSIF v_rec.avg_best >= 70 THEN
      v_tier := 'Phantom';
    ELSIF v_rec.avg_best >= 55 THEN
      v_tier := 'Wraith';
    ELSIF v_rec.avg_best >= 40 THEN
      v_tier := 'Shade';
    ELSE
      v_tier := 'Whisper';
    END IF;

    RETURN jsonb_build_object(
      'season', v_season,
      'echo_total', v_rec.echo_total,
      'rounds_counted', v_rec.rounds_counted,
      'avg_best', v_rec.avg_best,
      'avg_ghost', v_rec.avg_ghost,
      'avg_cash', v_rec.avg_cash,
      'tier', v_tier,
      'best_round', v_best_round
    );
  END IF;

  RETURN jsonb_build_object(
    'season', v_season,
    'echo_total', 0,
    'rounds_counted', 0,
    'avg_best', 0,
    'avg_ghost', 0,
    'avg_cash', 0,
    'tier', 'Whisper',
    'best_round', v_best_round
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_player_echo_profile(uuid) TO authenticated;
