# B5 — Operator (Remote Teammate) Role Add-on Specification

> **Status:** Implemented & Verified in v2.4.0.  
> **MODES.md reference:** Section 5.3 (lines 560–577), compatibility matrix §2.3, mode catalogue §1 item 8.  
> **Effort estimate:** M (1–2 weeks).

---

## 1. Rules & Concept (from MODES.md §5.3)

### Core Concept
One player per squad (Runners or Hunters) acts as a remote **Operator** ("Mission Control"). Operators do not run physically outdoors or submit GPS coordinates; instead, they operate from a tactical map view, monitoring squad telemetry, placing tactical markers, and triggering coarse reconnaissance scans.

### Teams and Compatibility
- **Role Layer:** Role Add-on (`id = 'operator'`).
- **Base Mode Compatibility:** Compatible with `classic_chase`, `tag_hunt`, `jailbreak`, and `relay_heist`. Incompatible with solo free-for-all modes (`assassin_ring`, `ghost_duel`).
- **Player Constraints:**
  - At most **1 Operator per team** (`runner` or `hunter`).
  - Production recommendation: 4+ field players + up to 2 operators.
  - Minimum test requirement: 1 field runner, 1 field hunter + 1 operator.

---

## 2. Remote Player Lifecycle & Constraints

1. **Remote Status (`players.is_remote = true`):**
   - Designated during lobby via `set_player_remote(p_game_id, p_is_remote)`.
   - Cannot upload GPS positions (`submit_position` ignores or skips them without error).
   - Does not count as an in-bounds field runner or hunter for spatial mechanics.
   - **Immunity:** Cannot be tagged by field hunters or ghost NPCs; cannot tag runners.
   - Ready check does not require GPS coordinates or boundary checks for remote operators.

2. **Win Condition:**
   - The Operator shares the win/loss condition of their team.

---

## 3. Tactical Abilities & Scans

### 3.1 Operator Tactical Scan (`operator_scan`)
- **Cooldown:** **90 seconds** per operator (`cooldown_s = 90`), tracked in `player_resources.cooldowns->>'operator_scan'`.
- **Runner Operator Scan (Nearest Hunter Radar Sweep):**
  - Identifies the nearest active hunter who has a fresh position fix ($\le 45\text{ s}$).
  - Returns a **vague circular envelope**: center fuzzed by $\pm 30\text{ m}$ to prevent sniper-level precision, with an indicated radius of **150 m**.
  - Visible on the runner team's map for **10 seconds**, then fades.
  - Emits event `operator_scan_used` to runners.
- **Hunter Operator Scan (Sector Proximity Census):**
  - The Hunter Operator taps a point on the map $(lat, lng)$ within the play boundary.
  - The server counts how many active runners with fresh fixes ($\le 45\text{ s}$) are within **200 m** of that point.
  - Returns only an integer count (`count: N`), **never** exposing exact coordinates, bearings, or player names.
  - Emits event `operator_scan_used` to hunters.

### 3.2 Tactical Map Markers (`place_marker`)
- Any Operator can place up to **3 concurrent tactical markers** on their squad's map (`label`, `lat`, `lng`).
- Markers automatically expire after **90 seconds**.
- Stored in `entities` table with `kind = 'marker'` and `visible_to = mine.team`. Opponents cannot read markers under RLS.

---

## 4. Secrecy & Information Architecture

1. **Strict Squad Isolation:**
   - Operators see only what their team is authorized to see under existing RLS:
     - Runner Operator sees teammates' live positions, targets/extraction points, scheduled pings released to hunters, and team markers.
     - Hunter Operator sees teammates' live positions, scheduled released runner radar pings, and team markers.
   - Operators **never** receive real-time enemy GPS coordinates.
2. **Post-Game Reveal:**
   - Operator actions and scan histories are preserved in `events` for post-game recap and replay analysis.

---

## 5. Proposed Decisions for Alignment

| # | Decision | Options & Recommendation |
| :- | :------- | :----------------------- |
| **D18** | **Operator Designation Flow** | **Recommendation (Option A):** Any player can toggle `is_remote` in the lobby, with a server limit of 1 remote operator per team. Host can override/assign.<br>*Alternative (Option B):* Only the host designates operators in lobby settings. |
| **D19** | **Runner Scan Fuzzing** | **Recommendation (Option A):** Return a fuzzed center point ($\pm 30\text{ m}$ seeded hash) with 150m radius envelope.<br>*Alternative (Option B):* Return exact hunter coordinates (Not recommended: violates "never reward wallhacks"). |
| **D20** | **Hunter Scan Boundary Constraint** | **Recommendation (Option A):** Hunter scan target must fall strictly within the play area circle or rectangle.<br>*Alternative (Option B):* Allow scanning anywhere within $1.5\times$ area radius. |

---

## 6. Acceptance Criteria

- [x] Schema: `players.is_remote` column, `role_catalogue` updated with `'operator'` role add-on.
- [x] Lobby RPC: `set_player_remote` limits to 1 operator per team.
- [x] Ready check: remote players can ready up without GPS lock or boundary validation.
- [x] Immunity: `attempt_tag` cannot target a remote player.
- [x] Scan: Runner scan returns a 150m vague envelope around nearest hunter.
- [x] Scan: Hunter scan returns a player count within 200m of target point (no coordinates).
- [x] Cooldown: 90s cooldown strictly enforced per operator.
- [x] Markers: `place_marker` creates 90s ephemeral marker visible only to teammates.
- [x] Test suites: `npm run typecheck`, `npm run lint`, `npm run rls`, and `npm run sim operator` all pass.
