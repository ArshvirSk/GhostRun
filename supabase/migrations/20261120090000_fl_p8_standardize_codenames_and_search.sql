-- Migration: Standardize codenames to uppercase, normalize spaces, and enable space-insensitive search
-- FL-P8: Operative Codename & Search Overhaul

-- 1. Standardize existing profiles: upper-case display names and populate missing handles
UPDATE public.profiles
SET
  display_name = upper(regexp_replace(trim(display_name), '\s+', ' ', 'g')),
  handle = CASE
    WHEN handle IS NULL AND length(regexp_replace(trim(display_name), '\s+', '_', 'g')) >= 3
      THEN lower(regexp_replace(trim(display_name), '\s+', '_', 'g'))::citext
    ELSE handle
  END
WHERE display_name IS NOT NULL;

-- 2. Trigger function to auto-standardize display_name and handle on INSERT or UPDATE
CREATE OR REPLACE FUNCTION public.standardize_profile_codename()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.display_name IS NOT NULL THEN
    NEW.display_name := upper(regexp_replace(trim(NEW.display_name), '\s+', ' ', 'g'));
    IF NEW.handle IS NULL AND length(regexp_replace(trim(NEW.display_name), '\s+', '_', 'g')) >= 3 THEN
      NEW.handle := lower(regexp_replace(trim(NEW.display_name), '\s+', '_', 'g'))::citext;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_standardize_profile_codename ON public.profiles;
CREATE TRIGGER trg_standardize_profile_codename
  BEFORE INSERT OR UPDATE OF display_name ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.standardize_profile_codename();

-- 3. Space-Insensitive & Flexible Operative Search RPC
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
  v_norm text;
  v_results jsonb;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_array();
  END IF;

  IF starts_with(v_clean, '@') THEN
    v_clean := substring(v_clean from 2);
  END IF;

  v_norm := regexp_replace(v_clean, '[\s_\-]+', '', 'g');

  IF length(v_norm) < 1 THEN
    RETURN jsonb_build_array();
  END IF;

  SELECT jsonb_agg(sub) INTO v_results
  FROM (
    SELECT
      p.id,
      p.display_name,
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
        -- Match exact raw text
        p.display_name ILIKE ('%' || v_clean || '%')
        OR (p.handle IS NOT NULL AND p.handle::text ILIKE ('%' || v_clean || '%'))
        -- Match space/symbol normalized text
        OR regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm || '%')
        OR (p.handle IS NOT NULL AND regexp_replace(lower(p.handle::text), '[\s_\-]+', '', 'g') ILIKE ('%' || v_norm || '%'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE (b.user_id = v_caller_id AND b.blocked_user_id = p.id)
           OR (b.user_id = p.id AND b.blocked_user_id = v_caller_id)
      )
    ORDER BY
      CASE
        -- 1. Exact normalized match
        WHEN regexp_replace(lower(coalesce(p.handle::text, '')), '[\s_\-]+', '', 'g') = v_norm THEN 1
        WHEN regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') = v_norm THEN 2
        -- 2. Prefix normalized match
        WHEN regexp_replace(lower(coalesce(p.handle::text, '')), '[\s_\-]+', '', 'g') LIKE (v_norm || '%') THEN 3
        WHEN regexp_replace(lower(p.display_name), '[\s_\-]+', '', 'g') LIKE (v_norm || '%') THEN 4
        -- 3. Substring match
        ELSE 5
      END,
      p.display_name ASC
    LIMIT 20
  ) sub;

  RETURN coalesce(v_results, jsonb_build_array());
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_operatives(text) TO authenticated;

-- 4. Space-Insensitive Friend Request RPC
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
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_clean := v_raw;
  IF starts_with(v_clean, '@') THEN
    v_clean := substring(v_clean from 2);
  END IF;
  v_clean := trim(v_clean);
  v_norm := regexp_replace(lower(v_clean), '[\s_\-]+', '', 'g');

  -- 1. Try UUID resolution
  IF v_clean ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_target_profile FROM public.profiles WHERE id = v_clean::uuid;
  ELSE
    -- 2. Try exact handle or exact display_name
    SELECT * INTO v_target_profile FROM public.profiles WHERE handle = lower(v_clean)::citext;
    IF NOT FOUND THEN
      SELECT * INTO v_target_profile FROM public.profiles WHERE lower(display_name) = lower(v_clean) LIMIT 1;
    END IF;
    -- 3. Try space-and-symbol normalized match
    IF NOT FOUND THEN
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
    RAISE EXCEPTION 'Player not found with that handle or ID';
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
      -- 7-day cooldown
      IF v_existing.updated_at > now() - interval '7 days' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'decline_cooldown_active');
      ELSE
        -- Reset to pending
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
