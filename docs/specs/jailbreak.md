# GhostRun — Jailbreak Mode Specification (B1)

> **Document Version:** 1.0.0  
> **Status:** Spec Verification (Task VM1) — Awaiting User Approval  
> **MODES.md Reference:** Section 4.1 (Jailbreak, lines 262–293)  
> **Engine Mode Identifier:** `jailbreak`

---

## 1. Rules Comparison: Spec vs. Implemented Behavior

| Spec Rule (MODES.md §4.1) | Implemented Behavior | Difference ID | Recommendation & Resolution |
|---|---|---|---|
| **Teams & Player Count:** Runners and Hunters. Min 5 players, 8+ ideal. | Validated in `mode_catalogue` (`min_players: 5`, teams `runner`, `hunter`). | None | **Keep as implemented.** Matches spec. |
| **Setup & Placement:** Host (or hunters) places the jail on the map inside the play area in an open public place. | Host places jail in lobby via `set_jail_location(game_id, lat, lng)`. Stored in `entities` table (`kind = 'jail'`, `visible_to = 'all'`). Requires $\ge 50\text{ m}$ inset from boundary. | None | **Keep as implemented.** Visible to all players. |
| **No Secret Target:** Jailbreak has no secret extraction target. | Lobbies advance straight to `countdown` upon host start once jail entity is set; target selection phase is bypassed. | None | **Keep as implemented.** |
| **Tagging Mechanics:** Tagged runner becomes `jailed` (not eliminated). Walks to jail and stays within jail radius (default 15 m). | `apply_tag` checks `current_game.mode_id = 'jailbreak'`; sets `players.status = 'jailed'`, sets `tagged_at = now()`, clears active rescue hold. Jailed runner cannot be re-tagged. | None | **Keep as implemented.** |
| **Rescue Hold:** Free runner stands within 10 m of jail for 10 continuous seconds (holding button) to free all jailed runners. | Implemented via two-phase transaction: `start_rescue` (verifies $\le 10\text{ m}$, fix $\le 20\text{ s}$, records `free_started_at`) and `complete_rescue` (re-verifies location, hold $\ge 10\text{ s}$, sets all jailed runners to `active`). | None | **Keep as implemented.** Prevents double-freeing via row locks. |
| **Rescue Vulnerability:** While freeing, rescuer is exposed to hunter tags. If tagged, rescue is cancelled. | `apply_tag` clears `status_detail->'free_started_at'` on the tagged runner and sets status to `jailed`. If rescuer is tagged before `complete_rescue`, hold fails. | None | **Keep as implemented.** |
| **Auto-Release:** After 5 minutes (300 s) in jail, runners are automatically released back to `active`. | Configured via `auto_release_s` (default 300 s). **Regression found:** Later migrations (`b2`–`c2`) replaced `advance_game` and omitted the auto-release loop, causing auto-release to stall unless re-introduced. | **X-1** | **Change to match spec:** Re-add the auto-release check loop into canonical `advance_game` in VM2. |
| **Number of Jails:** Spec mentions up to 2 jails for large maps ($>600\text{ m}$). | Engine implements exactly 1 jail entity per match regardless of boundary size. | **X-2** | **Keep as implemented:** 1 central jail keeps team coordination focused for 5–8 players. (Approved in VM0). |
| **Jail Guards (Optional):** Up to 2 hunters assigned as guards restricted to 60 m radius of jail. | Deferred in spec and code. Reserved in `mode_params` schema but not enforced. | None | **Keep as implemented:** Deferred to post-field-test tuning. |
| **Win Condition — Hunters:** All runners are `jailed` simultaneously. | `apply_tag` evaluates active runner count. If 0 active runners remain, immediately calls `end_game(game_id, 'hunters', 'all_jailed')`. | None | **Keep as implemented.** |
| **Win Condition — Runners:** Round timer expires with at least 1 runner free (`active`). | Evaluated in `advance_game` on time expiry: awards victory to `runners` with `time_expired` if $\ge 1$ runner is active. | None | **Keep as implemented.** |

---

## 2. Parameters, Defaults, and Ranges

All parameters are stored in `games.mode_params->'jailbreak'` JSONB:

| Parameter | Key | Default | Valid Range | Enforced By | Description |
|---|---|---|---|---|---|
| **Jail Radius** | `jail_radius_m` | `15` | `10`–`50` m | `set_jail_location` | Radius around jail entity within which jailed runners must remain. |
| **Rescue Radius** | `release_radius_m` | `10` | `5`–`25` m | `start_rescue`, `complete_rescue` | Maximum distance from jail center where a free runner can initiate and hold rescue. |
| **Rescue Hold Time** | `release_hold_s` | `10` | `5`–`30` s | `complete_rescue` | Continuous seconds a free runner must hold button while remaining in rescue radius. |
| **Auto-Release Time** | `auto_release_s` | `300` | `60`–`600` s | `advance_game` | Elapsed jail time before an unrescued runner is automatically restored to `active`. |
| **Min Inset Distance** | `min_inset_m` | `50` | `30`–`100` m | `set_jail_location` | Minimum distance from boundary perimeter where the jail can be placed. |

---

## 3. Concurrency and Race Condition Analysis

### 3.1 Rescue vs. Tag Race
- **Scenario:** Hunter attempts to tag the rescuer at the exact moment the rescuer completes the 10-second hold.
- **Resolution in SQL:**
  1. Both `complete_rescue` and `apply_tag` execute `SELECT * FROM games WHERE id = p_game_id FOR UPDATE` and lock the player row `FOR UPDATE`.
  2. If `apply_tag` acquires the lock first: the rescuer's status becomes `'jailed'`, and `status_detail - 'free_started_at'` is executed. When `complete_rescue` acquires the lock next, it evaluates `IF me.status <> 'active'`, throws `'You cannot complete a rescue while jailed or eliminated.'`, and rolls back. The rescue fails cleanly.
  3. If `complete_rescue` acquires the lock first: all jailed runners are restored to `active`, and `free_started_at` is cleared. When `apply_tag` executes next, the rescuer is tagged and jailed, but teammates have already been freed.
- **Double-Processing Guard:** If two free runners hold and complete rescue concurrently, the second `complete_rescue` executes `UPDATE players SET status = 'active' WHERE status = 'jailed'`, which safely affects 0 rows and returns `{ freed_count: 0 }`. No double-event or duplicate record occurs.

### 3.2 Secrecy and Information Leaks
- **`rescue_started` Event:** Emitted with `audience = 'runner'`. Hunters NEVER receive this event over Supabase Realtime or through `events` table queries (RLS enforced).
- **`runners_freed` Event:** Emitted with `audience = 'all'`, payload contains only `{ freed_count, rescuer_id, rescuer_name }`. No player coordinates or directions are broadcast.
- **Jailed Runners Live Telemetry:**
  - In `advance_game`, scheduled pings select `WHERE p.team = 'runner' AND p.status = 'active'`. Jailed runners are strictly excluded from radar pings.
  - In `hot_cold` modifier, `press_heat` evaluates `WHERE p.team = 'runner' AND p.status = 'active'`. Jailed runners do not trigger hot signals.
  - Jailed runners retain SELECT access to teammates' live positions and ping feeds (spectator mode while awaiting rescue).

---

## 4. Safety and Environmental Review

1. **Physical Congestion at Jail:**
   - Jailing creates a natural physical focal point. If the jail is placed in a confined space, alley, or near traffic, crowding creates safety hazards.
   - **Enforcement:** Host UI displays an explicit prompt: *"Select an open, publicly accessible park or pedestrian area away from roads."* Server validates a minimum 50 m inset from the boundary edge.
2. **Speed and Vehicle Guard:**
   - Speed Guard ($>8\text{ m/s}$ for $>10\text{ s}$) applies to all players in Jailbreak. If a player drives or bikes to the jail, a vehicle warning is broadcast, and the round auto-pauses if curfew/speed limits are violated.
3. **Emergency SOS:**
   - Any player (jailed, free runner, or hunter) can trigger `/sos` or press the SOS button. This immediately transitions the game status to `'paused'` and broadcasts the safety event with the caller's last known location.
4. **GPS Inaccuracy Handling:**
   - Both `start_rescue` and `complete_rescue` enforce that the rescuer's fix is $\le 20\text{ s}$ fresh and includes a 0.5-second network leeway buffer on the hold timer to prevent false rejections from packet latency.
   - If GPS drifts outside the 10 m radius during the hold, `complete_rescue` rejects the action with: `"You must remain within 10 meters of the jail to complete rescue."`

---

## 5. Abuse, Cheating, and Griefing Vectors

1. **Jail Squatting / Camper Hunters:**
   - *Threat:* Hunters permanently surround the jail circle, making rescue impossible.
   - *Mitigation:* The 300 s auto-release rule guarantees runners are freed even if hunters camp the jail. Furthermore, scheduled pings reveal free runners across the rest of the map, incentivizing hunters to search the wider area.
2. **Griefing Jailed Runner (Refusing to stay in Jail):**
   - *Threat:* A jailed runner walks away from the jail to scout or harass hunters.
   - *Mitigation:* Jailed runners have no active ping trail and cannot trigger tags. Client shows a red warning banner if they wander $>25\text{ m}$ from the jail marker.
3. **Rapid Button Spamming:**
   - *Threat:* A runner rapidly invokes `start_rescue` to spam events.
   - *Mitigation:* `start_rescue` checks `status_detail->'free_started_at'`; if already active, it rejects duplicate calls.

---

## 6. Test Plan and Fix List

### 6.1 Required RLS and Simulator Assertions
- [x] Host can set jail location inside area boundary (`rls-check.ts`).
- [x] Outsider and hunters cannot place or alter the jail entity (`rls-check.ts`).
- [x] Outsiders cannot read game entities or rescue events (`rls-check.ts`).
- [x] Hunter cannot call `start_rescue` or `complete_rescue` (`rls-check.ts`).
- [x] Rescuer cannot start rescue if fix is $>20\text{ s}$ stale or $>10\text{ m}$ away (`sim`).
- [x] `rescue_started` is received by runners only; hidden from hunters (`sim`).
- [x] Tagging active rescuer aborts rescue hold (`sim`).
- [ ] **Fix Required (VM2):** Re-introduce the auto-release check loop in `advance_game` for `mode_id = 'jailbreak'`.
- [ ] **Fix Required (VM2):** Re-verify simulator scenario `jailbreak` passes 14/14 assertions cleanly.

### 6.2 Effort to Fix in VM2:
- **Scope:** 1 small canonical migration restoring the auto-release loop in `advance_game`.
- **Effort:** 30 minutes (low risk, purely additive SQL logic).
