-- Wave 6: FL-P0 Handles, Report & Block, Moderation Schema

CREATE EXTENSION IF NOT EXISTS citext;

-- 1. Profiles Handle and Suspension Fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS handle citext UNIQUE,
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_handle_format'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_handle_format CHECK (
        handle IS NULL OR (
          handle ~ '^[A-Za-z0-9][A-Za-z0-9_]{1,18}[A-Za-z0-9]$' AND
          handle !~ '__'
        )
      );
  END IF;
END $$;

-- 2. Update reports table with context and action tracking
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT 'other'
  CHECK (context IN ('lobby', 'friends', 'board', 'radio', 'other')),
  ADD COLUMN IF NOT EXISTS action_taken text,
  ADD COLUMN IF NOT EXISTS actioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS actioned_by uuid REFERENCES public.profiles(id);

-- Enable Admin access to reports
DROP POLICY IF EXISTS reports_admin_select ON public.reports;
CREATE POLICY reports_admin_select ON public.reports
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS reports_admin_update ON public.reports;
CREATE POLICY reports_admin_update ON public.reports
  FOR UPDATE TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- 3. RPC: check_handle
CREATE OR REPLACE FUNCTION public.check_handle(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean text;
  v_reserved text[] := ARRAY[
    'admin', 'administrator', 'moderator', 'operator', 'ghostrun', 'ghostrunapp',
    'support', 'system', 'security', 'official', 'help', 'emergency',
    'hunter', 'runner', 'ghost', 'ai_gm', 'referee', 'guest', 'null', 'undefined',
    'anonymous', 'everyone', 'all'
  ];
BEGIN
  IF p_handle IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'null_handle');
  END IF;

  v_clean := trim(p_handle);

  IF length(v_clean) < 3 OR length(v_clean) > 20 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'length_out_of_bounds');
  END IF;

  IF NOT (v_clean ~ '^[A-Za-z0-9][A-Za-z0-9_]{1,18}[A-Za-z0-9]$') OR v_clean ~ '__' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'invalid_characters');
  END IF;

  IF lower(v_clean) = ANY(v_reserved) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'reserved');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE handle = v_clean::citext) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'already_taken');
  END IF;

  RETURN jsonb_build_object('available', true, 'normalized', v_clean);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_handle(text) TO anon, authenticated;

-- 4. RPC: claim_handle
CREATE OR REPLACE FUNCTION public.claim_handle(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_check jsonb;
  v_clean text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_check := public.check_handle(p_handle);
  IF NOT (v_check->>'available')::boolean THEN
    RAISE EXCEPTION 'Handle unavailable: %', (v_check->>'reason');
  END IF;

  v_clean := v_check->>'normalized';

  UPDATE public.profiles
  SET handle = v_clean::citext
  WHERE id = v_uid;

  RETURN jsonb_build_object('success', true, 'handle', v_clean);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_handle(text) TO authenticated;

-- 5. RPC: get_my_handle
CREATE OR REPLACE FUNCTION public.get_my_handle()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT handle::text FROM public.profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_handle() TO authenticated;

-- 6. RPC: list_my_blocks
CREATE OR REPLACE FUNCTION public.list_my_blocks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_results jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'blocked_user_id', b.blocked_user_id,
      'display_name', p.display_name,
      'handle', p.handle,
      'blocked_at', b.created_at
    ) ORDER BY b.created_at DESC
  ), '[]'::jsonb)
  INTO v_results
  FROM public.blocks b
  JOIN public.profiles p ON p.id = b.blocked_user_id
  WHERE b.user_id = v_uid;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_blocks() TO authenticated;

-- 7. RPC: report_user (augmented)
CREATE OR REPLACE FUNCTION public.report_user(
  p_reported_user_id uuid,
  p_context text,
  p_reason text,
  p_details text DEFAULT NULL,
  p_game_id uuid DEFAULT NULL,
  p_message_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_report_id uuid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_caller_id = p_reported_user_id THEN
    RAISE EXCEPTION 'Cannot report self';
  END IF;

  IF p_context NOT IN ('lobby', 'friends', 'board', 'radio', 'other') THEN
    RAISE EXCEPTION 'Invalid report context';
  END IF;

  IF p_reason NOT IN ('harassment', 'inappropriate_name', 'cheating', 'unsafe_behaviour', 'other') THEN
    RAISE EXCEPTION 'Invalid report reason';
  END IF;

  INSERT INTO public.reports (
    reporter_user_id,
    reported_user_id,
    game_id,
    message_id,
    context,
    reason,
    details
  ) VALUES (
    v_caller_id,
    p_reported_user_id,
    p_game_id,
    p_message_id,
    p_context,
    p_reason,
    p_details
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_user(uuid, text, text, text, uuid, uuid) TO authenticated;

-- 8. RPC: get_admin_reports
CREATE OR REPLACE FUNCTION public.get_admin_reports(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reports jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: Admin privileges required';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'reporter_id', r.reporter_user_id,
      'reporter_name', pr_rep.display_name,
      'reporter_handle', pr_rep.handle,
      'reported_id', r.reported_user_id,
      'reported_name', pr_tgt.display_name,
      'reported_handle', pr_tgt.handle,
      'game_id', r.game_id,
      'message_id', r.message_id,
      'context', r.context,
      'reason', r.reason,
      'details', r.details,
      'status', r.status,
      'action_taken', r.action_taken,
      'created_at', r.created_at,
      'actioned_at', r.actioned_at
    ) ORDER BY r.created_at DESC
  ), '[]'::jsonb)
  INTO v_reports
  FROM public.reports r
  JOIN public.profiles pr_rep ON pr_rep.id = r.reporter_user_id
  JOIN public.profiles pr_tgt ON pr_tgt.id = r.reported_user_id
  WHERE (p_status IS NULL OR r.status = p_status);

  RETURN v_reports;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_reports(text) TO authenticated;

-- 9. RPC: action_report
CREATE OR REPLACE FUNCTION public.action_report(
  p_report_id uuid,
  p_action text,
  p_admin_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_report record;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: Admin privileges required';
  END IF;

  IF p_action NOT IN ('warn', 'reset_handle', 'suspend', 'dismiss') THEN
    RAISE EXCEPTION 'Invalid moderation action: %', p_action;
  END IF;

  SELECT * INTO v_report FROM public.reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  -- Apply target profile updates
  IF p_action = 'reset_handle' THEN
    UPDATE public.profiles SET handle = NULL WHERE id = v_report.reported_user_id;
  ELSIF p_action = 'suspend' THEN
    UPDATE public.profiles SET is_suspended = true WHERE id = v_report.reported_user_id;
  END IF;

  UPDATE public.reports
  SET
    status = CASE WHEN p_action = 'dismiss' THEN 'dismissed' ELSE 'actioned' END,
    action_taken = p_action,
    actioned_at = now(),
    actioned_by = v_admin_id
  WHERE id = p_report_id;

  RETURN jsonb_build_object(
    'success', true,
    'report_id', p_report_id,
    'action', p_action,
    'target_user_id', v_report.reported_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_report(uuid, text, text) TO authenticated;
