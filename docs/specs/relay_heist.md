# Mode Specification: Relay Heist (`relay_heist`)

**Mode ID:** `relay_heist`  
**Classification:** Base Mode (Objective courier escort and physical relay)  
**Spec Reference:** [`docs/MODES.md` §4.5](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/MODES.md#L484-L500)  
**Current Implementation Status:** Implemented in migrations `20261111000000_b3_relay_heist_schema.sql`–`20261111012000`, `20261118006000_r3_fix_canonical_game_state.sql`. Requires verification, gap rectification, and user sign-off.

---

## 1. Exact Rules as Specified in `MODES.md` §4.5

1. **Premise:** A virtual high-value package must travel from the start zone to an extraction zone. Runners must physically carry and hand off the package to keep it safe; a tagged carrier drops the package, creating an open scramble between runners recovering it and hunters securing it.
2. **Player Count:** Minimum 5 players; ideal 8 or more players. Two teams: Runners and Hunters.
3. **Carrier Designation & Burden:**
   - At match launch (`start_game`), the server randomly selects one active runner as the initial **Carrier**.
   - A package entity (`kind = 'package'`) is spawned and bound to the carrier.
   - **Carrier Noise ($1.5\times$ Frequency):** The carrier is louder than regular runners, emitting delayed radar pings at $1.5\times$ standard frequency (`floor(ping_interval_s / 1.5)`).
   - **Item Restrictions:** The carrier cannot claim Dead Drop items or activate veil/speed abilities while holding the package.
4. **Physical Handoff Mechanics:**
   - Two active runners within **$5\text{ m}$** of each other must execute a mutual confirmation:
     - Carrier calls `request_handoff(p_game_id, p_target_player_id)`.
     - Target runner receives a $10\text{ s}$ prompt and calls `confirm_handoff(p_game_id)`.
   - On confirmation, the carrier role transfers to the target runner.
   - Both players enter a **$20\text{ s}$ handoff cooldown** to prevent rapid ping-pong exploitation.
5. **Tagging & Package Drop:**
   - If a hunter tags the carrier, the carrier is eliminated (`status = 'tagged'`).
   - The package immediately **drops** at the carrier's last known coordinates (`status = 'dropped'`).
   - The dropped package becomes **publicly visible to all players** on the map (`visible_to = 'all'`).
   - An alert (`package_dropped`) is broadcast to all participants.
6. **Recovery vs Securing (The Drop Contest):**
   - **Runner Recovery (Pickup):** Any active runner within **$10\text{ m}$** of the dropped package can call `pickup_package(p_game_id)`. The package returns to `'carried'` status and becomes hidden from hunters again (`visible_to = 'runner'`).
   - **Hunter Securing (Objective Capture):** A hunter within **$10\text{ m}$** of the dropped package calls `start_securing_package(p_game_id)` and must maintain position within $10\text{ m}$ for **$20\text{ s}$**. Upon completing the hold, calling `complete_secure_package(p_game_id)` terminates the round with **Hunters Victory** (`end_reason = 'package_secured'`).
7. **Extraction & Victory Conditions:**
   - **Runners Victory:** Package carrier enters within $25\text{ m}$ of the Extraction Zone (`end_reason = 'extraction_complete'`).
   - **Hunters Victory:**
     - Hunters secure the dropped package after a $20\text{ s}$ hold (`end_reason = 'package_secured'`).
     - All runners are tagged out (`end_reason = 'all_tagged'`).
     - Match timer expires before package extraction (`end_reason = 'time_expired'`).
8. **Edge Cases in Spec:**
   - Disconnect / dead battery carrier: Package auto-drops after $60\text{ s}$ offline.
   - Handoff spam: $20\text{ s}$ cooldown per player.
   - Simultaneous pickup: Postgres row lock resolves tie by server commit time.

---

## 2. Implementation in Code and Migrations

### A. Database Migrations & Tables
- **Enum Additions:** `game_mode` includes `'relay_heist'`.
- **`public.entities` Table Usage:**
  - `kind = 'package'`:
    - `visible_to`: `'runner'` while carried; `'all'` while dropped.
    - `state`:
      ```json
      {
        "status": "carried" | "dropped" | "secured",
        "carrier_player_id": "uuid | null",
        "dropped_at": "timestamptz | null",
        "handoff_pending_to": "uuid | null",
        "handoff_expires_at": "timestamptz | null",
        "cooldown_until": "timestamptz | null",
        "securing_hunter_id": "uuid | null",
        "securing_started_at": "timestamptz | null",
        "next_carrier_ping_at": "timestamptz | null"
      }
      ```
  - `kind = 'extraction'`:
    - `visible_to`: `'all'`.
    - `state`: `{ "radius_m": 25 }`.
- **`public.mode_catalogue()`:**
  - Registers `relay_heist` with teams `['runner', 'hunter']`, `min_players: 3`, compatible roles: `['operator']`, compatible modifiers: `['noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone']`.
  - Parameters: `extraction_radius_m: 25`, `handoff_radius_m: 5`, `handoff_hold_s: 10`, `handoff_cooldown_s: 20`, `pickup_radius_m: 10`, `securing_hold_s: 20`, `carrier_ping_multiplier: 1.5`, `offline_drop_s: 60`.

### B. Security Definer RPCs
- `set_extraction_location(p_game_id, p_lat, p_lng, p_radius_m)`: Host-only setup RPC in lobby; validates coordinates are strictly within arena boundary.
- `request_handoff(p_game_id, p_target_player_id)`: Carrier-only; validates target is active runner within $5\text{ m} + \min(5, \text{acc})$, sets $10\text{ s}$ pending handoff.
- `confirm_handoff(p_game_id)`: Target runner confirms within $10\text{ s}$ while within $5\text{ m}$; swaps carrier and applies $20\text{ s}$ cooldown.
- `pickup_package(p_game_id)`: Active runner within $10\text{ m}$ of dropped package claims carrier role; resets `visible_to = 'runner'`.
- `start_securing_package(p_game_id)`: Hunter within $10\text{ m}$ of dropped package initiates $20\text{ s}$ securing hold.
- `complete_secure_package(p_game_id)`: Hunter validates $20\text{ s}$ hold completion within $10\text{ m}$; ends game (`package_secured`).
- `cancel_securing_package(p_game_id)`: Cancels active securing hold.

### C. Live Position & Lifecycle Checks
- `submit_position(game_id, ...)`: When live in `relay_heist`, if caller is runner carrier and fix falls within extraction zone radius ($25\text{ m}$), ends game immediately with `runners` win (`extraction_complete`).
- `apply_tag(p_game_id, ...)`: When live in `relay_heist`, if tagged runner is the carrier, immediately drops package at carrier coordinates, sets `visible_to = 'all'`, and emits `package_dropped`.

---

## 3. Discrepancies and Gap Analysis

| ID | Category | Spec Requirement (`MODES.md` §4.5) | Current Implementation | Impact & Severity |
|:---|:---|:---|:---|:---|
| **X-7** | **Schema Regression** | `get_game_state` must return root `relay_heist` payload. | Omitted in migration 141; restored locally in migration 146 (`20261118006000_r3_fix_canonical_game_state.sql`), pending deployment. | **HIGH (Pending remote deploy)**: Client HUD fails to render carrier HUD or extraction objective without migration 146. |
| **X-9** | **Lifecycle Regression in `advance_game`** | Carrier offline for $> 60\text{ s}$ auto-drops package; carrier emits radar pings at $1.5\times$ frequency. | Replaced in migrations 120 through 147; the canonical `advance_game` currently omits both the 60 s offline auto-drop loop and the 1.5x carrier radar ping loop. | **HIGH**: An offline or disconnected carrier deadlocks the match. Carrier emits pings at 1.0x rate instead of 1.5x rate. |
| **X-10** | **Secrecy / RLS Review** | Carried package must be hidden from hunters; dropped package visible to all. | Stored in `entities` with `visible_to = 'runner'` when carried, and `'all'` when dropped. RLS policy on `entities` filters by `visible_to`. Untested: direct query by hunter on carried package. | **MEDIUM**: Must verify negative test confirming hunter receives 0 rows on direct `entities` select while package is carried. |
| **X-11** | **Rules / Player Count** | Minimum 5 players (3 runners, 2 hunters); 8+ ideal. | Catalogue and code allow starting with 3 players (2 runners, 1 hunter). | **LOW**: Playable with 3 players for testing, but tactical multi-carrier relays require $\ge 5$ players. Show advisory in UI for $< 5$ players. |
| **X-12** | **Safety / Site Placement** | Extraction zone placement should be safe from traffic and physical hazards. | Boundary check enforces within arena circle, but does not verify road buffers. | **MEDIUM**: Physical sprinting towards extraction requires $\ge 50\text{ m}$ safety buffer from roads and water bodies. |

---

## 4. Parameters and Defaults

| Parameter | Type | Default | Allowable Range | Purpose |
|:---|:---|:---|:---|:---|
| `extraction_radius_m` | integer | `25` | 10–50 m | Radius of extraction arrival zone. |
| `handoff_radius_m` | integer | `5` | 3–15 m | Maximum distance between runners for handoff. |
| `handoff_hold_s` | integer | `10` | 5–30 s | Mutual confirmation window for handoff prompt. |
| `handoff_cooldown_s` | integer | `20` | 10–60 s | Cooldown before a player can participate in another handoff. |
| `pickup_radius_m` | integer | `10` | 5–25 m | Maximum distance to recover a dropped package. |
| `securing_hold_s` | integer | `20` | 10–60 s | Continuous hold duration required for hunters to secure package. |
| `carrier_ping_multiplier` | float | `1.5` | 1.0–3.0x | Frequency acceleration for carrier radar pings. |
| `offline_drop_s` | integer | `60` | 30–180 s | Grace period before disconnected carrier drops package. |
| `min_players` | integer | `3` (code) / `5` (spec) | 3–32 | Minimum active players required to start. |

---

## 5. Concurrency, Races, and Edge Cases

1. **Simultaneous Pickup Race:**
   - Two runners reach dropped package at the same instant.
   - Handled via `select * into pkg_rec from public.entities where kind = 'package' for update`.
   - First transaction to commit acquires carrier role (`status = 'carried'`); second transaction sees `status <> 'dropped'` and aborts cleanly (`package_not_dropped`).
2. **Hunter Securing vs Runner Recovery:**
   - Hunter begins $20\text{ s}$ securing hold; runner dashes in at second 18 and calls `pickup_package`.
   - Runner's pickup acquires row lock, transitions package to `'carried'`, clearing `securing_hunter_id`.
   - When hunter calls `complete_secure_package`, status is `'carried'`, aborting with `package_not_dropped`.
3. **Carrier Tagged at Extraction Boundary:**
   - Carrier steps into extraction zone at the exact second a hunter presses TAG.
   - Row-level lock on `public.games` in `end_game` serializes the resolution.
   - If `submit_position` commits first, round ends with `runners` victory (`extraction_complete`).
   - If `attempt_tag` commits first, carrier is tagged, package drops, and game remains live.
4. **Carrier Disconnect / Crash:**
   - Disconnected carrier provides no fixes.
   - `advance_game` checks `recorded_at < now() - interval '60 seconds'`, auto-drops package, transitions `visible_to = 'all'`, and emits `package_dropped`.

---

## 6. Secrecy, RLS, and Data Access Review

1. **Package Entity Secrecy:**
   - While carried, `entities.visible_to = 'runner'`.
   - RLS policy `entities_select` enforces team visibility:
     - Runners receive package coordinates and carrier ID.
     - Hunters querying `entities` table receive **0 rows**.
     - Outsiders receive **0 rows**.
2. **Dropped Package Revelation:**
   - When dropped on tag or disconnect, `visible_to` updates to `'all'`.
   - Both teams receive live coordinates of the dropped beacon.
   - When recovered by a runner, `visible_to` returns to `'runner'`.
3. **Handoff Coordination Privacy:**
   - Handoff events (`handoff_requested`, `package_handed_off`) are sent with `audience = 'runner'`.
   - Hunters are not notified of handoffs, preventing hunters from camping handoff pairs.

---

## 7. Environmental and Physical Safety Considerations

1. **Physical Handoff Sprinting:**
   - Handoff requires two runners within 5 m. In high-stakes play, players may sprint blindly towards each other.
   - **Risk:** Collision between teammates.
   - **Safety Requirement:** No physical contact required; handoff occurs over wireless network via UI button within 5 m.
2. **Extraction Corridor Ambush:**
   - Hunters patrolling extraction points may concentrate near physical chokepoints.
   - **Safety Requirement:** Host must position extraction points in open plazas or wide park fields, never near roads, parking lots, or stairways.
3. **Emergency SOS & Pause:**
   - Universal in-game SOS button immediately pauses match and notifies all participants.

---

## 8. Abuse and Griefing Vectors

1. **Carrier Camping in Hidden Inaccessible Location:**
   - A carrier hides in private property or behind locked gates.
   - *Mitigation:* Arena boundaries restricted to public parks; 1.5x radar ping cadence leaks carrier coordinates regularly to hunters.
2. **Rapid Handoff Ping-Ponging:**
   - Two runners rapidly swapping package back and forth to evade tagging.
   - *Mitigation:* Mandatory $20\text{ s}$ handoff cooldown per player.
3. **Carrier Rage-Quit:**
   - Carrier leaves game or turns off phone when cornered.
   - *Mitigation:* Server auto-drops package after 60 s offline.

---

## 9. Comprehensive Test Plan

### A. Unit Tests
- Cooldown calculations: verify 20 s handoff cooldown and 10 s pickup cooldown.
- Extraction distance validation: verify distance calculation using haversine formula against extraction zone radius.

### B. Simulator Tests (`scripts/sim/index.ts`)
- `relay-heist` scenario ([lines 1999–2240](file:///c:/ASK_Main/ASK/Projects/GhostRun/scripts/sim/index.ts#L1999-L2240)):
  - Setup with host, runner 2, and hunter.
  - Placement of extraction point within boundary.
  - Carrier designation on match start.
  - Handoff request and confirm within 5 m.
  - Tag carrier -> verify package drop and public beacon reveal.
  - Hunter securing hold (20 s) test.
  - Runner recovery (pickup) test.
  - Extraction arrival -> runner victory (`extraction_complete`).

### C. Access Control & RLS Tests (`scripts/rls-check.ts`)
- Hunter cannot query carried package from `entities` table (RLS secrecy).
- Outsider cannot read `entities` table or call handoff RPCs.
- Hunter cannot call `request_handoff` or `pickup_package`.
- Runner cannot call `start_securing_package`.
- Extraction placement outside boundary is rejected.

### D. Physical Device Verification (`docs/PLAYTEST.md`)
- **Handoff Usability at 5m:** Test mutual UI button prompt outdoor at 3–5 m range with GPS jitter.
- **Beacon Visibility:** Confirm dropped package blip renders distinctly on live map for both teams.
- **Audio/Haptics:** Verify distinctive audio cue on package drop, pickup, and securing countdown.
- **Site Safety Check:** Confirm extraction point verified $\ge 50\text{ m}$ away from roads and physical hazards.
- **SOS Interruption:** Verify pressing SOS pauses match and releases all holds immediately.
