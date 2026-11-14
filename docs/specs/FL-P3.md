# GhostRun — Specification: FL-P3 Private Friends Board, Privacy Delay & Head-to-Head

> **Status:** Active Phase Specification  
> **Milestone:** Wave 6 / Task FL4 (Phase P3)  
> **Companions:** `docs/FRIENDS_LEADERBOARDS.md`, `docs/specs/FL-P0.md`, `docs/specs/FL-P1.md`, `docs/specs/FL-P2.md`, `docs/ECHO_CALIBRATION.md`

---

## 1. Overview & Privacy Safeguards

Phase P3 introduces the private competitive surface for friends, governed by GhostRun's strict privacy-first constraints:
1. **Private by Design:** No global boards, no public search, no country boards, and **no flags**. The board exists strictly between mutually accepted friends who explicitly opt in to sharing their Echo (`share_echo = true`).
2. **60-Minute Privacy Delay Rule:** Round scores are incorporated into the friends board only after at least **60 minutes** have elapsed since match completion (`ended_at <= now() - interval '60 minutes'`). This ensures an observer cannot deduce in real-time when an operative has completed physical outdoor movement.
3. **Hourly Refresh Batching:** Friends board rankings are cached and refreshed on an hourly schedule.
4. **Head-to-Head Tactical Dossier:** Counters between friends on opposite sides (rounds played, round wins, pings ghosted, pings cashed) showing **counts only — zero dates, timestamps, coordinates, or locations**.
5. **How Echo Works Explainer:** Educational breakdown of ghosted pings, cashed pings, outcome, and presence with worked examples.

---

## 2. Server Architecture & RPCs

### 2.1 Database Function `get_friends_board(p_season text DEFAULT NULL)`
- Validates caller authentication.
- Season defaulted to current calendar month (`YYYY-MM`).
- Enforces mutual acceptance and privacy permissions:
  - Caller must have `share_echo = true`. If caller has `share_echo = false`, returns prompt to enable sharing.
  - Returns caller row + accepted friends where friend has `share_echo = true` and neither party has blocked the other.
- Incorporates only rounds satisfying `ended_at <= now() - interval '60 minutes'`.
- Columns returned:
  - `rank`: 1-based dense rank.
  - `user_id`: Operative UUID.
  - `display_name`: In-game callsign.
  - `handle`: Unique handle with `@`.
  - `season_echo`: Total best-12 Echo sum.
  - `tier`: Whisper, Shade, Wraith, Phantom, Revenant.
  - `rounds_counted`: Number of eligible rounds.
  - `avg_ghost`: Average runner ghost rate (0–100%).
  - `avg_cash`: Average hunter cash rate (0–100%).
  - `is_self`: Boolean flag highlighting caller row.

### 2.2 Database Function `get_head_to_head_stats(p_friend_id uuid)`
- Requires mutual friendship and both players having `share_echo = true`.
- Evaluates games where caller and friend were active on opposite teams.
- Counts:
  - `opposite_rounds`: Matches played as adversaries.
  - `my_wins`: Rounds caller's team won.
  - `friend_wins`: Rounds friend's team won.
  - `times_ghosted_them`: Times caller (runner) ghosted a ping when friend was hunter.
  - `times_they_cashed_me`: Times friend (hunter) cashed caller's ping.

---

## 3. UI Touchpoints & User Experience

1. **You Tab → "Friends Board" Entry:**
   - Highlights caller's current season Echo, tier badge, and ranking among friends.
   - Season selector dropdown: Current Month vs. Previous Month.
   - Tapping any friend's row opens the **Head-to-Head Dossier Sheet**.
2. **Head-to-Head Dossier Sheet:**
   - Tactical versus display with adversary stats, win/loss ratio, and ghost/cash head-to-head metrics.
3. **"How Echo Works" Screen / Modal:**
   - Clear visual breakdown of the delayed ping contest:
     - The Runner's Challenge: Ghosting stale pings ($Y_{runner}$).
     - The Hunter's Challenge: Cashing delayed Intel into contact ($Y_{hunter}$).
     - Tactical Outcome ($O$) & Presence ($P$).
     - Worked examples featuring Priya (Runner, 82 Echo) and Sam (Hunter, 29 Echo).
4. **First Friend Acceptance Share-Echo Dialog:**
   - When accepting first friend, user is prompted with two equal-weight options:
     - `[Keep Private]` (Default)
     - `[Share Echo with Friends]`

---

## 4. Acceptance Criteria
- Unit test suite `scripts/test-friends-board.ts` verifying:
  - 60-minute delay filter rule (`ended_at <= now() - 60m`).
  - Friends board ranking order and self-highlighting.
  - Head-to-head count calculations (zero coordinate leakage).
  - Empty state text ("Invite two friends to start a board").
  - Worked examples text fidelity.
- `npm run typecheck` passes with zero errors.
