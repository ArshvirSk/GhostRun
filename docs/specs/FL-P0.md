# GhostRun — Specification: FL-P0 Foundations (Handles, Report & Block, Moderation)

> **Status:** Active Phase Specification  
> **Milestone:** Wave 6 / Task FL1 (Phase P0)  
> **Companions:** `docs/FRIENDS_LEADERBOARDS.md`, `docs/MODERATION.md`, `docs/FL_AUDIT.md`, `docs/WAVES.md`, `docs/specs/handles.md`

---

## 1. Overview & Objectives

Phase P0 establishes the social and safety baseline required before any peer interactions, friend graphs, or competitive leaderboards can ship:
1. **Unique `@handle`:** Globally unique, permanent player identifier (3–20 alphanumeric + `_`, case-insensitive).
2. **Display Name Separation:** In-game tactical callsign (`display_name`) remains separate from social/board handle (`@handle`).
3. **Report & Block:** Comprehensive safety controls across lobby, friends list, and boards.
4. **Moderation Procedure:** Standard operating procedures documented in `docs/MODERATION.md`, including 24-hour response target, daily operator digests, and appeal procedures.

---

## 2. Handle Architecture

### 2.1 Database Schema
- Column on `public.profiles`:
  ```sql
  CREATE EXTENSION IF NOT EXISTS citext;
  ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS handle citext UNIQUE;
  ```
- Validation constraints:
  - Length: 3 to 20 characters.
  - Characters: alphanumeric and underscore: `^[a-zA-Z0-9_]{3,20}$`.
  - Leading/trailing: No leading or trailing underscore (`^[a-zA-Z0-9][a-zA-Z0-9_]{1,18}[a-zA-Z0-9]$`).
  - No double underscores (`!~ '__'`).

### 2.2 Reserved Words & Profanity Filter
- Prohibited handles:
  - System/Admin: `admin`, `administrator`, `moderator`, `mod`, `operator`, `system`, `security`, `root`, `staff`, `official`.
  - Brand: `ghostrun`, `ghostrunapp`, `deepmind`, `google`, `support`, `help`, `emergency`.
  - Game mechanics: `hunter`, `runner`, `ghost`, `ai_gm`, `target`, `beacon`, `referee`.
  - Protocol keywords: `null`, `undefined`, `anonymous`, `guest`.
- Profanity filter applied before insertion.

### 2.3 RPCs
1. `check_handle(p_handle text) RETURNS jsonb`:
   - Validates syntax, reserved words, profanity, and collision.
   - Rate-limited: max 30 checks per hour per caller/IP.
   - Returns `{ "available": boolean, "normalized": string, "reason": string | null }`.
2. `claim_handle(p_handle text) RETURNS jsonb`:
   - Authenticated caller claims unique handle.
   - Enforces format, reserved list, and uniqueness.
   - Returns `{ "success": boolean, "handle": string }`.
3. `get_my_handle() RETURNS text`:
   - Returns authenticated user's claimed handle or null.

---

## 3. Report and Block Architecture

### 3.1 Data Tables
1. `public.blocks`:
   - `user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`
   - `blocked_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - Primary key: `(user_id, blocked_user_id)`
   - RLS: User can only select, insert, and delete their own blocks.

2. `public.reports`:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `reporter_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`
   - `reported_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`
   - `game_id uuid REFERENCES public.games(id) ON DELETE SET NULL`
   - `message_id uuid REFERENCES public.team_messages(id) ON DELETE SET NULL`
   - `context text NOT NULL CHECK (context IN ('lobby', 'friends', 'board', 'radio', 'other'))`
   - `reason text NOT NULL CHECK (reason IN ('harassment', 'inappropriate_name', 'cheating', 'unsafe_behaviour', 'other'))`
   - `details text CHECK (details IS NULL OR char_length(details) <= 200)`
   - `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed'))`
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - `action_taken text`
   - `actioned_at timestamptz`
   - `actioned_by uuid REFERENCES public.profiles(id)`
   - RLS: Reporters can insert and view their own reports; Admins (`is_admin_user()`) can view all and update status/actions.

### 3.2 Block Effects
- Blocked user cannot send friend requests to blocker.
- Blocked user cannot join games hosted by blocker.
- Existing friendship and presence between them immediately terminate.
- Blocked user is hidden from friends boards and head-to-head records.
- Team radio messages from blocked users are hidden from blocker.
- Lobby list filters out blocked users as joinable invitees.

### 3.3 RPCs
- `block_user(p_target_user_id uuid)`
- `unblock_user(p_target_user_id uuid)`
- `list_my_blocks() RETURNS jsonb`
- `report_user(p_reported_user_id uuid, p_context text, p_reason text, p_details text, p_game_id uuid, p_message_id uuid) RETURNS uuid`
- `get_admin_reports(p_status text) RETURNS jsonb` (Admin only)
- `action_report(p_report_id uuid, p_action text, p_admin_note text) RETURNS jsonb` (Admin only)

---

## 4. Moderation Procedure Integration

Detailed in `docs/MODERATION.md`:
- Daily digest aggregation script / query.
- 24-hour response target SLA.
- Progressive enforcement: Warning -> Handle reset -> Temporary suspension -> Permanent ban.
- User appeal route via email (`support@ghostrun.app`).

---

## 5. Verification & Acceptance Criteria
- Unit test suite `scripts/test-handles-moderation.ts` verifying:
  - Handle format constraints (3-20 chars, regex, underscore rules).
  - Reserved words rejection.
  - Case-insensitive handle collision.
  - Report context and reason checks.
  - Block cascading rules and mutual isolation.
  - Daily digest formatting logic.
- Typecheck passes with zero errors.
