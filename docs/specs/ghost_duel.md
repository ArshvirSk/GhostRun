# Solo Ghost Duel Base Mode Specification (VM1 Verified)

> **Document Status:** Complete & Verified (`VM1: Spec check`)  
> **Target Mode:** `ghost_duel` (Solo Ghost Duel Base Mode)  
> **Layer:** Base Mode (docs/MODES.md §4.4, §6.2)  
> **Source Specification:** [`docs/MODES.md` §6.2](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/MODES.md#L608-L635), [`docs/DECISIONS.md` D21–D24](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/DECISIONS.md#L365-L395), and [`supabase/migrations/20261114000000_b6_ghost_duel_schema.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261114000000_b6_ghost_duel_schema.sql)  
> **Effort Estimate:** S–M (0.5 day for VM2 fixes)  

---

## 1. Executive Forensic Summary: Dispelling the Discrepancies

The verification protocol raised two specific questions regarding Ghost Duel:

### Question 1: Does Ghost Duel use NPC simulation or recorded trail replay?
- **Forensic Finding:** **Ghost Duel uses recorded player trail replay, NOT autonomous AI/NPC simulation.**
- **Trail Extraction & Simplification:**
  - Opted-in players who grant Consent C4 (`ghost` consent) contribute their completed game trails via [`contribute_ghost`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261107000000_v2m7_ghost_library.sql#L155-L235).
  - The trail is extracted from `trail_points`, trimmed by 150 m from both the start and end to protect home/work locations ([`20261107000000_v2m7_ghost_library.sql#L131-L134`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261107000000_v2m7_ghost_library.sql#L131-L134)), and simplified using Douglas-Peucker reduction (`st_simplify(trimmed_geom, 0.00008)` ~8–9 m spatial tolerance) before storage in `public.ghost_library`.
- **Runtime Movement:**
  - Ghost entity movement is calculated in [`advance_game`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261118010000_vm2_vip_escort_advance_and_submit.sql#L463-L474) purely via PostGIS spatial interpolation: `st_lineinterpolatepoint(patrol_geom, loop_frac)` where `loop_frac = least(1.0, elapsed_s / duration_s)`.
  - There is **zero AI**, **zero neural network / LLM logic**, **zero pathfinding heuristic**, and **zero dynamic obstacle avoidance**.
- **Synthetic Fallback:**
  - If `public.ghost_library` contains no recorded routes within `area_radius_m + 500 m`, [`spawn_ghost_npcs`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261114001000_b6_ghost_duel_lifecycle.sql#L162-L191) falls back to [`generate_synthetic_patrol_path`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261107001000_v2m7_npc_engine.sql#L68-L101), which generates a deterministic 8-point geometric circle at $0.55 \times R_{\text{area}}$. Movement along this circular geometry still uses linear `st_lineinterpolatepoint`.

### Question 2: Should leaderboards be kept or hidden until user reporting/blocking exists?
- **Forensic Finding:** GhostRun currently has **zero user reporting mechanisms** (`report_user` does not exist; only `report_drop` exists for unsafe physical objects) and **zero user blocking capabilities** (`block_user` does not exist).
- **Privacy Protections Built:**
  - [`get_ghost_duel_leaderboard`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261114000000_b6_ghost_duel_schema.sql#L40-L107) enforces **Consent C5** (`leaderboard_name` consent): if ungranted, display names mask to `'Anonymous Runner'`.
  - Results are geographically localized to within 5 km of the game center (`st_dwithin(gds.area_center, ..., radius_m)` with default 5000 m) and capped at top 5 rows (`row_limit: 5`).
- **Safety Risk:**
  - Without user blocking, reporting, profanity filtering, or a temporal delay (e.g., 6 hours), public ranking could expose a solo runner's activity patterns or surface offensive display names in local parks.
- **Architectural Decision for VM2/VM3:**
  - **Preserve Personal Debrief:** The player's personal performance card (`ghostScore`: player time, ghost time, split delta, route efficiency, and score) is fully functional and safe.
  - **Hide Public Ranking in UI:** To prevent real-time location stalking and abuse without reporting/blocking tools, the public Top 5 leaderboard rendering in [`app/result/[id].tsx`](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/result/[id].tsx#L997-L1015) should be hidden or gated behind an administrative moderation flag until user reporting and blocking are implemented in Phase D.

---

## 2. Rules Comparison: MODES.md §6.2 vs Implementation

| Rule Aspect | MODES.md §6.2 Specification | Implemented Behaviour | Status / Difference ID | Resolution Recommendation |
|---|---|---|---|---|
| **Pitch & Solo Play** | Play alone, anytime. Race or evade the recording of a friend's earlier run. | Implemented: `min_players = 1`. Lobby allows solo start with 1 player. | Matching | **Keep as implemented** |
| **Variant: Time Trial** | Reach a target, beating a ghost runner's recorded time. Score = time diff + efficiency. | Runner races ghost runner to Finish Target entity (`radius_m = 20`). Reaching target triggers `ghost_duel_finish` event and `end_game('runners', 'ghost_beaten')` if faster, or `end_game('hunters', 'ghost_won')` if slower. Score: $\max(100, 1000 + \Delta t \times 10 + \text{efficiency} \times 200)$. | Matching | **Keep as implemented** |
| **Variant: Evade** | Reach target without entering a 20 m radius of a ghost hunter route. | Runner navigates to Finish Target entity. `submit_position` checks distance to ghost entity: if $\le 20\text{ m}$, player is instantly haunted (`end_game('hunters', 'haunted')`). If target reached without collision, runner wins (`end_game('runners', 'evaded')`). | Matching | **Keep as implemented** |
| **Variant: Mirror Chase** | Ghost is runner, player is hunter. Get within tag radius at any point of their replay. | Player is hunter; ghost entity is runner. Player must approach within $\le 10\text{ m}$ of ghost entity and execute `tag_ghost(game_id)`. Hunter win: `end_game('hunters', 'ghost_tagged')`. If ghost reaches path end first, ghost escapes: `end_game('runners', 'ghost_escaped')`. | Matching | **Keep as implemented** |
| **Ghost Stepping in `advance_game`** | Server steps ghost entity along path by elapsed time. | In migration 150 (`20261118010000`), ghost stepping ran for `current_game.mode_id in ('haunted_map', 'ghost_duel')`. In migration 152 (`20261118012000`), line 574 regressed to `(current_game.mode_id = 'haunted_map' or current_game.ghost_mode)`. | **X-19 (Critical Regression)** | **Fix in VM2:** Restore `current_game.mode_id in ('haunted_map', 'ghost_duel')` so ghost entities update every tick. |
| **Lobby Team Assignment** | Solo player auto-assigned based on variant (runner for time_trial/evade, hunter for mirror_chase). | Handled in `start_game`, but only updates `where players.team = 'unassigned'`. If player manually tapped another team in lobby, role mismatch could occur. | **X-20 (Minor Edge Case)** | **Fix in VM2:** In `start_game`, unconditionally enforce team assignment based on variant for `ghost_duel`. |
| **Leaderboard Scoping & Moderation** | Local leaderboards per area; names shown only with consent C5. | `get_ghost_duel_leaderboard` filters within 5 km radius, checks C5 consent (`leaderboard_name`), masks unconsented users to `'Anonymous Runner'`. Lacks user reporting, blocking, and 6-hour delay. | **X-17 (Safety / Moderation)** | **Address in VM2/VM3:** Hide public Top 5 ranking from results UI until reporting/blocking exists; maintain personal score debrief. |

---

## 3. Code & Migrations Inventory

### Database Migrations
- [`supabase/migrations/20261107000000_v2m7_ghost_library.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261107000000_v2m7_ghost_library.sql): Creates `public.ghost_library` and `public.ghost_contributions` tables with strict RLS; implements `preview_ghost` and `contribute_ghost` RPCs with 150 m privacy trimming and Douglas-Peucker simplification.
- [`supabase/migrations/20261107001000_v2m7_npc_engine.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261107001000_v2m7_npc_engine.sql): Implements `generate_synthetic_patrol_path` (deterministic 8-point circular path generator).
- [`supabase/migrations/20261114000000_b6_ghost_duel_schema.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261114000000_b6_ghost_duel_schema.sql): Creates `public.ghost_duel_scores` table with RLS; implements `get_ghost_duel_leaderboard` (C5 consent-aware) and `tag_ghost` RPCs.
- [`supabase/migrations/20261114001000_b6_ghost_duel_lifecycle.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261114001000_b6_ghost_duel_lifecycle.sql): Registers `ghost_duel` in `mode_catalogue()`; implements ghost and finish target spawning in `spawn_ghost_npcs`; adapts `start_game` for solo players.
- [`supabase/migrations/20261118010000_vm2_vip_escort_advance_and_submit.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261118010000_vm2_vip_escort_advance_and_submit.sql): Canonical `advance_game` and `submit_position` with ghost stepping and finish arrival evaluation.

### Server RPCs
- `public.spawn_ghost_npcs(p_game_id uuid)`: Spawns ghost entity (`kind = 'ghost'`) from `ghost_library` or synthetic generator; places finish target (`kind = 'target'`) at path endpoint.
- `public.tag_ghost(game_id uuid)`: Validates active hunter caller, checks $\le 10\text{ m}$ distance to ghost entity, records score in `ghost_duel_scores`, and ends game with `'ghost_tagged'`.
- `public.get_ghost_duel_leaderboard(lat, lng, radius_m, variant, row_limit)`: Queries top scores within radial geographic distance, masking unconsented player names.
- `public.preview_ghost(game_id uuid)`: Generates privacy-trimmed, simplified preview geometry of a completed run before contributing.
- `public.contribute_ghost(game_id uuid)`: Trims and saves trail to `ghost_library` under user consent C4.

### Client UI Components
- [`app/create.tsx` lines 340–370](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/create.tsx#L340-L370): Mode selection pill for `ghost_duel`; variant picker pills (`time_trial`, `evade`, `mirror_chase`).
- [`app/lobby/[id].tsx` lines 240–260](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/lobby/[id].tsx#L240-L260): Allows 1-player lobby ready up and start; displays variant badge and solo warning.
- [`app/game/[id].tsx` lines 1367–1372, 2103–2215, 3226–3240, 3385–3420](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/game/[id].tsx):
  - Renders cyan ghost blip on map with pulsing halo.
  - Renders emerald finish target ring on map (`radius_m = 20`).
  - HUD eyebrow and title displays active variant and distance to ghost or finish target.
  - Dock renders "TAG GHOST (10m)" button for hunter during `mirror_chase`.
- [`app/result/[id].tsx` lines 975–1015](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/result/[id].tsx#L975-L1015): Dedicated Solo Duel Debrief card showing route efficiency, split delta, and top 5 leaderboard.

---

## 4. Parameters, Defaults, and Ranges

| Parameter | Default | Range / Constraints | Defined In | Description |
|---|---|---|---|---|
| `head_start_s` | `0` | Hardcoded to 0 s | `app/create.tsx` | No head start delay is used in Ghost Duel. |
| `duration_s` | `300` | 180–1800 s | `games.duration_s` | Total round time limit. Ghost path duration is scaled if necessary. |
| `finish_target_radius_m` | `20` | Fixed at 20 m | `spawn_ghost_npcs` | Circular capture radius around the finish target entity. |
| `evade_collision_radius_m`| `20` | Fixed at 20 m | `submit_position` | Proximity radius causing the runner to become haunted by the ghost hunter. |
| `tag_ghost_radius_m` | `10` | Fixed at 10 m | `tag_ghost` | Maximum distance allowing the hunter to catch the ghost runner in `mirror_chase`. |
| `ghost_speed_mps` | `1.3` | Clamped to $\le 2.0\text{ m/s}$ | `ghost_rec.state` | Walking/jogging speed along interpolated patrol geometry. |
| `min_players` | `1` | Strictly 1 player | `mode_catalogue()` | Allows solo asynchronous match play. |
| `leaderboard_radius_m` | `5000` | 500–25000 m (default 5 km) | `get_ghost_duel_leaderboard` | Geographic radius around match center for local leaderboard aggregation. |
| `min_trail_length_m` | `600` | $\ge 600\text{ m}$ | `contribute_ghost` | Minimum raw trail distance required before 150 m start/end trimming is permitted. |

---

## 5. Concurrency, Races, and Failure Modes

1. **Missing Ghost in Library (Empty Cold Start):**
   - In a new city or park, `ghost_library` has zero recorded runs within 500 m of the boundary.
   - **Protection:** Handled automatically in `spawn_ghost_npcs` by calling `generate_synthetic_patrol_path`. Match proceeds seamlessly without error.
2. **Double Finish Submission:**
   - Client emits multiple rapid `submit_position` updates while inside the finish ring.
   - **Protection:** `submit_position` checks `current_game.status = 'live'`. The first valid hit calls `end_game` and transitions status to `'ended'`, causing subsequent calls to exit immediately.
3. **Ghost Interpolation Overshoot:**
   - Match runs longer than the recorded ghost duration (`elapsed_s > duration_s`).
   - **Protection:** In `time_trial` and `evade`, `loop_frac` is clamped via `least(1.0, elapsed_s / duration_s)`. The ghost stops at the finish line and does not loop or wrap around. In `mirror_chase`, exceeding duration triggers `end_game('runners', 'ghost_escaped')`.
4. **GPS Drift Near Finish Target:**
   - Inaccurate GPS fixes ($\text{accuracy} > 30\text{ m}$) falsely triggering finish or collision.
   - **Protection:** `submit_position` filters out fixes with $\text{accuracy} > 30\text{ m}$ for victory evaluation.

---

## 6. Physical Device & Playtest Verification Checklist

- [ ] **Solo Outdoor Navigation:** Verify HUD distance chip updates smoothly while running outdoors toward the finish target without requiring continuous screen inspection.
- [ ] **Finish Target Visual Contrast:** Confirm emerald finish circle (`#10B981`) and cyan ghost blip (`#06B6D4`) maintain high contrast in direct sunlight on mobile displays.
- [ ] **Mirror Chase Tag Haptics:** Verify heavy tactile vibration feedback occurs immediately upon successful `tag_ghost` execution.
- [ ] **Evade Collision Warning:** Verify urgent haptic and audio alert when runner approaches within 35 m of the ghost hunter before the 20 m haunt collision triggers.
- [ ] **SOS Emergency Interruption:** Verify triggering SOS terminates ghost duel tracking immediately and broadcasts distress coordinates.
