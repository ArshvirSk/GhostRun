# GhostRun — Specification: FL-P1 Friends Graph, QR Invites & Presence

> **Status:** Active Phase Specification  
> **Milestone:** Wave 6 / Task FL2 (Phase P1)  
> **Companions:** `docs/FRIENDS_LEADERBOARDS.md`, `docs/specs/FL-P0.md`, `docs/MODERATION.md`, `docs/WAVES.md`

---

## 1. Overview & Objectives

Phase P1 builds the bidirectional, privacy-preserving Friends Graph on top of Phase P0 handles and moderation:
1. **Exact-Handle & Invite Link / QR Discovery:** Strict peer-to-peer connection model with **zero browsing, stranger search, or recommendation algorithms**.
2. **Ephemeral Host Presence:** Opt-in broadcast ("friend is hosting") with 30-minute auto-expiry, revealing **only** display name, mode, and player count — never location, coordinates, or time of play.
3. **Privacy Controls (Consents C8 & C9):** Explicit toggles for friend requests, presence broadcast, and Echo sharing.
4. **Abuse Mitigation:** Rate limits (10 requests/day, 20 pending, 200 friend ceiling), 7-day decline cooldown, and silent mutual unfriend/block.

---

## 2. Friends Graph Architecture

### 2.1 Database Schema
```sql
-- 1. Profiles privacy & presence fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_presence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_friend_requests boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS share_echo boolean NOT NULL DEFAULT false;

-- 2. Friendships table with canonical pair ordering
CREATE TABLE public.friendships (
  user_a uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

-- 3. Ephemeral Host Presence
CREATE TABLE public.host_presence (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  mode_id text NOT NULL,
  player_count int NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL
);

-- 4. Single-Use / 24-hour Friend Invite Tokens
CREATE TABLE public.friend_invites (
  token_hash text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
```

### 2.2 Security & RLS
- `friendships`: Members can select only rows where `auth.uid() IN (user_a, user_b)`. Blocked users are filtered out automatically.
- `host_presence`: Readable only by accepted friends of `user_id` when `show_presence` is true and `expires_at > now()`.
- `friend_invites`: Token hashes are checked via `SECURITY DEFINER` RPC only.

---

## 3. Server-Authoritative RPCs

1. `send_friend_request(p_target_handle text)`:
   - Finds target by exact case-insensitive handle.
   - Enforces block checks (neither user has blocked the other).
   - Enforces `allow_friend_requests` setting on target.
   - Enforces 7-day cooldown if a previous request was declined.
   - Enforces caps: max 10 requests sent in past 24h, max 20 pending, max 200 accepted friends.
   - Creates or updates `friendships` row.
2. `respond_friend_request(p_requester_id uuid, p_action text)`:
   - `p_action IN ('accept', 'decline')`.
   - On accept: sets `status = 'accepted'`.
   - On decline: sets `status = 'declined'`, starting 7-day cooldown.
3. `remove_friend(p_friend_id uuid)`:
   - Deletes friendship row silently (no notification to peer).
4. `create_friend_invite() RETURNS jsonb`:
   - Generates crypto-random token valid for 24 hours.
   - Stores SHA-256 hash in `friend_invites`.
5. `redeem_friend_invite(p_token text) RETURNS jsonb`:
   - Validates token hash, expiration, and prior use.
   - Creates accepted friendship between caller and token owner.
6. `publish_presence(p_game_id uuid, p_mode_id text, p_player_count int)`:
   - Called on lobby creation/update if host has `show_presence = true`.
   - Upserts `host_presence` with `expires_at = now() + interval '30 minutes'`.
7. `clear_presence()`:
   - Removes caller's entry from `host_presence`.
8. `friends_hosting() RETURNS jsonb`:
   - Returns active lobbies hosted by accepted friends where `show_presence = true` and `expires_at > now()`.
9. `set_friend_settings(p_allow_requests boolean, p_show_presence boolean, p_share_echo boolean)`:
   - Updates `public.profiles` and records C8/C9 consents in `public.consents`.

---

## 4. UI Touchpoints
- **You Tab → Friends Sheet:** Tabbed or modal interface with:
  - "My Friends" (display name, handle, presence badge).
  - "Requests" (incoming with Accept/Decline, outgoing with Cancel).
  - "Add Friend" (exact handle input or QR / Invite link share sheet).
  - "Blocked Players" (list with one-tap unblock).
- **Play Tab Presence Row:** "Friends Hosting Now" card showing friend name, game mode, player count, and "Join" button.

---

## 5. Acceptance Criteria
- Full test suite `scripts/test-friends-graph.ts` covering:
  - Friendship canonical ordering and mutual resolution.
  - Rate limits (10/day, 20 pending, 200 total).
  - 7-day decline cooldown enforcement.
  - Presence TTL expiration (30m) and data minimization (no coordinates).
  - Silent unfriend and block propagation.
  - C8/C9 consent record logging.
- `npm run typecheck` passes with zero errors.
