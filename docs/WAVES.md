# GhostRun — Master Feature Waves

> **Status:** Active Master Roadmap  
> **Companions:** `docs/NEW_FEATURES.md`, `docs/FRIENDS_LEADERBOARDS.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`

---

## Roadmap Overview

```mermaid
flowchart TD
    W1["Wave 1: Easy to Start, Hard to Fail (Active)"] --> W2["Wave 2: Comms, Safety & Player Progress"]
    W2 --> W3["Wave 3: Operations & Group Retention"]
    W3 --> W4["Wave 4: Reach, Platform & Accessibility"]
    W4 --> W5["Wave 5: Scale & Extras"]
    W5 --> W6["Wave 6: Friends, Moderation & Echo Leaderboards"]
```

---

## Wave 1: Easy to Start, Hard to Fail (Completed)
*Focus: Eliminating friction and physical GPS/tracking failures before match start.*

| ID | Feature | Priority | Effort | Status | Companion / Spec |
|---|---|---|---|---|---|
| **NF-04** | Pre-game Ready Check (tracking health & sensors) | A | S–M | Completed | `docs/specs/NF-04.md` |
| **NF-05** | Silent-by-default alerts (tactical vibration channels) | A | S | Completed | `docs/specs/NF-05.md` |
| **NF-06** | Safety check-in & curfew (host toggles & alert) | A | S–M | Completed | `docs/specs/NF-06.md` |
| **NF-03** | Rematch & role rotation (fairness & ratio balance) | A | S | Completed | `docs/specs/NF-03.md` |
| **NF-02** | Invite links & share sheet (code prefill & join link) | A | S–M | Completed | `docs/specs/NF-02.md` |

---

## Wave 2: Comms, Safety & Player Progress
*Focus: In-game team tactical coordination, boundary penalties, and personal records.*

| ID | Feature | Priority | Effort | Status | Notes |
|---|---|---|---|---|---|
| **NF-07** | Team Radio (team text chat & quick-chat chips) | B | M | Queued | Team-isolated channels only. |
| **NF-09** | Boundary rule options (`reveal_live`, `auto_tag`) | B | S–M | Queued | Server-enforced via scheduled pings. |
| **NF-10** | Shareable round card (privacy-trimmed graphic) | B | S–M | Queued | 150m privacy start/finish trim + blurred map. |
| **NF-11** | Badges & personal records (server-computed) | B | M | Queued | Achievements based on existing telemetry. |
| **NF-17** | Privacy-safe analytics & crash reporting | B | S–M | Queued | Opt-in consent C7; zero GPS/name telemetry. |
| **NF-18** | In-app feedback & bug report form | B | S | Queued | Diagnostics bundle without raw coordinates. |
| **NF-32** | In-app review prompt & support contact | B | S | Queued | Google Play review API after positive events. |

---

## Wave 3: Operations & Group Retention
*Focus: Group scheduling, asynchronous alerts, and seasonal calendar.*

| ID | Feature | Priority | Effort | Status | Notes |
|---|---|---|---|---|---|
| **NF-12** | Remote push notifications (FCM / Expo) | B | M | Queued | Inactive invites and start alerts. |
| **NF-13** | Scheduled games & calendar reminders | C | M | Queued | RSVP tracking and `.ics` integration. |
| **NF-15** | Season recap card ("Wrapped") | C | S–M | Queued | Monthly/yearly statistical highlights. |
| **NF-16** | Crews & squad lists | C | M–L | Queued | Persistent group lists with one-tap invites. |
| **NF-31** | Season framework & promo announcement banners | C | S–M | Queued | Remote-config banner slots on Play tab. |

---

## Wave 4: Reach, Platform & Accessibility
*Focus: Cross-platform distribution, internationalization, and accessibility.*

| ID | Feature | Priority | Effort | Status | Notes |
|---|---|---|---|---|---|
| **NF-19** | Official website & join gateway | B | M | Queued | Next.js static site, App Links verification. |
| **NF-20** | Localisation (i18n string table) | C | M | Queued | Central string extraction; multi-language. |
| **NF-21** | iOS build & TestFlight | C | L | Queued | Expo iOS configuration & review prep. |
| **NF-22** | Discord bot integration | D | S–M | Queued | Match creation & recap webhooks. |
| **NF-25** | Accessibility extras (colorblind radar, high-contrast) | C | M | Queued | Outdoor sunlight readability & screen reader. |
| **NF-26** | Admin console & remote config tooling | C | S–M | Queued | Secure web interface for operations. |
| **NF-33** | Spoken narration for AI Game Master (TTS) | C | S | Queued | On-device `expo-speech` text narration. |

---

## Wave 5: Scale & Extras
*Focus: Large community events, wearables, and optional commercial tooling.*

| ID | Feature | Priority | Effort | Status | Notes |
|---|---|---|---|---|---|
| **NF-23** | Event mode for large games (50–150 players) | D | L | Queued | Realtime broadcast channels & spectator feeds. |
| **NF-24** | Wear OS companion app | D | L | Queued | Wrist haptics and one-tap actions. |
| **NF-27** | Replay video export (MP4/GIF) | D | L | Queued | Animated trail video with privacy trimming. |
| **NF-28** | Hosting purchase (Monetisation) | D | M | Queued | One-time unlock (only if public release). |
| **NF-36** | Community rule packs (Data-only) | D | M | Queued | Validated custom rules (no code/scripts). |

---

## Wave 6: Friends, Moderation & Echo Leaderboards
*Source: `docs/FRIENDS_LEADERBOARDS.md` (Dedicated 4-Phase System)*

| Phase | Milestone | Scope | Status | Notes |
|---|---|---|---|---|
| **FL1** | **Phase P0: Foundations** | Unique `@handle`, Report & Block, Moderation guide | Queued | Fulfills & deepens base NF-08. |
| **FL2** | **Phase P1: Friends Graph** | Exact-handle requests, signed invite links/QR, presence | Queued | Fulfills & deepens base NF-30 & NF-02. |
| **FL3** | **Phase P2: Echo Scoring Engine** | Original ping metric, 3 ranked modes, anti-cheat, owner-only | Queued | Calibration in `docs/ECHO_CALIBRATION.md`. |
| **FL4** | **Phase P3: Private Friends Board** | Hourly refresh, 60m delay, head-to-head records | Queued | Fulfills & deepens private NF-14. |
| — | *Phase P4: Public Boards* | Opt-in global leaderboard (top 100, no country/flags) | Deferred | Gated on post-P3 review. |

---

## Execution Rules
1. Work one feature at a time, spec first: write `docs/specs/<ID>.md` and wait for approval.
2. Every feature ships with server feature flag off by default.
3. Zero weakening of Row-Level Security (RLS) or privacy guarantees.
4. All deferred physical checks logged in `docs/PHYSICAL_CHECKLIST.md`.
