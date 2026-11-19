-- Migration: 20261120110000_fl_p10_fix_operative_profile_and_search.sql
-- Description: Disallow bare #tag search (require USERNAME#TAG), fix get_operative_profile p.won schema error, and include tagline in profile dossier.

-- 1. Updated search_operatives RPC: disallows bare #tag search (requires USERNAME#TAG or @USERNAME#TAG)
CREATE OR REPLACE FUNCTION public.search_operatives(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_raw text := trim(p_query);
  v_clean text;
  v_name_part text;
  v_tag_part text;
  v_norm_name text;
  v_results jsonb;
BEGIN
  IF v_raw IS NULL OR length(v_raw) = 0 THEN
    RETURN jsonb_build_array();
  END IF;

  v_clean := v_raw;
  IF starts_with(v_clean, '@') THEN
    v_clean := substring(v_clean from 2);
  END IF;
  v_clean := trim(v_clean);

  -- If query contains "#", require non-empty username part (disallow bare #tag search)
  IF position('#' in v_clean) > 0 THEN
    v_name_part := trim(split_part(v_clean, '#', 1));
    v_tag_part := upper(trim(split_part(v_clean, '#', 2)));

    IF starts_with(v_name_part, '@') THEN
      v_name_part := substring(v_name_part from 2);
    END IF;
    v_norm_name := regexp_replace(lower(v_name_part), '[\s_\-]+', '', 'g');

    -- Bare tag search (#TAG) is NOT permitted: must provide a username
    IF length(v_norm_name) < 1 THEN
      RETURN jsonb_build_array();
    END IF;

    SELECT jsonb_agg(sub) INTO v_results
    FROM (
      SELECT
        p.id,
        p.display_name,
        p.tagline,
        p.handle::text,
        p.color,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM public.friendships f
            WHERE ((f.user_a = v_caller_id AND f.user_b = p.id) OR (f.user_b = v_caller_id AND f.user_a = p.id))
              AND f.status = 'accepted'
          ) THEN 'friend'
          WHEN EXISTS (
            SELECT 1 FROM public.friendships f
            WHERE f.requested_by = v_caller_id
              AND ((f.user_a = v_caller_id AND f.user_b = p.id) OR (f.user_b = v_caller_id AND f.user_a = p.id))
              AND f.status = 'pending'
          ) THEN 'pending_outgoing'
          WHEN EXISTS (
            SELECT 1 FROM public.friendships f
            WHERE f.requested_by = p.id
              AND ((f.user_a = v_caller_id AND f.user_b = p.id) OR (f.user_b = v_caller_id AND f.user_a = p.id))
              AND f.status = 'pending'
          ) THEN 'pending_incoming'
          ELSE 'none'
        END AS relationship
      FROM public.profiles p
      WHERE (v_caller_id IS NULL OR p.id <> v_caller_id)
        AND (
          -- If tag provided, match tag AND name
          (length(v_tag_part) > 0 AND p.tagline = v_tag_part AND (
            regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%')
            OR (p.handle IS NOT NULL AND regexp_replace(lower(p.handle::text), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%'))
          ))
          -- If tag empty after # (e.g. "GHOST#"), match name
          OR (length(v_tag_part) = 0 AND (
            regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%')
            OR (p.handle IS NOT NULL AND regexp_replace(lower(p.handle::text), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%'))
          ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE (v_caller_id IS NOT NULL) AND (
            (b.user_id = v_caller_id AND b.blocked_user_id = p.id)
            OR (b.user_id = p.id AND b.blocked_user_id = v_caller_id)
          )
        )
      ORDER BY
        CASE
          WHEN regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') = v_norm_name AND p.tagline = v_tag_part THEN 1
          WHEN regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') = v_norm_name THEN 2
          ELSE 3
        END,
        p.display_name ASC
      LIMIT 20
    ) sub;

    RETURN coalesce(v_results, jsonb_build_array());
  END IF;

  -- Standard query without "#": ONLY search by username / handle (NO bare tagline search)
  v_norm_name := regexp_replace(lower(v_clean), '[\s_\-]+', '', 'g');
  IF length(v_norm_name) < 1 THEN
    RETURN jsonb_build_array();
  END IF;

  SELECT jsonb_agg(sub) INTO v_results
  FROM (
    SELECT
      p.id,
      p.display_name,
      p.tagline,
      p.handle::text,
      p.color,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE ((f.user_a = v_caller_id AND f.user_b = p.id) OR (f.user_b = v_caller_id AND f.user_a = p.id))
            AND f.status = 'accepted'
        ) THEN 'friend'
        WHEN EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.requested_by = v_caller_id
            AND ((f.user_a = v_caller_id AND f.user_b = p.id) OR (f.user_b = v_caller_id AND f.user_a = p.id))
            AND f.status = 'pending'
        ) THEN 'pending_outgoing'
        WHEN EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.requested_by = p.id
            AND ((f.user_a = v_caller_id AND f.user_b = p.id) OR (f.user_b = v_caller_id AND f.user_a = p.id))
            AND f.status = 'pending'
        ) THEN 'pending_incoming'
        ELSE 'none'
      END AS relationship
    FROM public.profiles p
    WHERE (v_caller_id IS NULL OR p.id <> v_caller_id)
      AND (
        p.display_name ILIKE ('%' || v_clean || '%')
        OR (p.handle IS NOT NULL AND p.handle::text ILIKE ('%' || v_clean || '%'))
        OR regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%')
        OR (p.handle IS NOT NULL AND regexp_replace(lower(p.handle::text), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE (v_caller_id IS NOT NULL) AND (
          (b.user_id = v_caller_id AND b.blocked_user_id = p.id)
          OR (b.user_id = p.id AND b.blocked_user_id = v_caller_id)
        )
      )
    ORDER BY
      CASE
        WHEN regexp_replace(lower(coalesce(p.handle::text, '')), '[\s_\-]+', '', 'g') = v_norm_name THEN 1
        WHEN regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') = v_norm_name THEN 2
        WHEN regexp_replace(lower(coalesce(p.handle::text, '')), '[\s_\-]+', '', 'g') LIKE (v_norm_name || '%') THEN 3
        WHEN regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') LIKE (v_norm_name || '%') THEN 4
        ELSE 5
      END,
      p.display_name ASC
    LIMIT 20
  ) sub;

  RETURN coalesce(v_results, jsonb_build_array());
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_operatives(text) TO authenticated, anon;

-- 2. Fixed get_operative_profile RPC: uses accurate columns (games.winner, players.team) and includes tagline
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
  SELECT id, display_name, tagline, handle, color, profile_visibility, show_presence, share_echo, created_at
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
      'tagline', v_target.tagline,
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
    'tagline', v_target.tagline,
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
