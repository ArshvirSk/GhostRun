-- Migration: Set all privacy defaults to true and update existing 4 profiles
-- 1. Ensure profile columns default to true
ALTER TABLE public.profiles
  ALTER COLUMN show_presence SET DEFAULT true,
  ALTER COLUMN allow_friend_requests SET DEFAULT true,
  ALTER COLUMN share_echo SET DEFAULT true,
  ALTER COLUMN profile_visibility SET DEFAULT 'public';

-- 2. Update all existing profiles (4 existing operatives) to have all privacy on
UPDATE public.profiles
SET show_presence = true,
    allow_friend_requests = true,
    share_echo = true,
    profile_visibility = 'public';

-- 3. Ensure consents table has granted records for all existing users
INSERT INTO public.consents (user_id, consent_type, granted, policy_version)
SELECT id, 'ghost', true, 4 FROM public.profiles;

INSERT INTO public.consents (user_id, consent_type, granted, policy_version)
SELECT id, 'leaderboard_name', true, 4 FROM public.profiles;

INSERT INTO public.consents (user_id, consent_type, granted, policy_version)
SELECT id, 'diagnostics', true, 4 FROM public.profiles;

INSERT INTO public.consents (user_id, consent_type, granted, policy_version)
SELECT id, 'show_presence', true, 4 FROM public.profiles;

INSERT INTO public.consents (user_id, consent_type, granted, policy_version)
SELECT id, 'share_echo', true, 4 FROM public.profiles;

-- 4. Update upsert_profile to initialize privacy columns to true
CREATE OR REPLACE FUNCTION public.upsert_profile(name text, color text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to save a profile.';
  END IF;

  IF name IS NULL OR char_length(btrim(name)) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Display name must contain between 1 and 20 characters.';
  END IF;

  IF color IS NULL OR color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Player color must be a six-digit hexadecimal color.';
  END IF;

  INSERT INTO public.profiles (
    id, display_name, color, show_presence, allow_friend_requests, share_echo, profile_visibility
  )
  VALUES (
    caller_id, btrim(name), color, true, true, true, 'public'
  )
  ON CONFLICT (id) DO UPDATE
    SET display_name = excluded.display_name,
        color = excluded.color;
END;
$$;
