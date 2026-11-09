# GhostRun — Specification: Player Handles & Unique Identifiers (NF-08 / NF-14)

**Status:** Proposed (Awaiting User Approval for Database Migration)  
**Target Milestone:** Post-UI-M4 Database Migration & Feature Wave 2  
**Related Documents:** `docs/UI_RESTRUCTURE.md §7.1`, `docs/NEW_FEATURES.md NF-08, NF-14`, `docs/DECISIONS.md`

---

## 1. Executive Summary

Today, GhostRun identifies players in gameplay using a non-unique `profiles.name` (display name / codename) and an 8-color accent. To support friend discovery (NF-30), global leaderboards (NF-14), team radio (NF-07), and reporting/moderation (NF-08), a globally unique, stable, and user-friendly `@handle` is required.

Per **Addendum C Item 9**, handles require server support (uniqueness constraint, availability check RPC, moderation rules). Until this specification is approved and migrated, the sign-up flow ships with display name and color only.

---

## 2. Server Schema & Constraints

### 2.1 Database Column
Add a unique, nullable `handle` column to `public.profiles`:
```sql
ALTER TABLE public.profiles
  ADD COLUMN handle text NULL;

CREATE UNIQUE INDEX idx_profiles_handle_unique
  ON public.profiles (LOWER(handle))
  WHERE handle IS NOT NULL;
```

### 2.2 Handle Validation Rules
1. **Character Set:** Lowercase alphanumeric characters and underscores only: `^[a-z0-9_]{3,20}$`.
2. **Length:** Minimum 3 characters, maximum 20 characters.
3. **No Leading/Trailing Underscores:** Cannot start or end with `_`.
4. **No Consecutive Underscores:** Cannot contain `__`.
5. **Case Insensitivity:** All handles stored and queried in lowercase.

```sql
ALTER TABLE public.profiles
  ADD CONSTRAINT chk_profiles_handle_format
  CHECK (
    handle IS NULL OR (
      handle ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$' AND
      handle !~ '__'
    )
  );
```

### 2.3 Reserved Handles
The following keywords are reserved and prohibited from user registration:
- System roles: `admin`, `moderator`, `operator`, `hunter`, `runner`, `ghost`, `ai_gm`, `referee`.
- Brand & app keywords: `ghostrun`, `support`, `official`, `system`, `security`, `emergency`.
- Protocol terms: `null`, `undefined`, `guest`, `anonymous`.

---

## 3. Server-Authoritative RPCs

### 3.1 Availability Check RPC (`check_handle_available`)
Enables live debounced UI validation without exposing user profile rows to unauthorized queries:
```sql
CREATE OR REPLACE FUNCTION public.check_handle_available(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized text;
  v_reserved text[] := ARRAY[
    'admin', 'moderator', 'operator', 'hunter', 'runner',
    'ghost', 'ai_gm', 'ghostrun', 'support', 'system'
  ];
BEGIN
  v_normalized := LOWER(TRIM(p_handle));

  -- Format check
  IF NOT (v_normalized ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$') OR v_normalized ~ '__' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'invalid_format');
  END IF;

  -- Reserved check
  IF v_normalized = ANY(v_reserved) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'reserved');
  END IF;

  -- Existence check
  IF EXISTS (SELECT 1 FROM public.profiles WHERE LOWER(handle) = v_normalized) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'taken');
  END IF;

  RETURN jsonb_build_object('available', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_handle_available(text) TO anon, authenticated;
```

### 3.2 Handle Update in `upsert_profile`
Update `public.upsert_profile(p_name text, p_color text, p_handle text DEFAULT NULL)`:
- If `p_handle` is supplied, validates availability and stores `LOWER(TRIM(p_handle))`.
- If caller already holds that handle, permits update without collision error.

---

## 4. Client Sign-Up Flow Integration

When approved:
1. In `app/(onboarding)/signup/`:
   - Step 1: **Name & Color** (`name.tsx`)
   - Step 2: **Unique Handle** (`handle.tsx`)
     - Input field with leading `@` prefix icon.
     - 300ms debounced call to `check_handle_available(handle)`.
     - Visual states:
       - Idle: Subtitle "Pick a unique tag for friends and leaderboards."
       - Checking: Inline tactical pulse spinner.
       - Available: Phosphor mint checkmark: `@handle is available`.
       - Taken / Invalid: Amber/red warning with specific advice (e.g. "That handle is already claimed").
   - Step 3: **Account** (`account.tsx`)
   - Step 4: **Verification** (`code.tsx`)
   - Step 5: **Before You Play** (`before-you-play.tsx`)
2. Guest players may skip the handle step until they link or upgrade their account.

---

## 5. Migration & Backfill Strategy

For existing players:
1. The column is nullable; existing accounts without handles remain fully functional.
2. When an existing player opens their profile or case file in the You tab (`(tabs)/you.tsx`), a gentle non-blocking prompt suggests claiming their `@handle`.
3. Leaderboard participation (NF-14) will require a claimed `@handle` or will display as masked `'Anonymous Runner'`.
