# Territory Pulse Base Mode Specification (VM1 Verified)

> **Document Status:** Complete & Verified (`VM1: Spec check`)  
> **Target Mode:** `territory_pulse` (Territory Pulse Base Mode)  
> **Layer:** Base Mode (docs/MODES.md §4.6)  
> **Source Specification:** [`docs/MODES.md` §4.6](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/MODES.md#L503-L527), [`supabase/migrations/20261116001000_b8_territory_pulse_lifecycle.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261116001000_b8_territory_pulse_lifecycle.sql), and [`supabase/migrations/20261116002000_b8_territory_pulse_tag.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261116002000_b8_territory_pulse_tag.sql)  
> **Effort Estimate:** S–M (0.5 day for VM2 fixes)  

---

## 1. Executive Forensic Summary: Dispelling the Discrepancies

The verification protocol raised Question Q4:
> *"Territory Pulse: 7 radial sectors vs hex zones. Code implements 7 radial sectors with 2 consecutive pulses to capture, 70% dominance win."*

### Forensic Determination:
1. **Geometry — 7 Radial Circular Sectors vs Polygon Hex Mesh:**
   - **What is built:** [`spawn_territory_zones`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261116001000_b8_territory_pulse_lifecycle.sql#L98-L165) creates **7 discrete circular sector entities** (`entities.kind = 'zone'`):
     - **Sector 0 (Sector Core):** Positioned at `games.area_center`.
     - **Sectors 1–6 (Alpha, Bravo, Charlie, Delta, Echo, Foxtrot):** Spaced around an outer radial ring at distance $R_{\text{ring}} = R_{\text{area}} \times 0.55$, placed at $60^\circ$ angular increments ($0^\circ, 60^\circ, 120^\circ, 180^\circ, 240^\circ, 300^\circ$).
     - **Zone Radius:** $R_{\text{zone}} = \min(80.0, \max(35.0, R_{\text{area}} \times 0.20))\text{ metres}$.
   - **Architectural Reality:** The code does **NOT** build a continuous polygonal hexagon tile mesh (no Uber H3 or PostGIS `ST_HexagonGrid`). It creates a **hexagonal constellation of 7 discrete circular sectors**. This provides clear, unambiguous GPS capture perimeters on mobile devices, preventing border jitter and boundary computation overhead during outdoor running.
2. **Synchronous Pulse & Two-Pulse Flip Mechanism:**
   - Zones are evaluated strictly at discrete **pulse moments** (`clock_timestamp() >= next_pulse_at`, default interval 90 s, configurable down to 2 s for desk testing).
   - Active, non-remote, non-incapacitated players with fresh GPS fixes ($\le 45\text{ s}$) inside sector boundaries (`st_dwithin`) are tallied for each team.
   - **Neutral Capture:** Strict majority ($N_{\text{runner}} > N_{\text{hunter}}$ or $N_{\text{hunter}} > N_{\text{runner}}$) captures a neutral sector on the **first pulse**.
   - **Hostile Flip (Two Consecutive Pulses):** Flipping an opponent-controlled sector requires maintaining majority across **2 consecutive pulses** (`contender = opponent`, `contender_pulses = 2`). Defending an owned sector clears any active contender (`contender = null`, `contender_pulses = 0`).
   - **Scoring:** Controlling a sector awards **+1 point per pulse** to the controlling team.
3. **Contest Tagging & Runner Incapacitation:**
   - In Territory Pulse, hunter tags **do not eliminate runners**.
   - When a hunter tags a runner, [`apply_tag`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261116002000_b8_territory_pulse_tag.sql#L171-L185) applies a **60-second incapacitation timer** (`status_detail->'incapacitated_until' = now() + interval '60 seconds'`) and emits event `contest_tag`.
   - Incapacitated runners remain active on the field and visible on the map, but are **excluded from zone majority tallies** during pulse evaluations until their incapacitation expires.
4. **Victory Conditions:**
   - **Dominance Victory:** Controlling $\ge 70\%$ of sectors ($\ge 5$ of 7 sectors) across **2 consecutive pulses**, or capturing **all 7 sectors** immediately (`end_reason = 'territory_dominance'`).
   - **Points Victory on Timeout:** When game timer expires (`clock_timestamp() >= ends_at`), the team with strictly higher points wins (`end_reason = 'points_victory'`); equal points result in a draw (`end_reason = 'draw'`).
5. **Critical Regression Discovered (Discrepancy X-21):**
   - In local migrations 146 and 153, the `advance_game` pulse loop contained a truncated simplification checking `ghost_rec.state->>'owner_team'` instead of the canonical `controller`/`contender`/`contender_pulses` keys. This caused `get_game_state` to return `controller = null` for all sectors, breaking client sector colors and two-pulse flip logic. This will be restored to the canonical Milestone B8 implementation in VM2.

---

## 2. Rules Comparison: MODES.md §4.6 vs Implementation

| Rule Aspect | MODES.md §4.6 Specification | Implemented Behaviour | Status / Difference ID | Resolution Recommendation |
|---|---|---|---|---|
| **Pitch & Players** | 7 tessellated sectors, synchronous pulse updates. 2 min, 8–16 recommended. | Implemented: `min_players = 2`. Runners vs Hunters. Compatible with Operator remote role. | Matching | **Keep as implemented** |
| **Zone Layout & Geometry** | 7 sectors: Core + 6 radial (Alpha–Foxtrot). Zone radius 35–80m, ring at $0.55 \times R_{\text{area}}$. | Implemented: 7 circular entities (`kind = 'zone'`). Core at center, 6 outer at $60^\circ$ offsets on ring $0.55 \times R_{\text{area}}$. Zone radius $\min(80, \max(35, R_{\text{area}} \times 0.20))$. Circular discs, not polygon hex tiles. | **X-8 (Clarified)** | **Keep as implemented** (circular zones provide superior mobile GPS ergonomics and prevent edge flicker) |
| **Pulse Cadence & Evaluation** | Evaluated server-side at pulse ticks (default 90s). Non-incapacitated players with fresh GPS ($\le 45\text{ s}$) inside zone counted. | Implemented: evaluated in `advance_game` when `clock_timestamp() >= next_pulse_at`. Filters out remote operators, stale fixes ($> 45\text{ s}$), and incapacitated players (`incapacitated_until > clock_timestamp()`). | Matching | **Keep as implemented** |
| **Two-Pulse Flip Mechanism** | Neutral captured immediately. Flipping opponent sector requires 2 consecutive pulses of majority. | Canonical B8 migration `20261116001000` implemented `controller`, `contender`, and `contender_pulses`. However, local recovery migrations 146/153 regressed this loop with a simplified `owner_team` snippet. | **X-21 (Critical Regression)** | **Fix in VM2:** Restore canonical B8 pulse loop in `advance_game` so `controller`, `contender`, and `contender_pulses` are updated and emitted. |
| **Scoring & Point Accrual** | +1 point per pulse for each controlled sector. | Implemented: `v_r_score` and `v_h_score` incremented by number of controlled sectors at each pulse tick. | Matching | **Keep as implemented** |
| **Contest Tagging** | Tags do not eliminate runners; 60s incapacitation excludes them from zone majority. | Implemented in `apply_tag`: sets `status_detail->'incapacitated_until' = now() + interval '60 seconds'`. Does not set `status = 'tagged'`. Zone counting query checks `incapacitated_until`. | Matching | **Keep as implemented** |
| **Dominance Victory** | $\ge 70\%$ of sectors ($\ge 5$ of 7) across 2 consecutive pulses, or all 7 immediately. | Implemented: checks `v_r_controlled >= 5` or `v_h_controlled >= 5`. 2 consecutive pulses triggers `end_game(winner, 'territory_dominance')`. Full 7 control triggers immediate win. | Matching | **Keep as implemented** |
| **Points Victory on Timeout** | Higher score wins upon duration expiration; equal is draw. | Implemented in `advance_game` timeout branch: `points_victory` for leader, `draw` if tied. | Matching | **Keep as implemented** |

---

## 3. Code & Migrations Inventory

### Database Migrations
- [`supabase/migrations/20261116000000_b8_territory_pulse_enum.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261116000000_b8_territory_pulse_enum.sql): Adds `'territory_pulse'` to `public.game_mode` enum.
- [`supabase/migrations/20261116001000_b8_territory_pulse_lifecycle.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261116001000_b8_territory_pulse_lifecycle.sql): Registers mode in `mode_catalogue()`; creates `spawn_territory_zones`; adds pulse loop and dominance checks in `advance_game`; adds `territory_pulse` snapshot in `get_game_state`.
- [`supabase/migrations/20261116002000_b8_territory_pulse_tag.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261116002000_b8_territory_pulse_tag.sql): Adds contest tag support to `apply_tag` and `attempt_tag` (60 s incapacitation instead of elimination).
- [`supabase/migrations/20261116003000_b8_territory_pulse_constraint.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261116003000_b8_territory_pulse_constraint.sql): Adds entity kind check constraints for `'zone'`.
- [`supabase/migrations/20261116004000_b8_fix_get_game_state_color.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261116004000_b8_fix_get_game_state_color.sql): Corrects player color casts and entity state retrieval in `get_game_state`.

### Server RPCs
- `public.spawn_territory_zones(p_game_id uuid)`: Spawns 7 sector entities (`kind = 'zone'`) with geometric positions, zone indices, names, and radii.
- `public.apply_tag(p_game_id, p_hunter_id, p_runner_id, p_distance_m)`: Applies contest tag (60 s incapacitation) when `mode_id = 'territory_pulse'`.
- `public.advance_game(game_id uuid)`: Evaluates synchronous pulse ticks, tallies active player presence, applies 2-pulse flip logic, increments scores, and checks dominance/timeout conditions.
- `public.get_game_state(game_id uuid)`: Returns `territory_pulse` payload with `pulse_seq`, `pulse_interval_s`, `next_pulse_at`, `scores`, and array of `zones` with `controller`, `contender`, and `contender_pulses`.

### Client UI Components
- [`app/create.tsx` lines 375–395](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/create.tsx#L375-L395): Territory Pulse mode card with 7-sector layout description.
- [`app/game/[id].tsx` lines 1465–1535, 2235–2250, 3430–3470](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/game/[id].tsx):
  - Renders 7 colored territory rings on map with dashed borders: neutral (`#94A3B8`), runner-controlled (`#06B6D4`), hunter-controlled (`#EF4444`).
  - Top HUD shows pulse countdown timer, real-time score tracker, and current sector occupancy chip.
  - Bottom sheet displays 7-sector operational card with controller badge, contender status, and coordinates.
- [`app/result/[id].tsx` lines 1020–1060](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/result/[id].tsx#L1020-L1060): Territory Pulse Debrief card showing final scores, dominance metrics, and sector control distribution.

---

## 4. Parameters, Defaults, and Ranges

| Parameter | Default | Range / Constraints | Defined In | Description |
|---|---|---|---|---|
| `pulse_interval_s` | `90` | 15–300 s (default 90 s, configurable down to 2 s for testing) | `games.mode_params` | Elapsed time between synchronous territory ownership evaluation ticks. |
| `zone_radius_m` | Procedural | $\min(80.0, \max(35.0, R_{\text{area}} \times 0.20))$ | `spawn_territory_zones` | Capture radius around each of the 7 sector centers. |
| `ring_distance_m` | Procedural | $R_{\text{area}} \times 0.55$ | `spawn_territory_zones` | Radial offset distance from area center for the 6 outer sectors (Alpha–Foxtrot). |
| `zone_count` | `7` | Fixed at 7 sectors | `spawn_territory_zones` | 1 center Sector Core + 6 outer radial sectors at $60^\circ$ increments. |
| `dominance_threshold` | `0.70` | Fixed at 70% ($\ge 5$ of 7 sectors) | `advance_game` | Proportion of sectors required to be held to trigger dominance streak. |
| `consecutive_dominance` | `2` | Strictly 2 consecutive pulses | `advance_game` | Number of consecutive pulses a team must hold $\ge 70\%$ of sectors to win immediately. |
| `flip_pulses_needed` | `2` | Strictly 2 consecutive pulses | `advance_game` | Number of consecutive pulses a contender team must maintain majority to flip an owned sector. |
| `incapacitated_seconds`| `60` | Fixed at 60 s | `apply_tag` | Duration a runner is excluded from sector presence tallies following a hunter contest tag. |
| `fresh_fix_threshold_s`| `45` | Fixed at 45 s | `advance_game` | Maximum age of GPS fix allowed to count toward sector occupancy at pulse tick. |
| `min_players` | `2` | $\ge 2$ players (recommended 8–16) | `mode_catalogue()` | Minimum players required to launch a Territory Pulse match. |

---

## 5. Concurrency, Races, and Failure Modes

1. **Tag During Pulse Tick:**
   - A hunter executes `apply_tag` on a runner at the exact moment `advance_game` fires a pulse.
   - **Protection:** `apply_tag` updates `status_detail->'incapacitated_until'`. In `advance_game`, the query checks `(p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= clock_timestamp())`. Both operations execute under row-level PostgreSQL transactions.
2. **Simultaneous Boundary Crossing:**
   - A player runs across the perimeter of a sector precisely as a pulse occurs.
   - **Protection:** Presence is evaluated server-side at the moment `advance_game` runs using the player's most recent valid GPS fix ($\le 45\text{ s}$ old) via PostGIS `st_dwithin(pp.geog, zone_rec.geog, radius_m)`.
3. **Contender Flip Interruption:**
   - Team A owns a sector. Team B establishes majority at Pulse 1 (`contender = B`, `contender_pulses = 1`). At Pulse 2, Team A re-establishes majority or ties.
   - **Protection:** Handled cleanly: if `v_prevailing = v_ctrl` or tie, `contender` resets to `null` and `contender_pulses` resets to `0`. Team B must restart the 2-pulse requirement from scratch.
4. **Draw Resolution:**
   - When game timer expires, both teams have identical point totals.
   - **Protection:** Handled in `advance_game` timeout branch: calls `end_game(current_game.id, null, 'draw')` and records `end_reason = 'draw'`.

---

## 6. Physical Device & Playtest Verification Checklist

- [ ] **Daylight Visibility of Sector Rings:** Verify that cyan (`#06B6D4`), red (`#EF4444`), and neutral grey (`#94A3B8`) dashed territory rings and icons are clearly visible outdoors under intense direct sunlight.
- [ ] **Occupancy Chip Latency:** Verify top HUD chip transitions promptly to "Inside Sector [Name] ([STATUS])" when physically walking across the sector perimeter.
- [ ] **Pulse Haptic Alert:** Verify distinct tactile haptic vibration fires upon every synchronous pulse tick to inform players of territory updates without screen gazing.
- [ ] **Contest Tag Tactile Feedback:** Verify runner receives distinctive 60-second incapacitation haptic buzz and yellow alert banner upon being tagged inside a contest zone.
- [ ] **SOS Emergency Interruption:** Verify triggering SOS pauses match timers, freezes pulse evaluation, and broadcasts emergency coordinates to all players.
