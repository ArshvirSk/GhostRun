# GhostRun — Friends, Report/Block and the Echo Score

> **Status:** specification, nothing built yet. Companion to `NEW_FEATURES.md` (this document **replaces** NF-08 basics, NF-30 and NF-14 for friends and leaderboards), `MODES.md`, `TRD.md` and the shipped design system.
> **Decisions already made:** (1) friends first, public leaderboards later; (2) **no country boards and no flags**; (3) Ghost Duel's leaderboards stay **separate and untouched**; (4) the scoring system is **brand new and original**, not copied from any other app.

---

## 1. Summary

| Piece | What it is |
|---|---|
| **Foundations** | Unique **handles**, **report and block**, a short moderation procedure |
| **Friends** | Add by handle or invite link, opt-in presence ("friend is hosting"), privacy toggles |
| **Echo** | A new scoring metric built around GhostRun's core mechanic: the delayed ping |
| **Friends board** | A private season board and head-to-head records among accepted friends |
| **Public boards** | **Later**, opt-in, handle only. This spec only leaves the hooks |

## 2. Goals and non-goals

### Goals
1. Make it easy to find and rejoin the people you play with, without exposing anyone to strangers.
2. A score that rewards **skill at the game's real contest** (information versus movement), is fair across roles, and is hard to farm.
3. Competition that is private by default and shows **no location, no time of play, no country**.
4. Everything computed on the server from data it already holds.

### Non-goals
- Public or global boards, country boards, flags, discovery or search of strangers, voice, in-app chat (a separate feature), crews, monetisation.
- Changing Ghost Duel's scoring or boards.
- Changing gameplay rules. Echo observes rounds, it does not change them.
- Any feature for under-18s. Policy stays **18 or older, or playing under a guardian's supervision**.

## 3. Foundations

### 3.1 Handles
- Unique `@handle`: 3 to 20 characters, letters, numbers and `_`, case-insensitive uniqueness, reserved names (admin, support, ghostrun, and similar), profanity filter, rate-limited availability check.
- The display name (shown in games) stays separate from the handle (shown on friends lists and boards).
- If handles already exist in the app, reuse them. If not, add them with a one-time "claim your handle" prompt for existing accounts.

### 3.2 Report and block
- **Report** from: a player in the lobby, a player on a friends list, a handle on any board. Reasons: harassment, inappropriate name, cheating, unsafe behaviour, other (optional text, 200 characters).
- **Block** from the same places. Effects of blocking:
  - the blocked user cannot send you friend requests or join games you host,
  - existing friendship, presence and board visibility between you end,
  - you stop seeing them in your lobby as a joinable invitee (you may still be placed in the same lobby by a third-party host, and you can leave).
- Unblock from Settings → Blocked players.
- **Moderation procedure** (`docs/MODERATION.md`): where reports are stored, how a daily digest is produced for the operator, a response target (aim for 24 hours), actions (warn, remove handle, suspend), and an appeal by email.
- Data: `reports(id, reporter_id, reported_user_id, game_id?, context, reason, note, status, created_at)` and `blocks(user_id, blocked_user_id, created_at)`. RLS: a user sees only their own blocks and the reports they filed. Reports are readable by the admin role only.

## 4. Friends

### 4.1 Rules
- **Add by exact handle** or by an **invite link or QR** (a signed, 24-hour token). **No search, no suggestions, no browsing.**
- A request needs accept. A declined request blocks a new request from the same sender for 7 days.
- Limits: 10 outgoing requests per day, 20 pending outgoing, 200 friends.
- Unfriend and block are one tap and silent (the other person is not notified).
- Friend lists show display name, handle, and (only if they share) tier and season Echo.

### 4.2 Presence ("friend is hosting")
- Setting **"Show friends when I'm hosting"**, **off by default**.
- When on and you open a lobby, friends see: your display name, the mode name, the number of players, and a **Join** action. They never see location, route, time of play, or any other game information.
- The entry disappears when the game starts, is cancelled, or after 30 minutes.
- A friend who joins is a normal participant. The host can still remove players.

### 4.3 Privacy settings
| Setting | Default | Effect |
|---|---|---|
| Allow friend requests | On | Off rejects new requests silently |
| Show friends when I'm hosting | **Off** | Controls presence |
| Share my Echo with friends | **Off** (asked with two equal buttons when you accept your first friend) | Controls appearing on friends boards and head-to-head |
| Blocked players | n/a | List and unblock |

All choices are stored as consent records (new items C8 and C9) and are covered by export and deletion.

### 4.4 Data model (summary)
```sql
-- profiles gains: handle citext unique, show_presence boolean default false,
--                 allow_friend_requests boolean default true, share_echo boolean default false

create table friendships (
  user_a uuid references profiles(id) on delete cascade,
  user_b uuid references profiles(id) on delete cascade,
  status text not null check (status in ('pending','accepted')),
  requested_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b)                -- canonical ordering, one row per pair
);

create table host_presence (
  user_id uuid primary key references profiles(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  mode_id text not null,
  player_count int not null default 1,
  expires_at timestamptz not null
);

create table friend_invites (
  token_hash text primary key,
  owner_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
```
RLS: friendships visible to the two members only. `host_presence` readable by accepted friends of that user and only while `expires_at > now()` and `show_presence` is true. Writes only through RPCs.

### 4.5 RPCs (all `SECURITY DEFINER`, validate `auth.uid()`)
`claim_handle`, `check_handle`, `send_friend_request`, `respond_friend_request`, `remove_friend`, `create_friend_invite`, `redeem_friend_invite`, `set_friend_settings`, `list_friends`, `list_friend_requests`, `report_user`, `block_user`, `unblock_user`, `list_blocks`, `publish_presence` (called by lobby creation when enabled), `clear_presence`, `friends_hosting`.

## 5. The Echo Score (original metric)

### 5.1 The idea
GhostRun's one-of-a-kind contest is the **delayed ping**: hunters see where a runner **was**, and the runner decides whether that echo leads anywhere. So the score measures exactly that.

- A **runner** earns Echo by making pings **lead nowhere** (the hunters chase a ghost).
- A **hunter** earns Echo by **cashing** pings (turning stale information into contact).
- Winning the round matters, but it is only part of the score, so a good runner on a losing team and a good hunter on a losing team still score.

Two headline stats come out of it, both easy to explain:
- **Ghost rate** (runners): how often your pings led hunters to an empty spot.
- **Cash rate** (hunters): how often a ping you were positioned for became contact.

### 5.2 Contested pings (the building block)
A ping of runner **r** at time **t** and location **L** is **contested** if, at time t:
1. r is **active** (not tagged, jailed, frozen, out or remote), and
2. at least one hunter **h** is within **200 m** of L, and
3. that hunter was **active**, meaning they moved at least **50 m** in the window **W** after the ping.

Condition 3 makes idle or colluding hunters irrelevant: a ping nobody actually acts on is not contested and does not count for or against anyone.

### 5.3 Ghosted, and cashed
Window **W = clamp(ping_interval / 2, 45 s, 120 s)** (for the default 150 s interval, W = 75 s).

- A contested ping is **ghosted** if r is **not tagged by t + W** and r's position at t + W is at least **D_min** from L, where **D_min = clamp(10% of zone radius, 30 m, 80 m)**.
- A contested ping is **cashed by hunter h** if h was positioned for it (condition 2 and 3 for h) and **within T_c = ping_interval + 60 s** after t, h came within **2 × tag radius** of r's actual position or tagged r.

Per player, over the round:
- Runner **Ghost rate** = smoothed (ghosted pings) / (contested pings).
- Hunter **Cash rate** = smoothed (pings cashed by h) / (contested pings h was positioned for).
- **Smoothing** (so a round with few pings is not extreme): `(count + k × 0.5) / (total + k)` with **k = 3**.

### 5.4 Round Echo
```
Echo = 100 × ( 0.40 × O  +  0.40 × Y  +  0.20 × P ) × D
```
| Term | Meaning | Range |
|---|---|---|
| **O** Outcome | Result for your team, from the mode's scoring profile (section 5.7) | 0 to 1 |
| **Y** Ping yield | Ghost rate for runners, Cash rate for hunters | 0 to 1 |
| **P** Presence | Runner: share of the live period you were active. Hunter: share of the live period you were in the zone **and** moving (at least 100 m per rolling 5 minutes) | 0 to 1 |
| **D** Difficulty | Fairness adjustment (below) | 0.85 to 1.15 |

**Difficulty D (v1):** based only on the team ratio, with H hunters and R runners:
- Runner: `D = 1 + 0.15 × clamp((H/R − 0.5) / 0.5, −1, 1)`
- Hunter: `D = 1 − 0.15 × clamp((H/R − 0.5) / 0.5, −1, 1)`
More hunters per runner makes the runner's job harder (runner D up) and the hunter's easier (hunter D down). Other terms (zone size, head start, ping interval, modifiers) are added **only after calibration** (section 10).

**Theoretical maximum** is about 115. Typical good rounds land between 60 and 90.

### 5.5 Worked examples
**Priya (runner)**, team wins. Her pings: 6 contested, 4 ghosted. Ghost rate = (4 + 1.5) / (6 + 3) = 0.611. Active for 90% of the live period. H/R = 0.5, so D = 1.
`Echo = 100 × (0.40×1 + 0.40×0.611 + 0.20×0.90) × 1 = 82`

**Sam (hunter)**, team loses. 5 contested pings he was positioned for, 1 cashed. Cash rate = (1 + 1.5) / (5 + 3) = 0.3125. In the zone and moving 80% of the live period. D = 1.
`Echo = 100 × (0.40×0 + 0.40×0.3125 + 0.20×0.80) × 1 = 29`

### 5.6 Rounds that count
A round produces scores only if **all** of these hold:
- At least 1 hunter and 2 runners (or the mode's own minimum), and the live period lasted at least 5 minutes.
- At least half of the players moved 150 m or more.
- No flag for mock location or sustained vehicle speed against that player (that player's round is excluded, others remain).
- The player did not leave early (leaving early scores **0** for that player).
- The mode is **ranked** (section 5.7).
Rounds ended early by the host score only the played portion for P and are **excluded from O** (no outcome points either way).

### 5.7 Scoring profiles (per mode, tunable on the server)
A mode's profile defines: whether it is **ranked**, the outcome mapping O, the weights, and which components apply. Stored server-side (`scoring_profiles`) so numbers can be tuned without an app update.

| Mode | Ranked in v1 | Outcome mapping (O) |
|---|---|---|
| `classic_chase` | Yes | Team win: 1. Runner tagged earlier in a winning round: 0.8. Team loss: 0 |
| `tag_hunt` | Yes | Team win: 1. Runner tagged in a winning round: 0.6. Team loss: 0 |
| `jailbreak` | Yes | Same pattern as Tag Hunt |
| Others (`relay_heist`, `territory_pulse`, `assassin_ring`, `ghost_duel`, and any new mode) | **No** | Rounds still count toward "Rounds played", never toward Echo until a profile is calibrated |
| Remote roles (Operator) | n/a | Remote players have no movement data. They earn **no Echo** in v1 |

Ghost Duel keeps its own separate scoring and boards.

### 5.8 Season score and tiers
- **Seasons are calendar months.**
- **Season Echo** = the sum of a player's **best 12 counted rounds** that season. A minimum of **3 counted rounds** is needed to appear on a board.
- **Daily cap:** at most **6** counted rounds per day. After the third round with the **identical set of players** on the same day, further rounds count at **50%**.
- **Tier** (display only) is based on the **average of your best 12 rounds**, with at least 5 counted rounds. Starting thresholds, to be calibrated:

| Tier | Average Echo |
|---|---|
| Whisper | under 40 |
| Shade | 40 to 54 |
| Wraith | 55 to 69 |
| Phantom | 70 to 84 |
| Revenant | 85 and above |

### 5.9 Anti-cheat and fairness
| Risk | Defence |
|---|---|
| Idle hunters help a friend look good | Contested pings require an **active** hunter nearby. Idle hunters make pings non-contested |
| Runner hides in one spot and farms "survival" | Ghost rate needs displacement from the ping. Camp pings and the noise rules already apply. P only counts active time |
| Win trading between two friends | Daily cap, same-group discount, minimum players and movement |
| GPS spoofing, vehicles | Rounds with mock-location or sustained vehicle-speed flags are excluded for that player |
| Padding with many short rounds | Minimum length, best-12 rule, daily cap |
| Leaving early after a good start | Leaving early scores 0 |
| Score depends on bad GPS | Positions with poor accuracy are ignored in the calculation. If too many samples are missing, the player's round is excluded rather than guessed |
| Small-sample luck | Smoothing with k = 3 and a 3-round minimum for boards |

### 5.10 What others can see
- **You:** your round breakdown (O, Y, P, D, Echo, ghost rate, cash rate).
- **Friends (only if you share):** Season Echo, tier, rounds counted, **average ghost rate and cash rate**. **Never** per-round details, dates, places or times.
- **Nobody:** positions or routes. The calculation happens on the server and exposes only the scores.

## 6. Friends board and head-to-head

### 6.1 Friends board
- Accepted friends **who share their Echo**, plus you.
- Columns: rank, name and handle, Season Echo, tier, rounds, ghost %, cash %.
- Season selector (this month, last month). Your row is highlighted.
- **Updates at most hourly**, using rounds that ended at least **60 minutes** earlier, so the board does not reveal that someone just finished a game.
- Empty and small-group states are friendly ("Invite two friends to start a board").

### 6.2 Head-to-head
For each friend (if both share): rounds played on **opposite sides**, rounds each won, **times you ghosted their pings** and **times they cashed yours**. Counts only, no dates or places.

### 6.3 Case file additions
Season Echo, tier, ghost rate, cash rate, best round. These are visible to the player only.

## 7. Data model for Echo (summary)

```sql
create table scoring_profiles (
  mode_id text primary key,
  ranked boolean not null default false,
  weights jsonb not null,                -- {"o":0.4,"y":0.4,"p":0.2}
  outcome_map jsonb not null,
  params jsonb not null                  -- r_press_m, active_move_m, k, d_range, etc.
);

create table round_scores (
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  mode_id text not null,
  role text not null,
  o real, y real, p real, d real, echo real,
  contested int, hit int,                -- ghosted (runner) or cashed (hunter)
  counted boolean not null default false,
  excluded_reason text,
  ended_at timestamptz not null,
  primary key (game_id, player_id)
);

create table season_scores (
  season text not null,                  -- e.g. '2026-11'
  user_id uuid references profiles(id) on delete cascade,
  echo_total real not null,
  rounds_counted int not null,
  avg_best real,
  avg_ghost real, avg_cash real,
  updated_at timestamptz not null,
  primary key (season, user_id)
);
```
- RLS: `round_scores` readable only by the owning user. `season_scores` readable by the owner, and by accepted friends through the **friends board RPC** only when `share_echo` is true. No direct table reads by friends.
- `compute_round_scores(game_id)`: idempotent, `SECURITY DEFINER`, runs when a game ends (and is safe to re-run). It reads `pings`, `trail_points`, `tags`, `players` and the game settings.
- `refresh_season_scores()`: scheduled hourly, applies best-12, daily cap and discounts.
- Retention: `round_scores` 90 days, `season_scores` 12 months, friendships until deletion, presence ephemeral. All deleted with the account.

## 8. UI (follow the shipped design system)

| Screen | Content |
|---|---|
| **You → Friends** | Friends list, requests (in and out), add by handle, my invite link or QR, blocked players |
| **Play tab** | "Friends hosting now" row (only when presence is on for them), one-tap Join |
| **You → Friends board** | Season selector, board, head-to-head sheet on tap |
| **Case file** | Echo card: Season Echo, tier, ghost rate, cash rate, best round |
| **Round result** | A short Echo breakdown for the player, in plain words |
| **How Echo works** | One screen explaining ghosted pings, cashed pings, outcome and presence, with the worked examples |
| **Settings → Privacy** | The four toggles in 4.3 and the blocked list |
| **Report / Block sheets** | From lobby rows, friends rows, board rows |

Copy follows the app's voice. Everything ships behind server flags, off by default.

## 9. Moderation and safety
- Report and block exist **before** friends ship.
- Friend-request abuse: exact-handle only, daily limits, 7-day decline cooldown, block.
- Presence reveals only name, mode, player count. It never reveals location.
- Handles are reviewed by a profanity filter and a report path.
- Policy and consent text updated before release (new items C8 and C9, the report and block data, friend data retention).
- No location, time-of-play or country appears on any board.

## 10. Calibration and testing

### 10.1 Calibration (before Echo is shown to anyone)
The simulator (`scripts/sim`) runs scripted rounds and the result is written to `docs/ECHO_CALIBRATION.md`:
- Scripted behaviours: strong runner, average runner, idle runner, strong hunter, average hunter, idle hunter, colluding pair.
- Targets: the **mean Echo for runners and hunters within about 5%** of each other across at least 200 simulated rounds per ranked mode; idle players score below 20; a colluding pair cannot beat an honest strong player; round scores are stable (small changes in sampling do not swing a score by more than a few points).
- Tuning knobs (server-side): weights, D range, W, D_min, k, tier thresholds.

### 10.2 Tests
- **Golden-case unit tests** for the Echo maths using fixed trails and pings, including the two worked examples in 5.5.
- **RLS rows:** friends cannot read each other's `round_scores`, cannot read `season_scores` when `share_echo` is false, cannot read presence unless friends and enabled, a blocked user cannot send requests or see presence, outsiders see nothing.
- **Simulator scenarios:** request, accept, unfriend, block flows; presence lifecycle; scoring end to end; daily cap and same-group discount; early leave; host-ended round; mock-flag exclusion.
- **Rate-limit tests:** friend requests per day, handle availability checks.
- **Deletion test:** deleting an account removes friendships, presence, reports it filed, round and season scores.
- Device checks are listed in `docs/PHYSICAL_CHECKLIST.md` and do not block the work.

## 11. Phases and acceptance

| Phase | Contents | Acceptance (agent-verifiable) |
|---|---|---|
| **P0 Foundations** | Handles (if missing), report and block, `docs/MODERATION.md` | Tests for uniqueness, rate limits, block effects; RLS rows pass |
| **P1 Friends** | Requests, list, invite link or QR, presence, privacy settings, UI | Flows and limits covered by tests; presence never exposes more than allowed; deletion test passes |
| **P2 Echo engine** | Tables, `compute_round_scores`, `refresh_season_scores`, scoring profiles, eligibility, calibration sim, **no public UI** except the owner's Case file card | Golden-case tests pass, calibration targets met, anti-cheat scenarios pass |
| **P3 Friends board** | Board, head-to-head, share-Echo consent, How Echo works, round breakdown | RLS rows pass, board delay rule tested, empty states exist |
| **P4 Public boards** | **Not now.** Opt-in, handle only, daily update with a 6-hour delay, top 100, no country or flag, report-a-name | Separate spec and approval only after P3 has been used |

## 12. Risks
| Risk | Mitigation |
|---|---|
| Echo feels unfair across roles or modes | Calibration targets, tunable profiles, ranked modes limited to three in v1 |
| Data volume for scoring | Computation is per finished round on small tables, scheduled work is hourly |
| GPS quality distorts scores | Accuracy filter, exclusion instead of guessing |
| Friends feature used for harassment | Exact-handle only, limits, block, reports, no discovery |
| Handles impersonate or offend | Reserved names, filter, report path |
| Solo-developer moderation load | Private games and friends-only first, daily digest, response target |
| Scoring is hard to explain | One How Echo works screen, two headline stats, worked examples |

## 13. Decisions needed from me
| # | Decision | Default |
|---|---|---|
| FL-D1 | Metric name "Echo", stats "Ghost rate" and "Cash rate", tier names Whisper to Revenant | As written |
| FL-D2 | Ranked modes in v1 | Classic Chase, Tag Hunt, Jailbreak |
| FL-D3 | Friends board update delay | 60 minutes, hourly refresh |
| FL-D4 | Season Echo rule | Best 12 rounds, minimum 3 to appear |
| FL-D5 | Share-Echo prompt on first accepted friend | Two equal buttons, default off |
| FL-D6 | Handle policy for existing users | One-time claim prompt, required before using friends |
| FL-D7 | Moderation response target | 24 hours |
| FL-D8 | Public boards | Later, separate spec |
