-- Wave 6: FL-P1 Friends Graph, Ephemeral Presence & QR Invites

-- 1. Profiles Privacy & Presence Columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_presence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_friend_requests boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS share_echo boolean NOT NULL DEFAULT false;

-- Update consents constraint for C8 (show_presence) and C9 (share_echo)
DO $$
DECLARE
  v_con text;
BEGIN
  SELECT conname INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'public.consents'::regclass AND contype = 'c';
  
  IF v_con IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.consents DROP CONSTRAINT ' || quote_ident(v_con);
  END IF;
  
  ALTER TABLE public.consents
    ADD CONSTRAINT consents_type_check CHECK (
      consent_type IN (
        'location', 'policy_ack', 'ghost', 'leaderboard_name', 'diagnostics',
        'show_presence', 'share_echo'
      )
    );
END $$;

-- 2. Friendships Table (canonical user_a < user_b ordering)
CREATE TABLE IF NOT EXISTS public.friendships (
  user_a uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE INDEX IF NOT EXISTS friendships_user_a_idx ON public.friendships(user_a, status);
CREATE INDEX IF NOT EXISTS friendships_user_b_idx ON public.friendships(user_b, status);
CREATE INDEX IF NOT EXISTS friendships_requested_by_idx ON public.friendships(requested_by, created_at);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY friendships_select_members ON public.friendships
  FOR SELECT TO authenticated
  USING (
    (user_a = (SELECT auth.uid()) OR user_b = (SELECT auth.uid()))
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.user_id = (SELECT auth.uid()) AND b.blocked_user_id IN (friendships.user_a, friendships.user_b))
         OR (b.blocked_user_id = (SELECT auth.uid()) AND b.user_id IN (friendships.user_a, friendships.user_b))
    )
  );

-- 3. Ephemeral Host Presence Table
CREATE TABLE IF NOT EXISTS public.host_presence (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  mode_id text NOT NULL,
  player_count int NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS host_presence_expires_idx ON public.host_presence(expires_at);

ALTER TABLE public.host_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY host_presence_select_friends ON public.host_presence
  FOR SELECT TO authenticated
  USING (
    expires_at > now()
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = host_presence.user_id AND pr.show_presence = true
    )
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.user_a = host_presence.user_id AND f.user_b = (SELECT auth.uid()))
          OR
          (f.user_b = host_presence.user_id AND f.user_a = (SELECT auth.uid()))
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.user_id = (SELECT auth.uid()) AND b.blocked_user_id = host_presence.user_id)
         OR (b.blocked_user_id = (SELECT auth.uid()) AND b.user_id = host_presence.user_id)
    )
  );

-- 4. Friend Invites (24-hour tokens / QR)
CREATE TABLE IF NOT EXISTS public.friend_invites (
  token_hash text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

ALTER TABLE public.friend_invites ENABLE ROW LEVEL SECURITY;

-- 5. RPC: send_friend_request
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
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_target_profile FROM public.profiles WHERE handle = lower(trim(p_target_handle))::citext;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found with that handle';
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
  IF NOT v_target_profile.allow_friend_requests THEN
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

-- 6. RPC: respond_friend_request
CREATE OR REPLACE FUNCTION public.respond_friend_request(
  p_requester_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_ua uuid;
  v_ub uuid;
  v_existing record;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_action NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'Action must be accept or decline';
  END IF;

  IF v_caller_id < p_requester_id THEN
    v_ua := v_caller_id; v_ub := p_requester_id;
  ELSE
    v_ua := p_requester_id; v_ub := v_caller_id;
  END IF;

  SELECT * INTO v_existing FROM public.friendships
  WHERE user_a = v_ua AND user_b = v_ub AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending friend request found';
  END IF;

  IF v_existing.requested_by = v_caller_id THEN
    RAISE EXCEPTION 'Cannot accept or decline your own outgoing request';
  END IF;

  IF p_action = 'accept' THEN
    UPDATE public.friendships
    SET status = 'accepted', responded_at = now()
    WHERE user_a = v_ua AND user_b = v_ub;
    RETURN jsonb_build_object('success', true, 'action', 'accepted');
  ELSE
    UPDATE public.friendships
    SET status = 'declined', responded_at = now()
    WHERE user_a = v_ua AND user_b = v_ub;
    RETURN jsonb_build_object('success', true, 'action', 'declined');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, text) TO authenticated;

-- 7. RPC: remove_friend
CREATE OR REPLACE FUNCTION public.remove_friend(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_ua uuid;
  v_ub uuid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_caller_id < p_friend_id THEN
    v_ua := v_caller_id; v_ub := p_friend_id;
  ELSE
    v_ua := p_friend_id; v_ub := v_caller_id;
  END IF;

  DELETE FROM public.friendships WHERE user_a = v_ua AND user_b = v_ub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_friend(uuid) TO authenticated;

-- 8. RPC: list_friends
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

-- 9. RPC: list_friend_requests
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
      'handle', p.handle,
      'color', p.color,
      'requested_at', f.created_at
    ) ORDER BY f.created_at DESC
  ), '[]'::jsonb)
  INTO v_outgoing
  FROM public.friendships f
  JOIN public.profiles p ON p.id = (CASE WHEN f.user_a = v_caller_id THEN f.user_b ELSE f.user_a END)
  WHERE f.status = 'pending'
    AND f.requested_by = v_caller_id;

  RETURN jsonb_build_object('incoming', v_incoming, 'outgoing', v_outgoing);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_friend_requests() TO authenticated;

-- 10. RPC: publish_presence & clear_presence
CREATE OR REPLACE FUNCTION public.publish_presence(
  p_game_id uuid,
  p_mode_id text,
  p_player_count int DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_profile record;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT show_presence INTO v_profile FROM public.profiles WHERE id = v_caller_id;
  IF NOT FOUND OR NOT coalesce(v_profile.show_presence, false) THEN
    RETURN; -- Silent return if user presence is disabled
  END IF;

  INSERT INTO public.host_presence (user_id, game_id, mode_id, player_count, expires_at)
  VALUES (v_caller_id, p_game_id, p_mode_id, p_player_count, now() + interval '30 minutes')
  ON CONFLICT (user_id) DO UPDATE
    SET game_id = excluded.game_id,
        mode_id = excluded.mode_id,
        player_count = excluded.player_count,
        expires_at = now() + interval '30 minutes';
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_presence(uuid, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_presence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.host_presence WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_presence() TO authenticated;

-- 11. RPC: friends_hosting
CREATE OR REPLACE FUNCTION public.friends_hosting()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_hosts jsonb;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'host_id', hp.user_id,
      'host_name', p.display_name,
      'host_handle', p.handle,
      'game_id', hp.game_id,
      'mode_id', hp.mode_id,
      'player_count', hp.player_count,
      'expires_at', hp.expires_at
    ) ORDER BY hp.expires_at DESC
  ), '[]'::jsonb)
  INTO v_hosts
  FROM public.host_presence hp
  JOIN public.profiles p ON p.id = hp.user_id
  WHERE hp.expires_at > now()
    AND p.show_presence = true
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.user_a = hp.user_id AND f.user_b = v_caller_id)
          OR
          (f.user_b = hp.user_id AND f.user_a = v_caller_id)
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.user_id = v_caller_id AND b.blocked_user_id = hp.user_id)
         OR (b.blocked_user_id = v_caller_id AND b.user_id = hp.user_id)
    );

  RETURN v_hosts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.friends_hosting() TO authenticated;

-- 12. RPC: set_friend_settings
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
DECLARE
  v_caller_id uuid := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.profiles
  SET allow_friend_requests = p_allow_requests,
      show_presence = p_show_presence,
      share_echo = p_share_echo
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
    'share_echo', p_share_echo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_friend_settings(boolean, boolean, boolean) TO authenticated;
