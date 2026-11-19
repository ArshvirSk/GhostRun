-- Migration: Allow send_friend_request to accept UUID, handle, or display_name
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
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Try resolving target: UUID, handle, or display_name
  IF v_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_target_profile FROM public.profiles WHERE id = v_raw::uuid;
  ELSE
    SELECT * INTO v_target_profile FROM public.profiles WHERE handle = lower(v_raw)::citext;
    IF NOT FOUND THEN
      SELECT * INTO v_target_profile FROM public.profiles WHERE lower(display_name) = lower(v_raw) LIMIT 1;
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
  WHERE requested_by = v_caller_id AND created_at >= (now() - interval '24 hours');
  IF v_today_requests >= 10 THEN
    RAISE EXCEPTION 'Daily friend request limit reached (10/day)';
  END IF;

  -- Pending limit: max 20 pending outgoing
  SELECT count(*) INTO v_pending_requests
  FROM public.friendships
  WHERE requested_by = v_caller_id AND status = 'pending';
  IF v_pending_requests >= 20 THEN
    RAISE EXCEPTION 'Pending request limit reached (20 maximum)';
  END IF;

  -- Max friends: 200
  SELECT count(*) INTO v_friend_count
  FROM public.friendships
  WHERE status = 'accepted' AND (user_a = v_caller_id OR user_b = v_caller_id);
  IF v_friend_count >= 200 THEN
    RAISE EXCEPTION 'Friend limit reached (200 maximum)';
  END IF;

  -- Canonical pair ordering
  IF v_caller_id < v_target_id THEN
    v_ua := v_caller_id; v_ub := v_target_id;
  ELSE
    v_ua := v_target_id; v_ub := v_caller_id;
  END IF;

  SELECT * INTO v_existing FROM public.friendships WHERE user_a = v_ua AND user_b = v_ub;
  IF FOUND THEN
    IF v_existing.status = 'accepted' THEN
      RETURN jsonb_build_object('success', true, 'status', 'already_friends');
    ELSIF v_existing.status = 'pending' THEN
      IF v_existing.requested_by = v_caller_id THEN
        RETURN jsonb_build_object('success', true, 'status', 'request_already_sent');
      ELSE
        -- Mutual request auto-accepts
        UPDATE public.friendships
        SET status = 'accepted', responded_at = now()
        WHERE user_a = v_ua AND user_b = v_ub;
        RETURN jsonb_build_object('success', true, 'status', 'accepted');
      END IF;
    ELSIF v_existing.status = 'declined' THEN
      IF v_existing.responded_at > (now() - interval '7 days') THEN
        RAISE EXCEPTION 'Cannot send request yet (decline cooldown active)';
      ELSE
        UPDATE public.friendships
        SET status = 'pending', requested_by = v_caller_id, created_at = now(), responded_at = null
        WHERE user_a = v_ua AND user_b = v_ub;
        RETURN jsonb_build_object('success', true, 'status', 'sent');
      END IF;
    END IF;
  ELSE
    INSERT INTO public.friendships (user_a, user_b, status, requested_by)
    VALUES (v_ua, v_ub, 'pending', v_caller_id);
    RETURN jsonb_build_object('success', true, 'status', 'sent');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_friend_request(text) TO authenticated;
