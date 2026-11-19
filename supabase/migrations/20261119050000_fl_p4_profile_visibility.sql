-- Wave 6: FL-P4 Profile Visibility & Operative Profile RPC

-- 1. Profiles Privacy Column
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'public'
CHECK (profile_visibility IN ('public', 'private'));

-- 2. Update set_friend_settings RPC with profile_visibility
CREATE OR REPLACE FUNCTION public.set_friend_settings(
  p_allow_requests boolean,
  p_show_presence boolean,
  p_share_echo boolean,
  p_profile_visibility text DEFAULT 'public'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_vis text := coalesce(p_profile_visibility, 'public');
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_vis NOT IN ('public', 'private') THEN
    v_vis := 'public';
  END IF;

  UPDATE public.profiles
  SET allow_friend_requests = p_allow_requests,
      show_presence = p_show_presence,
      share_echo = p_share_echo,
      profile_visibility = v_vis
  WHERE id = v_caller_id;

  -- Append to consent audit log
  INSERT INTO public.consents (user_id, consent_type, granted)
  VALUES
    (v_caller_id, 'show_presence', p_show_presence),
    (v_caller_id, 'share_echo', p_share_echo);

  IF NOT p_show_presence THEN
    DELETE FROM public.host_presence WHERE user_id = v_caller_id;
  END IF;

  RETURN jsonb_build_object(
    'allow_friend_requests', p_allow_requests,
    'show_presence', p_show_presence,
    'share_echo', p_share_echo,
    'profile_visibility', v_vis
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_friend_settings(boolean, boolean, boolean, text) TO authenticated;

-- Backwards-compatibility 3-argument overload
CREATE OR REPLACE FUNCTION public.set_friend_settings(
  p_allow_requests boolean,
  p_show_presence boolean,
  p_share_echo boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN public.set_friend_settings(p_allow_requests, p_show_presence, p_share_echo, 'public');
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_friend_settings(boolean, boolean, boolean) TO authenticated;

-- 3. Operative Profile Dossier RPC
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
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, display_name, handle, color, profile_visibility, show_presence, share_echo, created_at
  INTO v_target
  FROM public.profiles
  WHERE id = p_target_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

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

  -- Compute career stats
  SELECT
    count(distinct p.game_id),
    count(distinct p.game_id) FILTER (WHERE (p.team = 'runner' AND g.winner = 'runners') OR (p.team = 'hunter' AND g.winner = 'hunters')),
    count(distinct p.game_id) FILTER (WHERE p.team = 'runner' AND p.status = 'active' AND g.winner = 'runners')
  INTO v_rounds, v_won, v_never_caught
  FROM public.players p
  JOIN public.games g ON g.id = p.game_id
  WHERE p.user_id = p_target_id AND g.status = 'ended';

  IF v_rounds > 0 THEN
    v_win_rate := round((v_won::numeric / v_rounds::numeric) * 100);
  END IF;

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
    )
    INTO v_presence
    FROM public.host_presence hp
    WHERE hp.user_id = p_target_id AND hp.expires_at > now();
  END IF;

  -- Head-to-Head stats (only if friends or self with non-zero match count)
  IF v_is_friend AND NOT v_is_self THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE (me.team = 'runner' AND g.winner = 'runners') OR (me.team = 'hunter' AND g.winner = 'hunters')),
      count(*) FILTER (WHERE (fr.team = 'runner' AND g.winner = 'runners') OR (fr.team = 'hunter' AND g.winner = 'hunters'))
    INTO v_opposite_rounds, v_my_wins, v_friend_wins
    FROM public.players me
    JOIN public.players fr ON fr.game_id = me.game_id
    JOIN public.games g ON g.id = me.game_id
    WHERE me.user_id = v_caller_id
      AND fr.user_id = p_target_id
      AND me.team <> fr.team
      AND me.status <> 'left'
      AND fr.status <> 'left'
      AND g.status = 'ended';

    SELECT coalesce(sum(rs.hit), 0) INTO v_times_ghosted
    FROM public.round_scores rs
    JOIN public.players me ON me.game_id = rs.game_id AND me.user_id = v_caller_id AND me.team = 'runner'
    JOIN public.players fr ON fr.game_id = rs.game_id AND fr.user_id = p_target_id AND fr.team = 'hunter'
    WHERE rs.user_id = v_caller_id;

    SELECT coalesce(sum(rs.hit), 0) INTO v_times_cashed
    FROM public.round_scores rs
    JOIN public.players fr ON fr.game_id = rs.game_id AND fr.user_id = p_target_id AND fr.team = 'hunter'
    JOIN public.players me ON me.game_id = rs.game_id AND me.user_id = v_caller_id AND me.team = 'runner'
    WHERE rs.user_id = p_target_id;

    v_h2h := jsonb_build_object(
      'opposite_rounds', v_opposite_rounds,
      'my_wins', v_my_wins,
      'friend_wins', v_friend_wins,
      'times_ghosted_them', v_times_ghosted,
      'times_they_cashed_me', v_times_cashed
    );

    -- Recent matches
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'game_id', sub.game_id,
        'mode_id', sub.mode_id,
        'team', sub.team,
        'won', sub.won,
        'created_at', sub.created_at
      )
    ), '[]'::jsonb)
    INTO v_recent_matches
    FROM (
      SELECT
        p2.game_id,
        g2.mode_id,
        p2.team,
        ((p2.team = 'runner' AND g2.winner = 'runners') OR (p2.team = 'hunter' AND g2.winner = 'hunters')) AS won,
        p2.created_at
      FROM public.players p2
      JOIN public.games g2 ON g2.id = p2.game_id
      WHERE p2.user_id = p_target_id AND g2.status = 'ended'
      ORDER BY p2.created_at DESC
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
    'avg_ghost', round((v_avg_ghost * 100)::numeric, 1),
    'avg_cash', round((v_avg_cash * 100)::numeric, 1),
    'rounds', v_rounds,
    'won', v_won,
    'win_rate', v_win_rate,
    'never_caught', v_never_caught,
    'badges', v_badges,
    'head_to_head', v_h2h,
    'recent_matches', v_recent_matches
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_operative_profile(uuid) TO authenticated;
