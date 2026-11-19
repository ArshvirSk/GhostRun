-- Migration: 20261119080000_fl_p7_friend_invites_rpcs.sql
-- Description: Implement friend_invites RLS policies and create_friend_invite / consume_friend_invite RPCs.

-- 1. RLS Policies for friend_invites
DROP POLICY IF EXISTS friend_invites_select_own ON public.friend_invites;
CREATE POLICY friend_invites_select_own ON public.friend_invites
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS friend_invites_insert_own ON public.friend_invites;
CREATE POLICY friend_invites_insert_own ON public.friend_invites
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS friend_invites_update_own ON public.friend_invites;
CREATE POLICY friend_invites_update_own ON public.friend_invites
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- 2. RPC: create_friend_invite
CREATE OR REPLACE FUNCTION public.create_friend_invite()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_token text;
  v_token_hash text;
  v_expires_at timestamptz := now() + interval '24 hours';
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Generate 16-character alphanumeric token
  v_token := lower(substr(encode(gen_random_bytes(12), 'hex'), 1, 16));
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.friend_invites (token_hash, owner_id, expires_at)
  VALUES (v_token_hash, v_caller_id, v_expires_at);

  RETURN jsonb_build_object(
    'success', true,
    'token', v_token,
    'expires_at', v_expires_at,
    'invite_url', 'https://arshvirsk.github.io/GhostRun/join?friend_invite=' || v_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_friend_invite() TO authenticated;

-- 3. RPC: consume_friend_invite
CREATE OR REPLACE FUNCTION public.consume_friend_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_token_hash text;
  v_invite record;
  v_owner record;
  v_existing record;
  v_ua uuid;
  v_ub uuid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite token is required.');
  END IF;

  v_token_hash := encode(digest(lower(trim(p_token)), 'sha256'), 'hex');

  SELECT * INTO v_invite
  FROM public.friend_invites
  WHERE token_hash = v_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or unknown invite token.');
  END IF;

  IF v_invite.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite link has already been used.');
  END IF;

  IF v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite link has expired (24h limit).');
  END IF;

  IF v_invite.owner_id = v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot accept your own invite token.');
  END IF;

  -- Mark token as used
  UPDATE public.friend_invites
  SET used_at = now()
  WHERE token_hash = v_token_hash;

  -- Canonical pair ordering
  v_ua := least(v_caller_id, v_invite.owner_id);
  v_ub := greatest(v_caller_id, v_invite.owner_id);

  SELECT * INTO v_existing
  FROM public.friendships
  WHERE user_a = v_ua AND user_b = v_ub;

  IF FOUND THEN
    IF v_existing.status != 'accepted' THEN
      UPDATE public.friendships
      SET status = 'accepted', responded_at = now()
      WHERE user_a = v_ua AND user_b = v_ub;
    END IF;
  ELSE
    INSERT INTO public.friendships (user_a, user_b, status, requested_by, created_at, responded_at)
    VALUES (v_ua, v_ub, 'accepted', v_invite.owner_id, now(), now());
  END IF;

  -- Fetch owner details
  SELECT id, display_name, handle, color
  INTO v_owner
  FROM public.profiles
  WHERE id = v_invite.owner_id;

  RETURN jsonb_build_object(
    'success', true,
    'owner_id', v_invite.owner_id,
    'display_name', v_owner.display_name,
    'handle', v_owner.handle,
    'color', v_owner.color
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_friend_invite(text) TO authenticated;
