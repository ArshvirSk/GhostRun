# VIP Escort Role Add-on Specification (VM1 Verified)

> **Document Status:** Complete & Verified (`VM1: Spec check`)  
> **Target Role:** `vip` (VIP Escort Role Add-on)  
> **Compatible Base Modes:** `classic_chase`, `tag_hunt` (docs/MODES.md §2.3, §5.2)  
> **Source Specification:** [`docs/MODES.md` §5.2](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/MODES.md#L550-L565)  
> **Effort Estimate:** M (1 day for VM2 fixes)  

---

## 1. Rules Comparison: MODES.md vs Implementation

| Rule Aspect | MODES.md §5.2 Specification | Implemented Behaviour | Status / Difference ID | Resolution Recommendation |
|---|---|---|---|---|
| **Pitch & Core Mechanic** | Runners protect a secret VIP. Hunters see several runner dots and must deduce which is the VIP. | Runners have 1 VIP and 1+ Bodyguards. Hunters see identical radar pings for all runners. Tagging VIP ends game in hunter win; tagging bodyguard freezes them for 60 s. | Matching | **Keep as implemented** |
| **Role Assignment** | At match start, exactly one runner is the VIP, remaining runners are bodyguards. | `start_game` randomly selects 1 runner as `secret_role = 'vip'`, and assigns all other runners `secret_role = 'bodyguard'`. Assigns hunters `secret_role = null`. Requires $\ge 2$ runners. | Matching | **Keep as implemented** |
| **Bodyguard Freeze** | Tagging a bodyguard freezes them for 60 s instead of eliminating them. | `apply_tag` checks `target_runner.secret_role`: if `'bodyguard'`, records tag, sets `status_detail->>'frozen_until' = now() + interval '60 seconds'`, and emits `bodyguard_frozen`. Bodyguard remains `status = 'active'`. Tagging an already frozen bodyguard raises `already_frozen` without consuming hunter cooldown. | Matching | **Keep as implemented** |
| **Role Swap Protocol** | VIP and a bodyguard within 5 m both press Swap within 10 s and the server swaps roles. Cooldown 3 minutes. | 2-way handshake: caller calls `request_role_swap(p_game_id, p_target_player_id)` (requires $\le 5\text{ m}$ proximity + GPS accuracy fuzzing). Target receives on-screen prompt and calls `confirm_role_swap(p_game_id)` within 15 s. Both swap roles, enter 180 s cooldown (`swap_cooldown_until`), and emit `roles_swapped` (audience: `'runner'`). | Minor variance (15 s request window vs 10 s) | **Keep as implemented** (15 s window accommodates physical touchscreen interaction outdoors) |
| **Classic Chase Extraction** | Runners win when the VIP reaches the extraction target (Classic). | `submit_position` arrival check: originally guarded by `(not ('vip' = any(roles)) or me.secret_role = 'vip')`. Regressed in Milestone C1 (migration 141) to allow any runner to trigger `target_reached`. | **X-14 (High Severity)** | **Change to match spec in VM2:** Restore VIP check in `submit_position` arrival check so bodyguards cannot extract without the VIP |
| **Tag Hunt Win Condition** | Runners win when match timer expires and VIP is still alive. | `advance_game` checks timer expiry: awards runners victory on timeout in `tag_hunt`. If VIP was tagged, match ended immediately with `vip_eliminated`. | Matching | **Keep as implemented** |
| **VIP Offline Inactivity** | The VIP disconnecting: assign a new VIP from nearest bodyguard. | Originally implemented in `20261112002000_b4_vip_escort_lifecycle.sql`: if VIP has no fix for $> 60\text{ s}$ while live, promotes nearest active, non-frozen bodyguard and emits `vip_promoted`. Regressed in migrations 120–149 replacements of `advance_game`. | **X-13 (High Severity)** | **Change to match spec in VM2:** Restore the VIP offline auto-promotion loop in canonical `advance_game` |
| **Root Payload Contract** | Client receives `vip_escort` metadata in `get_game_state`. | Migration 141 omitted `vip_escort` in `get_game_state`. Already restored locally in migration 146 (`20261118006000_r3_fix_canonical_game_state.sql`), pending deployment. | **X-12 (High Severity)** | **Fixed locally in migration 146; hold till fix** |
| **Player Count Minimum** | Recommended 6+ players (4+ runners, 2+ hunters). Minimum 3 players (2 runners, 1 hunter). | `start_game` enforces `active_runners >= 2` and `active_hunters >= 1`. | Minor variance | **Keep as implemented** |

---

## 2. Code & Migrations Inventory

### Database Migrations
- `20261112000000_b4_vip_escort_schema.sql`: Sets `feature.role.vip = true` in `app_settings`; registers `vip` in `role_catalogue()` and adds `vip` to `compatible_roles` in `classic_chase` and `tag_hunt`.
- `20261112001000_b4_vip_escort_rpcs.sql`: Implements `request_role_swap`, `confirm_role_swap`, and `cancel_role_swap`.
- `20261112002000_b4_vip_escort_lifecycle.sql`: Wires `start_game` role assignment, `apply_tag` bodyguard freeze / VIP elimination, `submit_position` VIP arrival guard, and `advance_game` VIP offline auto-promotion.
- `20261116002000_b8_territory_pulse_tag.sql`: Preserves VIP Escort branching inside canonical `apply_tag`.
- `20261118006000_r3_fix_canonical_game_state.sql`: Restores root `vip_escort` payload in `get_game_state` (pending deployment).

### Server RPCs
- `public.request_role_swap(p_game_id uuid, p_target_player_id uuid)`: Initiates 2-way role swap handshake. Checks live phase, runner team, active status, freeze status, 180 s cooldown, and 5 m physical proximity.
- `public.confirm_role_swap(p_game_id uuid)`: Completes 2-way role swap handshake. Verifies 15 s expiration, proximity, and non-frozen status; swaps `secret_role`, sets 180 s cooldown, and emits `roles_swapped` event to runners.
- `public.cancel_role_swap(p_game_id uuid)`: Aborts pending role swap request.
- `public.apply_tag(p_game_id uuid, p_hunter_id uuid, p_runner_id uuid, p_distance_m double precision)`: Branches on `target_runner.secret_role`:
  - `vip`: ends game with `vip_eliminated` (hunters win).
  - `bodyguard`: sets `status_detail->>'frozen_until'` for 60 s, emits `bodyguard_frozen`, returns `{ frozen: true, frozen_seconds: 60 }`.

### Client UI Components
- `app/game/[id].tsx`:
  - `isVipMode`, `isVip`, `distanceToVip` calculated from `get_game_state`.
  - Gold crest HUD banner for VIP (*"VIP: Evade & Extract"*).
  - Blue shield HUD banner for Bodyguard (*"Bodyguard: Protect VIP"* + live distance indicator).
  - `vipFrozenCard`: Overlay displayed to frozen bodyguard with live seconds countdown.
  - `vipSwapCard`: Contextual bottom dock rendering incoming swap request ("ACCEPT SWAP" / "DECLINE") or available swap button ("OFFER VIP MANTLE" / "REQUEST BODYGUARD COVER") when within 5 m.
- `app/result/[id].tsx`:
  - Displays `vip_eliminated` victory banner: *"Hunters successfully eliminated the secret VIP!"*.
  - Unmasks all player secret roles in post-game roster with Gold "VIP" badge.

---

## 3. Parameters, Defaults, and Ranges

| Parameter | Default | Range / Constraints | Defined In | Description |
|---|---|---|---|---|
| `bodyguard_freeze_s` | `60` | Fixed at 60 s | `apply_tag` | Duration a bodyguard remains frozen upon being tagged by a hunter. |
| `role_swap_radius_m` | `5` | $5\text{ m} + \min(10, \frac{\text{acc}_1 + \text{acc}_2}{2})$ | `request_role_swap` | Maximum physical distance between VIP and bodyguard to initiate/confirm a swap. |
| `role_swap_timeout_s` | `15` | Fixed at 15 s | `confirm_role_swap` | Maximum window to accept an incoming role swap request before expiration. |
| `role_swap_cooldown_s` | `180` | Fixed at 180 s (3 min) | `confirm_role_swap` | Cooldown imposed on both swap participants before another swap can occur. |
| `vip_offline_threshold_s` | `60` | Fixed at 60 s | `advance_game` | Inactivity threshold before an unreporting VIP is automatically replaced. |
| `min_runners` | `2` | $\ge 2$ | `start_game` | Minimum active runners required to start a game with VIP Escort enabled. |

---

## 4. Concurrency, Races, and Failure Modes

1. **Simultaneous Hunter Tag and Role Swap:**
   - Both `request_role_swap` / `confirm_role_swap` and `apply_tag` take row locks (`FOR UPDATE`) on the target player's row in `public.players`.
   - If a hunter tags the VIP before `confirm_role_swap` acquires the lock, the game transitions to `ended` with `vip_eliminated`. The pending swap then fails with `Role swaps can only happen while the round is live`.
   - If `confirm_role_swap` commits first, the roles have already swapped; the tag hits the new bodyguard and triggers a 60 s freeze instead of ending the game. This represents a legitimate last-second clutch play.
2. **Double Role Swap Collision:**
   - If two bodyguards attempt to swap with the VIP simultaneously, the VIP's row lock serializes the transactions. The second caller fails because the VIP is already on 180 s cooldown.
3. **Hunter Spamming Tag on Frozen Bodyguard:**
   - `apply_tag` checks `target_runner.status_detail->>'frozen_until'`. If the player is already frozen, it raises `already_frozen`. In `attempt_tag`, this failure does **not** trigger the 8-second hunter miss cooldown, allowing the hunter to immediately chase other runners.
4. **VIP Loss of Connection (Deadlock Prevention):**
   - If the VIP loses battery or signal, `advance_game` (restored in VM2) identifies the missing fix after 60 s and promotes the nearest active, non-frozen bodyguard. The runner squad receives a `vip_promoted` event, preventing the match from becoming unwinnable.

---

## 5. Secrecy & Privacy Review

| Data Element | Runner Squad Visibility | Hunter Visibility | Outsider Visibility | Enforcement Mechanism |
|---|---|---|---|---|
| `players.secret_role` (live) | Visible via `get_game_state` / `get_my_role` | **Completely Hidden** (`null`) | **Completely Hidden** | Column-level security on `players` + Security Definer projection in `get_game_state` |
| `players.secret_role` (post-game) | Visible | Visible | Hidden | Revealed to match members only when `status in ('ended', 'cancelled')` |
| Radar Pings | Identical scheduled pings | Identical scheduled pings | Hidden | VIP and bodyguards share identical ping interval, reason (`scheduled`), and formatting |
| `bodyguard_frozen` Event | Visible | Visible (without coordinates) | Hidden | `audience = 'all'`, payload includes display name and freeze duration, no location |
| `role_swap_requested` Event | Visible to target runner only | **Completely Hidden** | Hidden | `audience = 'runner'`, target player filter |
| `roles_swapped` Event | Visible to runner squad only | **Completely Hidden** | Hidden | `audience = 'runner'`, RLS restricts select to runner teammates |
| `vip_promoted` Event | Visible to runner squad only | **Completely Hidden** | Hidden | `audience = 'runner'`, RLS restricts select to runner teammates |
| Proximity to VIP | Visible (distance in meters) | **Completely Hidden** | Hidden | Calculated client-side from runner-only teammate positions |

---

## 6. Safety & Physical Verification Review

1. **Pedestrian Speed Enforcement:**
   - All runners (VIP and bodyguards) are subject to the universal $8\text{ m/s}$ ($28.8\text{ km/h}$) speed cap enforced in `submit_position`. Sustained vehicle speeds emit `vehicle_warning` and spike the noise meter.
2. **Safe Physical Proximity (No Body Tackles):**
   - The 5 m role swap requirement includes GPS accuracy fuzzing ($5\text{ m} + \min(10, \frac{\text{acc}_1 + \text{acc}_2}{2})$), allowing players to execute swaps comfortably at 4–8 m separation without bumping into each other.
   - Tagging distance allows tags up to $20\text{ m} + \text{GPS accuracy offset}$, ensuring hunters never need to physically touch runners.
3. **Bodyguard Freeze Safety:**
   - When a bodyguard is frozen, their in-game ability to swap or claim drops is disabled, but their physical locomotion is **never restricted**. The app advises them to step aside or walk calmly; no physical restraint is involved.
4. **Emergency SOS Interruption:**
   - Any player calling `send_sos` triggers an immediate match pause (`pause_game`). All active timers (including the 60 s bodyguard freeze and the 180 s swap cooldown) pause and shift forward when resumed, guaranteeing player safety overrides all gameplay.

---

## 7. Abuse Cases & Mitigation

| Abuse Vector | Exploit Description | Mitigation Mechanism |
|---|---|---|
| **Bodyguard Decoy Camping (Classic Chase)** | Bodyguard camps at extraction target to distract hunters or prematurely trigger arrival. | **Fixed in VM2 (X-14):** `submit_position` explicitly verifies `me.secret_role = 'vip'` before evaluating `target_reached`. Bodyguard arrival is ignored. |
| **Rapid Hot-Potato Role Swapping** | Squad swaps VIP role back and forth continuously to confuse hunters. | 180-second (3-minute) swap cooldown enforced server-side on both participants. |
| **GPS Spoofing for Instant Swaps** | Runner spoofs coordinates within 5 m of VIP to swap remotely. | `request_role_swap` and `confirm_role_swap` require fresh positions ($\le 20\text{ s}$) from both devices and cross-checks accuracy bounds. |
| **Intentional Disconnect Griefing** | VIP disconnects to stall hunters. | `advance_game` auto-promotes nearest active bodyguard after 60 s of silence. |
| **Outsider Swap Disruption** | Unauthorized user calls `request_role_swap`. | Security Definer RPC strictly enforces `is_member` and `me.team = 'runner'`. |

---

## 8. Test Plan & Fix List for VM2

### Test Plan
1. **Automated RLS & Secrecy Suite (`scripts/rls-check.ts`):**
   - Verify hunter cannot read runner `secret_role` during live play.
   - Verify outsider cannot call `request_role_swap`, `confirm_role_swap`, or `cancel_role_swap`.
   - Verify hunter cannot call `request_role_swap` or `confirm_role_swap`.
   - Verify hunter cannot select `roles_swapped` or `role_swap_requested` events from `events` table (`audience = 'runner'`).
2. **Automated Simulator Scenario (`scripts/sim/index.ts`):**
   - Verify VIP and Bodyguard role assignment at match start.
   - Verify hunter tagging bodyguard freezes them for 60 s and match continues.
   - Verify hunter attempting to tag already-frozen bodyguard is rejected.
   - Verify 5 m proximity role swap succeeds and swaps roles cleanly.
   - Verify role swap cooldown (180 s) blocks immediate follow-up swap.
   - Verify bodyguard entering target in Classic Chase does NOT trigger victory.
   - Verify VIP entering target in Classic Chase triggers `target_reached` victory.
   - Verify hunter tagging VIP triggers `vip_eliminated` hunter victory.
3. **Physical Device Field Playtest (`docs/PLAYTEST.md` §3.9):**
   - Verify HUD banner readability in daylight (Gold VIP vs Blue Shield Bodyguard).
   - Verify 5 m role swap button triggers cleanly when two runners rendezvous outdoors.
   - Verify audio and haptic feedback on bodyguard freeze.
   - Verify SOS pause halts freeze timer and resumes cleanly.

### VM2 Fix List & Effort
- **Fix 1 (X-13 — High):** Restore VIP offline auto-promotion loop in canonical `advance_game` (Migration 150).
- **Fix 2 (X-14 — High):** Enforce `(not ('vip' = any(current_game.roles)) or me.secret_role = 'vip')` in `submit_position` target arrival check.
- **Fix 3 (Playtest):** Add dedicated §3.9 VIP Escort field test checklist to `docs/PLAYTEST.md`.
- **Fix 4 (Tests):** Add negative tests to `scripts/rls-check.ts` and `scripts/sim/index.ts`.
- **Estimated Effort:** ~2 hours (VM2).
