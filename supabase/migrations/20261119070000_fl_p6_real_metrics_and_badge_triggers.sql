-- Migration: 20261119070000_fl_p6_real_metrics_and_badge_triggers.sql
-- Description: Auto-calculate round scores, auto-award badges on game ended, and compute real best escape & distance in get_operative_profile.

-- 1. Ensure award_match_badges has p_user_id default auth.uid()
CREATE OR REPLACE FUNCTION public.award_match_badges(
  p_game_id uuid,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_game record;
  v_player record;
  v_matches_count integer;
  v_awarded jsonb := '[]'::jsonb;
  v_uid uuid := coalesce(p_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN v_awarded;
  END IF;

  SELECT * INTO v_game FROM public.games WHERE id = p_game_id;
  SELECT * INTO v_player FROM public.players WHERE game_id = p_game_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RETURN v_awarded;
  END IF;

  SELECT count(distinct game_id) INTO v_matches_count
  FROM public.players
  WHERE user_id = v_uid;

  -- 1. First Deployment
  IF v_matches_count >= 1 THEN
    INSERT INTO public.player_badges (user_id, badge_id, game_id, metadata)
    VALUES (v_uid, 'first_deployment', p_game_id, jsonb_build_object('matches', v_matches_count))
    ON CONFLICT DO NOTHING;
  END IF;

  -- 2. Veteran (10+ matches)
  IF v_matches_count >= 10 THEN
    INSERT INTO public.player_badges (user_id, badge_id, game_id, metadata)
    VALUES (v_uid, 'veteran_operative', p_game_id, jsonb_build_object('matches', v_matches_count))
    ON CONFLICT DO NOTHING;
  END IF;

  -- 3. Victorious Hunt / Clean Sweep
  IF v_player.team = 'hunter' AND v_game.winner = 'hunters' THEN
    INSERT INTO public.player_badges (user_id, badge_id, game_id, metadata)
    VALUES (v_uid, 'clean_sweep', p_game_id, '{}'::jsonb)
    ON CONFLICT DO NOTHING;
  END IF;

  -- 4. Elusive Runner / Escape
  IF v_player.team = 'runner' AND v_game.winner = 'runners' AND v_player.status = 'active' THEN
    INSERT INTO public.player_badges (user_id, badge_id, game_id, metadata)
    VALUES (v_uid, 'ghost_whisperer', p_game_id, '{}'::jsonb)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'badge_id', badge_id,
    'earned_at', earned_at
  )) INTO v_awarded
  FROM public.player_badges
  WHERE user_id = v_uid AND game_id = p_game_id;

  RETURN coalesce(v_awarded, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_match_badges(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.award_match_badges(uuid, uuid) TO service_role;

-- 2. Trigger on games status = 'ended' to auto-calculate scores and badges
CREATE OR REPLACE FUNCTION public.handle_game_ended_scoring_and_badges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_player record;
BEGIN
  IF NEW.status = 'ended' AND (OLD.status IS DISTINCT FROM 'ended') THEN
    -- A. Compute round scores for ranking & Season Echo
    BEGIN
      PERFORM public.compute_round_scores(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- Non-fatal scoring failure
    END;

    -- B. Award match badges for all participants
    FOR v_player IN SELECT user_id FROM public.players WHERE game_id = NEW.id LOOP
      BEGIN
        PERFORM public.award_match_badges(NEW.id, v_player.user_id);
      EXCEPTION WHEN OTHERS THEN
        -- Non-fatal badge failure
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_game_ended_scoring_and_badges ON public.games;
CREATE TRIGGER trg_game_ended_scoring_and_badges
  AFTER UPDATE OF status ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_game_ended_scoring_and_badges();

-- 3. Backfill badges and scores for existing ended games
DO $$
DECLARE
  v_game record;
  v_player record;
BEGIN
  FOR v_game IN SELECT id FROM public.games WHERE status = 'ended' LOOP
    BEGIN
      PERFORM public.compute_round_scores(v_game.id);
    EXCEPTION WHEN OTHERS THEN
    END;

    FOR v_player IN SELECT user_id FROM public.players WHERE game_id = v_game.id LOOP
      BEGIN
        PERFORM public.award_match_badges(v_game.id, v_player.user_id);
      EXCEPTION WHEN OTHERS THEN
      END;
    END LOOP;
  END LOOP;
END;
$$;

-- 4. Update get_operative_profile to calculate and return real best_escape and farthest_meters
CREATE OR REPLACE FUNCTION public.get_operative_profile(p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_target record;
  v_friendship record;
  v_is_self boolean := false;
  v_is_friend boolean := false;
  v_friendship_status text := 'none';
  v_ua uuid;
  v_ub uuid;
  v_presence jsonb := null;
  v_rounds int := 0;
  v_won int := 0;
  v_win_rate int := 0;
  v_never_caught int := 0;
  v_best_escape_s int := 0;
  v_best_escape text := '--';
  v_farthest_meters int := 0;
  v_season_echo numeric := 0;
  v_avg_best numeric := 0;
  v_avg_ghost numeric := 0;
  v_avg_cash numeric := 0;
  v_tier text := 'Whisper';
  v_badges jsonb := '[]'::jsonb;
  v_h2h jsonb := null;
  v_recent_matches jsonb := '[]'::jsonb;
  v_opposite_rounds int := 0;
  v_my_wins int := 0;
  v_friend_wins int := 0;
  v_times_ghosted int := 0;
  v_times_cashed int := 0;
BEGIN
  SELECT id, display_name, handle, color, profile_visibility, show_presence, share_echo, created_at
  INTO v_target
  FROM public.profiles
  WHERE id = p_target_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_caller_id IS NOT NULL THEN
    v_is_self := (v_caller_id = p_target_id);

    -- Check friendship status
    IF NOT v_is_self THEN
      v_ua := least(v_caller_id, p_target_id);
      v_ub := greatest(v_caller_id, p_target_id);

      SELECT status, requested_by INTO v_friendship
      FROM public.friendships
      WHERE user_a = v_ua AND user_b = v_ub;

      IF FOUND THEN
        IF v_friendship.status = 'accepted' THEN
          v_is_friend := true;
          v_friendship_status := 'friend';
        ELSIF v_friendship.status = 'pending' THEN
          IF v_friendship.requested_by = v_caller_id THEN
            v_friendship_status := 'pending_outgoing';
          ELSE
            v_friendship_status := 'pending_incoming';
          END IF;
        END IF;
      END IF;
    ELSE
      v_is_friend := true;
      v_friendship_status := 'self';
    END IF;
  ELSE
    v_is_self := false;
    v_is_friend := false;
    v_friendship_status := 'none';
  END IF;

  -- If not friends, not self, and profile is private: return redacted dossier
  IF NOT v_is_friend AND NOT v_is_self AND coalesce(v_target.profile_visibility, 'public') = 'private' THEN
    RETURN jsonb_build_object(
      'found', true,
      'user_id', v_target.id,
      'display_name', v_target.display_name,
      'handle', v_target.handle,
      'color', v_target.color,
      'visibility', 'private',
      'is_friend', false,
      'is_self', false,
      'friendship_status', v_friendship_status,
      'is_redacted', true
    );
  END IF;

  -- Compute career stats (including real best escape duration)
  SELECT
    count(distinct p.game_id),
    count(distinct p.game_id) FILTER (WHERE (p.team = 'runner' AND g.winner = 'runners') OR (p.team = 'hunter' AND g.winner = 'hunters')),
    count(distinct p.game_id) FILTER (WHERE p.team = 'runner' AND p.status = 'active' AND g.winner = 'runners'),
    coalesce(max(
      case
        when p.team = 'runner' and p.status = 'active' and g.winner = 'runners' then
          case
            when g.live_at is not null and g.ended_at is not null then
              greatest(0, floor(extract(epoch from (g.ended_at - g.live_at))))::int
            when g.duration_s is not null then
              g.duration_s
            else 0
          end
        else 0
      end
    ), 0)
  INTO v_rounds, v_won, v_never_caught, v_best_escape_s
  FROM public.players p
  JOIN public.games g ON g.id = p.game_id
  WHERE p.user_id = p_target_id AND g.status = 'ended';

  IF v_rounds > 0 THEN
    v_win_rate := round((v_won::numeric / v_rounds::numeric) * 100);
  END IF;

  IF v_best_escape_s > 0 THEN
    v_best_escape := (v_best_escape_s / 60)::text || 'm ' || (v_best_escape_s % 60)::text || 's';
  ELSE
    v_best_escape := '--';
  END IF;

  -- Compute real farthest single-round distance from trail_points
  BEGIN
    SELECT coalesce(max(dist_m), 0)::int
    INTO v_farthest_meters
    FROM (
      SELECT p.game_id,
             coalesce(round(ST_Length(ST_MakeLine(tp.geog::geometry ORDER BY tp.recorded_at)::geography)::numeric), 0)::int as dist_m
      FROM public.players p
      JOIN public.trail_points tp ON tp.game_id = p.game_id AND tp.player_id = p.id
      WHERE p.user_id = p_target_id
      GROUP BY p.game_id
    ) sub;
  EXCEPTION WHEN OTHERS THEN
    v_farthest_meters := 0;
  END;

  -- Compute current season Echo and Tier
  SELECT
    coalesce(sum(sub.echo) FILTER (WHERE sub.rnk <= 12), 0),
    coalesce(avg(sub.echo) FILTER (WHERE sub.rnk <= 12), 0),
    coalesce(avg(sub.y) FILTER (WHERE sub.role = 'runner'), 0),
    coalesce(avg(sub.y) FILTER (WHERE sub.role = 'hunter'), 0)
  INTO v_season_echo, v_avg_best, v_avg_ghost, v_avg_cash
  FROM (
    SELECT rs.echo, rs.y, rs.role, row_number() OVER (ORDER BY rs.echo DESC) as rnk
    FROM public.round_scores rs
    WHERE rs.user_id = p_target_id
      AND to_char(rs.ended_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM')
      AND rs.counted = true
      AND (rs.ended_at <= now() - interval '60 minutes' OR v_is_self)
  ) sub;

  IF v_avg_best >= 85 THEN v_tier := 'Revenant';
  ELSIF v_avg_best >= 70 THEN v_tier := 'Phantom';
  ELSIF v_avg_best >= 55 THEN v_tier := 'Wraith';
  ELSIF v_avg_best >= 40 THEN v_tier := 'Shade';
  ELSE v_tier := 'Whisper';
  END IF;

  -- Earned Badges
  SELECT coalesce(jsonb_agg(badge_id), '[]'::jsonb)
  INTO v_badges
  FROM public.player_badges
  WHERE user_id = p_target_id;

  -- Check Presence if friend or self
  IF (v_is_friend OR v_is_self) AND coalesce(v_target.show_presence, false) THEN
    SELECT jsonb_build_object(
      'online', true,
      'game_id', hp.game_id,
      'mode_id', hp.mode_id,
      'player_count', hp.player_count,
      'expires_at', hp.expires_at
    ) INTO v_presence
    FROM public.host_presence hp
    WHERE hp.user_id = p_target_id AND hp.expires_at > now();
  END IF;

  -- If friends and not self: compute Head-to-Head
  IF v_is_friend AND NOT v_is_self THEN
    SELECT
      count(distinct g.id),
      count(distinct g.id) FILTER (WHERE (p1.team = 'runner' AND g.winner = 'runners') OR (p1.team = 'hunter' AND g.winner = 'hunters')),
      count(distinct g.id) FILTER (WHERE (p2.team = 'runner' AND g.winner = 'runners') OR (p2.team = 'hunter' AND g.winner = 'hunters')),
      count(distinct g.id) FILTER (WHERE p1.team = 'runner' AND g.winner = 'runners' AND p2.team = 'hunter'),
      count(distinct g.id) FILTER (WHERE p2.team = 'runner' AND g.winner = 'runners' AND p1.team = 'hunter')
    INTO v_opposite_rounds, v_my_wins, v_friend_wins, v_times_ghosted, v_times_cashed
    FROM public.players p1
    JOIN public.players p2 ON p1.game_id = p2.game_id AND p2.user_id = p_target_id
    JOIN public.games g ON g.id = p1.game_id
    WHERE p1.user_id = v_caller_id
      AND p1.team IN ('runner', 'hunter')
      AND p2.team IN ('runner', 'hunter')
      AND p1.team != p2.team
      AND g.status = 'ended';

    v_h2h := jsonb_build_object(
      'opposite_rounds', v_opposite_rounds,
      'my_wins', v_my_wins,
      'friend_wins', v_friend_wins,
      'times_ghosted_them', v_times_ghosted,
      'times_they_cashed_me', v_times_cashed
    );
  END IF;

  -- If self or friend: return recent 5 match cards
  IF v_is_self OR v_is_friend THEN
    SELECT coalesce(jsonb_agg(sub.m), '[]'::jsonb)
    INTO v_recent_matches
    FROM (
      SELECT jsonb_build_object(
        'game_id', g2.id,
        'mode_id', g2.mode_id,
        'team', p2.team,
        'won', ((p2.team = 'runner' AND g2.winner = 'runners') OR (p2.team = 'hunter' AND g2.winner = 'hunters')),
        'created_at', coalesce(p2.joined_at, g2.created_at)
      ) as m
      FROM public.players p2
      JOIN public.games g2 ON g2.id = p2.game_id
      WHERE p2.user_id = p_target_id AND g2.status = 'ended'
      ORDER BY coalesce(p2.joined_at, g2.created_at) DESC
      LIMIT 5
    ) sub;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'user_id', v_target.id,
    'display_name', v_target.display_name,
    'handle', v_target.handle,
    'color', v_target.color,
    'visibility', coalesce(v_target.profile_visibility, 'public'),
    'is_friend', v_is_friend,
    'is_self', v_is_self,
    'friendship_status', v_friendship_status,
    'is_redacted', false,
    'presence', v_presence,
    'tier', v_tier,
    'season_echo', round(v_season_echo),
    'avg_best', round(v_avg_best, 1),
    'avg_ghost', round(v_avg_ghost, 1),
    'avg_cash', round(v_avg_cash, 1),
    'rounds', v_rounds,
    'won', v_won,
    'win_rate', v_win_rate,
    'never_caught', v_never_caught,
    'best_escape', v_best_escape,
    'farthest_meters', v_farthest_meters,
    'badges', v_badges,
    'head_to_head', v_h2h,
    'recent_matches', v_recent_matches
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_operative_profile(uuid) TO authenticated, anon;
