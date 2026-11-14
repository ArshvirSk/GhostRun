# GhostRun — Moderation Procedure & Safety Guide

> **Status:** Active Operational Guide  
> **Companions:** `docs/FRIENDS_LEADERBOARDS.md`, `docs/specs/FL-P0.md`, `docs/FL_AUDIT.md`, `src/lib/privacy.ts`  
> **Target Response SLA:** Under 24 Hours

---

## 1. Overview & Policy

GhostRun is designed for safe, in-person outdoor tactical gameplay among trusted players (adults 18+ or youth supervised by a guardian). To protect players without collecting invasive surveillance data, GhostRun pairs server-enforced safety limits with player reporting and automated operator digests.

### Key Moderation Principles
1. **Privacy-Preserving Reports:** Reports capture context, reason, optional player notes, and references to game/message IDs. Reports **never** capture GPS coordinates, location trails, or map snapshots.
2. **Speed & Accountability:** Operator response target is **under 24 hours**.
3. **Proportionality:** Actions range from friendly warnings to handle resets and account suspensions.
4. **Transparent Appeals:** Every actioned player has a direct, human-reviewed email appeal route.

---

## 2. Report Ingestion & Storage

Reports are submitted via in-app action sheets from four tactical touchpoints:
- **Lobby:** Inappropriate player name, lobby harassment.
- **Team Radio:** Toxic comms, vulgar language, spam.
- **Friends List:** Harassment, unwanted requests.
- **Boards / Leaderboards:** Offending handle, suspected GPS spoofing or win trading.

### 2.1 Database Record (`public.reports`)

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary report identifier. |
| `reporter_user_id` | `uuid` | Authenticated reporter's profile ID. |
| `reported_user_id` | `uuid` | Profile ID of the reported individual. |
| `game_id` | `uuid` (nullable) | Associated game ID if report originated in a lobby/match. |
| `message_id` | `uuid` (nullable) | Specific radio message ID if reporting chat. |
| `context` | `text` | Source: `'lobby'`, `'friends'`, `'board'`, `'radio'`, or `'other'`. |
| `reason` | `text` | Reason: `'harassment'`, `'inappropriate_name'`, `'cheating'`, `'unsafe_behaviour'`, `'other'`. |
| `details` | `text` (nullable) | Optional explanation (max 200 characters). |
| `status` | `text` | `'pending'`, `'reviewed'`, `'actioned'`, `'dismissed'`. |
| `action_taken` | `text` (nullable) | Action applied by moderator (e.g. `'warn'`, `'reset_handle'`, `'suspend'`). |
| `created_at` | `timestamptz` | Submission timestamp. |
| `actioned_at` | `timestamptz` | Resolution timestamp. |
| `actioned_by` | `uuid` (nullable) | Moderator user ID who resolved the report. |

### 2.2 Security & RLS
- Reporters can view only the reports they submitted (`reporter_user_id = auth.uid()`).
- Players cannot query reports filed against them.
- Only accounts verified by `public.is_admin_user()` can view all reports, filter by status, and update report resolutions.

---

## 3. Daily Digest Generation

To eliminate manual polling and maintain the 24-hour response SLA, the operator reviews a daily digest summarizing pending reports:

### Digest Summary Format
```text
=== GHOSTRUN DAILY MODERATION DIGEST (2026-11-15) ===
Pending Reports: 3
New Blocks (Past 24h): 5
Active Suspensions: 1

[Report #1] Context: board | Reason: inappropriate_name
- Reported: @t0x1c_ghost (ID: a1b2c3d4-...)
- Reporter: @operative_7 (ID: e5f6g7h8-...)
- Note: "Offensive slur in bio/handle"
- History: 2 prior reports (pending)

[Report #2] Context: radio | Reason: harassment
- Reported: @shadow_chaser (ID: 99aa88bb-...)
- Details: Message ID 11223344-...: "Spamming aggressive threats"
- Game ID: 55667788-...
```

---

## 4. Moderation Action Matrix

Moderators apply escalating enforcement based on violation severity:

| Action Tier | Trigger / Violation | Enforcement Mechanism |
|---|---|---|
| **Tier 1: Formal Warning** | First-time minor radio spam, unsportsmanlike conduct. | Warning banner displayed in app upon next login; report marked `actioned`. |
| **Tier 2: Handle Reset** | Profane, hateful, or impersonating `@handle`. | Handle column set to `NULL`; player prompted to choose a new valid handle before accessing social or boards. |
| **Tier 3: Temporary Suspension (7–30 Days)** | Repeated harassment, confirmed mock GPS injection, unsafe physical boundary breach. | `is_suspended` set to `true`; token revoked; cannot create/join games or send friend requests. |
| **Tier 4: Permanent Ban** | Severe harassment, hate speech, physical endangerment, stalking. | Profile permanently suspended; auth access disabled; IP/device hash blocked. |

---

## 5. Player Appeals Procedure

Every actioned account is provided clear instructions on how to appeal:

1. **Email Channel:** Appeals must be submitted to `support@ghostrun.app` (or `PRIVACY_CONTACT_EMAIL` = `arshvirsk26@gmail.com`).
2. **Subject Format:** `[APPEAL] Account Suspension / Handle Reset - @handle`
3. **Required Details:**
   - Account email or User ID.
   - Date and description of the action taken.
   - Explanation / grounds for appeal.
4. **Resolution SLA:** All appeals receive a written decision from the lead operator within **48 hours**. If upheld, the ban remains; if overturned, full access and handle are restored immediately.
