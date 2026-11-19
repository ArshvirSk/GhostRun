-- Migration: Tactical Discriminator Tags (like Valorant / Riot ID)
-- FL-P9: Operative Discriminator Taglines & Search

-- 1. Add tagline column to public.profiles if not exists
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS tagline varchar(5);

-- 2. Populate default tagline for existing profiles from first 4 characters of user id (hex uppercase)
UPDATE public.profiles
SET tagline = upper(substr(replace(id::text, '-', ''), 1, 4))
WHERE tagline IS NULL OR length(trim(tagline)) < 3;

-- 3. Add constraint on tagline: 3 to 5 uppercase alphanumeric characters
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_tagline_format;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_tagline_format
CHECK (tagline IS NULL OR (tagline ~ '^[A-Za-z0-9]{3,5}$'));

-- 4. Trigger to auto-uppercase and assign default tagline on INSERT or UPDATE
CREATE OR REPLACE FUNCTION public.standardize_profile_codename()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.display_name IS NOT NULL THEN
    NEW.display_name := upper(regexp_replace(trim(NEW.display_name), '\s+', ' ', 'g'));
  END IF;

  IF NEW.tagline IS NOT NULL THEN
    NEW.tagline := upper(trim(NEW.tagline));
  ELSE
    NEW.tagline := upper(substr(replace(NEW.id::text, '-', ''), 1, 4));
  END IF;

  IF NEW.handle IS NULL AND NEW.display_name IS NOT NULL THEN
    NEW.handle := lower(regexp_replace(trim(NEW.display_name), '\s+', '_', 'g'))::citext;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_standardize_profile_codename ON public.profiles;
CREATE TRIGGER trg_standardize_profile_codename
  BEFORE INSERT OR UPDATE OF display_name, tagline ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.standardize_profile_codename();

-- 5. Updated search_operatives RPC: supports searching by NAME#TAG, NAME, or TAG
CREATE OR REPLACE FUNCTION public.search_operatives(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_raw text := trim(p_query);
  v_clean text := lower(v_raw);
  v_name_part text;
  v_tag_part text;
  v_norm_name text;
  v_results jsonb;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_array();
  END IF;

  IF starts_with(v_clean, '@') THEN
    v_clean := substring(v_clean from 2);
  END IF;

  -- Check if query includes Valorant-style discriminator "#" (e.g. ALPHA#10D1)
  IF position('#' in v_clean) > 0 THEN
    v_name_part := trim(split_part(v_clean, '#', 1));
    v_tag_part := upper(trim(split_part(v_clean, '#', 2)));
    v_norm_name := regexp_replace(v_name_part, '[\s_\-]+', '', 'g');

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
      WHERE p.id <> v_caller_id
        AND (
          -- If tag provided, match tag plus name
          (length(v_tag_part) > 0 AND p.tagline = v_tag_part AND (
            length(v_norm_name) = 0
            OR regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%')
            OR (p.handle IS NOT NULL AND regexp_replace(lower(p.handle::text), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%'))
          ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE (b.user_id = v_caller_id AND b.blocked_user_id = p.id)
             OR (b.user_id = p.id AND b.blocked_user_id = v_caller_id)
        )
      ORDER BY
        CASE
          WHEN regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') = v_norm_name AND p.tagline = v_tag_part THEN 1
          ELSE 2
        END,
        p.display_name ASC
      LIMIT 20
    ) sub;

    RETURN coalesce(v_results, jsonb_build_array());
  END IF;

  -- Standard query without "#"
  v_norm_name := regexp_replace(v_clean, '[\s_\-]+', '', 'g');
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
    WHERE p.id <> v_caller_id
      AND (
        p.display_name ILIKE ('%' || v_clean || '%')
        OR (p.handle IS NOT NULL AND p.handle::text ILIKE ('%' || v_clean || '%'))
        OR regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%')
        OR (p.handle IS NOT NULL AND regexp_replace(lower(p.handle::text), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm_name || '%'))
        OR (p.tagline ILIKE (upper(v_clean) || '%'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE (b.user_id = v_caller_id AND b.blocked_user_id = p.id)
           OR (b.user_id = p.id AND b.blocked_user_id = v_caller_id)
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

GRANT EXECUTE ON FUNCTION public.search_operatives(text) TO authenticated;

-- 6. Updated send_friend_request RPC: supports exact NAME#TAG target resolution
CREATE OR REPLACE FUNCTION public.send_friend_request(p_target_handle text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_target_id uuid;
  v_target_profile record;
  v_ua uuid;
  v_ub uuid;
  v_existing record;
  v_today_requests integer;
  v_pending_requests integer;
  v_friend_count integer;
  v_raw text := trim(p_target_handle);
  v_clean text;
  v_norm text;
  v_name_part text;
  v_tag_part text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_clean := v_raw;
  IF starts_with(v_clean, '@') THEN
    v_clean := substring(v_clean from 2);
  END IF;
  v_clean := trim(v_clean);

  -- 1. Try UUID resolution
  IF v_clean ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_target_profile FROM public.profiles WHERE id = v_clean::uuid;
  -- 2. Try NAME#TAG discriminator format (e.g. ALPHAOP#10D1)
  ELSIF position('#' in v_clean) > 0 THEN
    v_name_part := trim(split_part(v_clean, '#', 1));
    v_tag_part := upper(trim(split_part(v_clean, '#', 2)));
    v_norm := regexp_replace(lower(v_name_part), '[\s_\-]+', '', 'g');

    SELECT * INTO v_target_profile
    FROM public.profiles
    WHERE (
      regexp_replace(lower(display_name), '[\s_\-]+', '', 'g') = v_norm
      OR regexp_replace(lower(coalesce(handle::text, '')), '[\s_\-]+', '', 'g') = v_norm
    )
    AND tagline = v_tag_part
    LIMIT 1;
  ELSE
    -- 3. Try exact handle or exact display_name
    SELECT * INTO v_target_profile FROM public.profiles WHERE handle = lower(v_clean)::citext;
    IF NOT FOUND THEN
      SELECT * INTO v_target_profile FROM public.profiles WHERE lower(display_name) = lower(v_clean) LIMIT 1;
    END IF;
    -- 4. Try space-and-symbol normalized match
    IF NOT FOUND THEN
      v_norm := regexp_replace(lower(v_clean), '[\s_\-]+', '', 'g');
      SELECT * INTO v_target_profile
      FROM public.profiles
      WHERE regexp_replace(lower(display_name), '[\s_\-]+', '', 'g') = v_norm
         OR regexp_replace(lower(coalesce(handle::text, '')), '[\s_\-]+', '', 'g') = v_norm
      ORDER BY
        CASE
          WHEN upper(display_name) = upper(v_clean) THEN 1
          WHEN lower(coalesce(handle::text, '')) = lower(v_clean) THEN 2
          ELSE 3
        END
      LIMIT 1;
    END IF;
  END IF;

  IF NOT FOUND OR v_target_profile.id IS NULL THEN
    RAISE EXCEPTION 'Player not found with that callsign or tag';
  END IF;

  v_target_id := v_target_profile.id;

  IF v_target_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot add yourself as a friend';
  END IF;

  -- Block check
  IF EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (user_id = v_caller_id AND blocked_user_id = v_target_id)
       OR (user_id = v_target_id AND blocked_user_id = v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Unable to send friend request';
  END IF;

  -- Target allows friend requests
  IF NOT coalesce(v_target_profile.allow_friend_requests, true) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'requests_disabled');
  END IF;

  -- Rate limits: max 10 outgoing per 24 hours
  SELECT count(*) INTO v_today_requests
  FROM public.friendships
  WHERE requested_by = v_caller_id
    AND created_at > now() - interval '24 hours';

  IF v_today_requests >= 10 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'rate_limit_exceeded');
  END IF;

  -- Max 20 pending requests
  SELECT count(*) INTO v_pending_requests
  FROM public.friendships
  WHERE requested_by = v_caller_id
    AND status = 'pending';

  IF v_pending_requests >= 20 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'max_pending_reached');
  END IF;

  -- Max 50 friends limit
  SELECT count(*) INTO v_friend_count
  FROM public.friendships
  WHERE (user_a = v_caller_id OR user_b = v_caller_id)
    AND status = 'accepted';

  IF v_friend_count >= 50 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'friend_limit_reached');
  END IF;

  -- Canonical pair ordering
  IF v_caller_id < v_target_id THEN
    v_ua := v_caller_id;
    v_ub := v_target_id;
  ELSE
    v_ua := v_target_id;
    v_ub := v_caller_id;
  END IF;

  -- Check existing friendship
  SELECT * INTO v_existing
  FROM public.friendships
  WHERE user_a = v_ua AND user_b = v_ub;

  IF FOUND THEN
    IF v_existing.status = 'accepted' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'already_friends');
    ELSIF v_existing.status = 'pending' THEN
      IF v_existing.requested_by = v_caller_id THEN
        RETURN jsonb_build_object('success', false, 'reason', 'request_already_sent');
      ELSE
        -- Mutual request -> auto-accept
        UPDATE public.friendships
        SET status = 'accepted', updated_at = now()
        WHERE id = v_existing.id;
        RETURN jsonb_build_object('success', true, 'status', 'auto_accepted');
      END IF;
    ELSIF v_existing.status = 'declined' THEN
      IF v_existing.updated_at > now() - interval '7 days' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'decline_cooldown_active');
      ELSE
        UPDATE public.friendships
        SET status = 'pending', requested_by = v_caller_id, updated_at = now(), created_at = now()
        WHERE id = v_existing.id;
        RETURN jsonb_build_object('success', true, 'status', 'sent');
      END IF;
    END IF;
  END IF;

  -- Insert new pending friendship
  INSERT INTO public.friendships (user_a, user_b, requested_by, status)
  VALUES (v_ua, v_ub, v_caller_id, 'pending');

  RETURN jsonb_build_object('success', true, 'status', 'sent');
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_friend_request(text) TO authenticated;

-- 7. Updated list_friends RPC: includes tagline
CREATE OR REPLACE FUNCTION public.list_friends()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_list jsonb;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', p.id,
      'display_name', p.display_name,
      'tagline', p.tagline,
      'handle', p.handle,
      'color', p.color,
      'show_presence', p.show_presence,
      'share_echo', p.share_echo,
      'friends_since', f.responded_at
    ) ORDER BY p.display_name ASC
  ), '[]'::jsonb)
  INTO v_list
  FROM public.friendships f
  JOIN public.profiles p ON p.id = (CASE WHEN f.user_a = v_caller_id THEN f.user_b ELSE f.user_a END)
  WHERE f.status = 'accepted'
    AND (f.user_a = v_caller_id OR f.user_b = v_caller_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.user_id = v_caller_id AND b.blocked_user_id = p.id)
         OR (b.blocked_user_id = v_caller_id AND b.user_id = p.id)
    );

  RETURN v_list;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_friends() TO authenticated;

-- 8. Updated list_friend_requests RPC: includes tagline
CREATE OR REPLACE FUNCTION public.list_friend_requests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_incoming jsonb;
  v_outgoing jsonb;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Incoming
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'requester_id', p.id,
      'display_name', p.display_name,
      'tagline', p.tagline,
      'handle', p.handle,
      'color', p.color,
      'requested_at', f.created_at
    ) ORDER BY f.created_at DESC
  ), '[]'::jsonb)
  INTO v_incoming
  FROM public.friendships f
  JOIN public.profiles p ON p.id = f.requested_by
  WHERE f.status = 'pending'
    AND f.requested_by <> v_caller_id
    AND (f.user_a = v_caller_id OR f.user_b = v_caller_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.user_id = v_caller_id AND b.blocked_user_id = p.id)
         OR (b.blocked_user_id = v_caller_id AND b.user_id = p.id)
    );

  -- Outgoing
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'target_id', p.id,
      'display_name', p.display_name,
      'tagline', p.tagline,
      'handle', p.handle,
      'color', p.color,
      'requested_at', f.created_at
    ) ORDER BY f.created_at DESC
  ), '[]'::jsonb)
  INTO v_outgoing
  FROM public.friendships f
  JOIN public.profiles p ON p.id = (CASE WHEN f.user_a = v_caller_id THEN f.user_b ELSE f.user_a END)
  WHERE f.status = 'pending'
    AND f.requested_by = v_caller_id
    AND (f.user_a = v_caller_id OR f.user_b = v_caller_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.user_id = v_caller_id AND b.blocked_user_id = p.id)
         OR (b.blocked_user_id = v_caller_id AND b.user_id = p.id)
    );

  RETURN jsonb_build_object('incoming', v_incoming, 'outgoing', v_outgoing);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_friend_requests() TO authenticated;

-- 9. Updated get_operative_profile RPC: includes tagline
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

  IF NOT FOUND OR v_target.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_caller_id IS NOT NULL AND v_caller_id = p_target_id THEN
    v_is_self := true;
  END IF;

  IF v_caller_id IS NOT NULL AND NOT v_is_self THEN
    IF EXISTS (
      SELECT 1 FROM public.blocks
      WHERE (user_id = v_caller_id AND blocked_user_id = p_target_id)
         OR (user_id = p_target_id AND blocked_user_id = v_caller_id)
    ) THEN
      RETURN jsonb_build_object('found', false, 'blocked', true);
    END IF;

    IF v_caller_id < p_target_id THEN
      v_ua := v_caller_id;
      v_ub := p_target_id;
    ELSE
      v_ua := p_target_id;
      v_ub := v_caller_id;
    END IF;

    SELECT * INTO v_friendship
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
  END IF;

  IF (v_is_self OR v_is_friend) AND coalesce(v_target.show_presence, true) THEN
    SELECT jsonb_build_object(
      'online', true,
      'game_id', g.id,
      'mode_id', g.mode,
      'player_count', (SELECT count(*) FROM public.players WHERE game_id = g.id),
      'expires_at', (p.last_seen_at + interval '30 minutes')
    ) INTO v_presence
    FROM public.players p
    JOIN public.games g ON g.id = p.game_id
    WHERE p.user_id = p_target_id
      AND g.status IN ('lobby', 'countdown', 'live')
      AND p.last_seen_at > now() - interval '30 minutes'
    ORDER BY p.joined_at DESC
    LIMIT 1;
  END IF;

  SELECT count(*), coalesce(sum(CASE WHEN p.won THEN 1 ELSE 0 END), 0)
  INTO v_rounds, v_won
  FROM public.players p
  WHERE p.user_id = p_target_id;

  IF v_rounds > 0 THEN
    v_win_rate := round((v_won::numeric / v_rounds::numeric) * 100);
  END IF;

  SELECT count(*)
  INTO v_never_caught
  FROM public.players p
  JOIN public.games g ON g.id = p.game_id
  WHERE p.user_id = p_target_id
    AND p.role = 'runner'
    AND p.won = true
    AND NOT EXISTS (
      SELECT 1 FROM public.tags t
      WHERE t.game_id = g.id AND t.runner_id = p.id
    );

  SELECT coalesce(max(
    CASE
      WHEN p.role = 'runner' AND p.won = true AND g.ended_at IS NOT NULL AND g.started_at IS NOT NULL
        THEN extract(epoch from (g.ended_at - g.started_at))::int
      WHEN p.role = 'runner' AND EXISTS (SELECT 1 FROM public.tags t WHERE t.runner_id = p.id)
        THEN (
          SELECT extract(epoch from (min(t.tagged_at) - g.started_at))::int
          FROM public.tags t
          WHERE t.runner_id = p.id AND g.started_at IS NOT NULL
        )
      ELSE 0
    END
  ), 0) INTO v_best_escape_s
  FROM public.players p
  JOIN public.games g ON g.id = p.game_id
  WHERE p.user_id = p_target_id;

  IF v_best_escape_s > 0 THEN
    v_best_escape := (v_best_escape_s / 60)::text || 'm ' || (v_best_escape_s % 60)::text || 's';
  ELSE
    v_best_escape := '--';
  END IF;

  SELECT coalesce(max(
    (SELECT coalesce(sum(
      ST_DistanceSphere(
        ST_MakePoint(tp.longitude, tp.latitude),
        ST_MakePoint(prev.longitude, prev.latitude)
      )
    ), 0)::int
    FROM (
      SELECT latitude, longitude, lag(latitude) OVER (ORDER BY recorded_at) as prev_lat, lag(longitude) OVER (ORDER BY recorded_at) as prev_lon
      FROM public.trail_points
      WHERE player_id = p.id
    ) prev
    JOIN public.trail_points tp ON tp.player_id = p.id
    WHERE prev.prev_lat IS NOT NULL)
  ), 0) INTO v_farthest_meters
  FROM public.players p
  WHERE p.user_id = p_target_id;

  SELECT
    coalesce(sum(echo_score), 0),
    coalesce(avg(echo_score), 0),
    coalesce(avg(ghost_rate), 0),
    coalesce(avg(cash_rate), 0)
  INTO v_season_echo, v_avg_best, v_avg_ghost, v_avg_cash
  FROM public.round_scores
  WHERE player_id IN (SELECT id FROM public.players WHERE user_id = p_target_id);

  IF v_season_echo >= 1000 THEN
    v_tier := 'Wraith';
  ELSIF v_season_echo >= 500 THEN
    v_tier := 'Phantom';
  ELSIF v_season_echo >= 200 THEN
    v_tier := 'Spectre';
  ELSIF v_season_echo >= 50 THEN
    v_tier := 'Shade';
  ELSE
    v_tier := 'Whisper';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', pb.badge_id,
      'unlocked_at', pb.unlocked_at,
      'metadata', pb.metadata
    ) ORDER BY pb.unlocked_at DESC
  ), '[]'::jsonb)
  INTO v_badges
  FROM public.player_badges pb
  WHERE pb.user_id = p_target_id;

  IF v_is_friend AND v_caller_id IS NOT NULL THEN
    SELECT count(*) INTO v_opposite_rounds
    FROM public.players p1
    JOIN public.players p2 ON p1.game_id = p2.game_id
    WHERE p1.user_id = v_caller_id
      AND p2.user_id = p_target_id
      AND p1.role <> p2.role;

    SELECT count(*) INTO v_my_wins
    FROM public.players p1
    JOIN public.players p2 ON p1.game_id = p2.game_id
    WHERE p1.user_id = v_caller_id
      AND p2.user_id = p_target_id
      AND p1.role <> p2.role
      AND p1.won = true;

    SELECT count(*) INTO v_friend_wins
    FROM public.players p1
    JOIN public.players p2 ON p1.game_id = p2.game_id
    WHERE p1.user_id = v_caller_id
      AND p2.user_id = p_target_id
      AND p1.role <> p2.role
      AND p2.won = true;

    SELECT count(*) INTO v_times_ghosted
    FROM public.players p1
    JOIN public.players p2 ON p1.game_id = p2.game_id
    WHERE p1.user_id = v_caller_id AND p1.role = 'runner' AND p1.won = true
      AND p2.user_id = p_target_id AND p2.role = 'hunter'
      AND NOT EXISTS (
        SELECT 1 FROM public.tags t
        WHERE t.game_id = p1.game_id AND t.runner_id = p1.id AND t.hunter_id = p2.id
      );

    SELECT count(*) INTO v_times_cashed
    FROM public.tags t
    JOIN public.players p1 ON p1.id = t.hunter_id
    JOIN public.players p2 ON p2.id = t.runner_id
    WHERE p1.user_id = v_caller_id AND p2.user_id = p_target_id;

    v_h2h := jsonb_build_object(
      'opposite_rounds', v_opposite_rounds,
      'my_wins', v_my_wins,
      'friend_wins', v_friend_wins,
      'times_ghosted_them', v_times_ghosted,
      'times_they_cashed_me', v_times_cashed
    );
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'game_id', g.id,
      'mode_id', g.mode,
      'role', p.role,
      'won', p.won,
      'played_at', coalesce(p.joined_at, g.created_at)
    ) ORDER BY coalesce(p.joined_at, g.created_at) DESC
  ), '[]'::jsonb)
  INTO v_recent_matches
  FROM (
    SELECT p2.id, p2.game_id, p2.role, p2.won, p2.joined_at
    FROM public.players p2
    WHERE p2.user_id = p_target_id
    ORDER BY p2.joined_at DESC
    LIMIT 5
  ) p
  JOIN public.games g ON g.id = p.game_id;

  RETURN jsonb_build_object(
    'found', true,
    'user_id', v_target.id,
    'display_name', v_target.display_name,
    'tagline', v_target.tagline,
    'handle', v_target.handle,
    'color', v_target.color,
    'visibility', v_target.profile_visibility,
    'is_friend', v_is_friend,
    'is_self', v_is_self,
    'friendship_status', v_friendship_status,
    'is_redacted', (NOT v_is_self AND NOT v_is_friend AND v_target.profile_visibility = 'private'),
    'presence', v_presence,
    'tier', v_tier,
    'season_echo', v_season_echo,
    'avg_ghost', v_avg_ghost,
    'avg_cash', v_avg_cash,
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
