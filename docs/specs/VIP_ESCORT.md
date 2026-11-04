# B4 — VIP Escort Role Add-on Specification

> **Status:** Approved — ready for implementation.  
> **MODES.md reference:** Section 5.2 (lines 542–558), compatibility matrix §2.3, mode framework §2.1–2.2.  
> **Effort estimate:** M (1–2 weeks).

---

## 1. Rules (from MODES.md §5.2, with clarifications)

### Core concept
Runners must protect a secret VIP on their squad. Hunters see identical runner radar pings and dots, and must deduce through behavior, formation, and scouting which runner is the high-value target. Tagging a bodyguard only freezes them for 60 seconds as a distraction/decoy, while tagging the VIP ends the match immediately in hunter victory. The VIP and any nearby bodyguard can execute a secret physical role swap to throw hunters off the scent.

### Teams and players
- **Base Modes:** Classic Chase and Tag Hunt (`classic_chase`, `tag_hunt`).
- **Role Layer:** Role Add-on (`id = 'vip'`).
- **Teams:** Runners (`team = 'runner'`) and Hunters (`team = 'hunter'`).
- **Player Count:**
  - Production recommendation: 6+ players (4+ runners, 2+ hunters).
  - Test / casual support: 3+ players (2 runners: 1 VIP + 1 bodyguard, 1 hunter).

### Role Setup on Match Start
When the host starts a match with the `'vip'` role enabled:
1. The server checks that at least 2 active runners are present.
2. Exactly one active runner is randomly assigned `secret_role = 'vip'`.
3. All other active runners are assigned `secret_role = 'bodyguard'`.
4. Hunters are assigned `secret_role = null`.
5. An event `vip_assigned` is emitted to the runner squad only.

---

## 2. Secrecy & Information Architecture

### Hunter Secrecy (Zero-Knowledge)
1. **Radar Pings:** Pings for the VIP and Bodyguards are completely indistinguishable. They emit on the exact same cadence and carry no role metadata.
2. **Live Dots:** Teammate live positions are visible only within squads; hunters never see live dots of runners.
3. **Database Security:** `players.secret_role` is locked with column-level grants. Direct `SELECT secret_role FROM players` fails for all clients.
4. **Post-Game Reveal:** When the game status transitions to `ended`, `secret_role` becomes public to all players for post-match recaps and replay analysis.

### Runner Squad Shared Knowledge
1. Runners can see their teammates' roles via `get_game_state` or `get_my_role`.
2. The HUD for runners displays:
   - VIP has a distinct gold crown/crest banner: *"YOU ARE THE VIP — SURVIVE & REACH EXTRACTION"*.
   - Bodyguards have a blue shield icon: *"YOU ARE A BODYGUARD — PROTECT THE VIP"*, with a directional indicator showing their VIP's location.

---

## 3. Bodyguard Freeze Mechanic

1. **Tagging a Bodyguard:**
   - When a hunter executes `attempt_tag` on an active bodyguard:
     - The bodyguard is **not** eliminated (`status` remains `'active'`).
     - The bodyguard transitions to a **frozen** state:
       $$\text{frozen\_until} = \text{now}() + \text{interval '60 seconds'}$$
     - Recorded in `status_detail->>'frozen_until'`.
     - Event `bodyguard_frozen` is emitted to all players (displaying bodyguard display name, without coordinates).
     - Hunters receive audio and toast feedback: *"Bodyguard tagged! Frozen for 60s."*
2. **Frozen State Constraints:**
   - Frozen bodyguards cannot initiate or confirm role swaps.
   - Frozen bodyguards cannot claim Dead Drops or activate tactical items.
   - Tagging an already frozen bodyguard fails with an informative error and does not consume hunter cooldown.
   - When `now() >= frozen_until`, the freeze expires automatically with no server action needed.

---

## 4. Role Swap Protocol (Physical Handshake)

1. **Proximity Requirement:** VIP and Bodyguard must be within **5 m** of each other with fresh fixes ($\le 20\text{ s}$ old, accuracy $\le 30\text{ m}$).
2. **Handshake Flow:**
   - Player 1 calls `request_role_swap(p_game_id, p_target_player_id)`.
   - Player 2 receives an on-screen prompt: *"Accept Role Swap with [Name]?"* with a 10-second countdown.
   - Player 2 calls `confirm_role_swap(p_game_id)`.
3. **Resolution:**
   - If verified within 10 s and within 5 m:
     - Roles swap: VIP becomes Bodyguard, Bodyguard becomes VIP.
     - Both players enter a **3-minute swap cooldown** (`swap_cooldown_until = now() + interval '180 seconds'`).
     - Event `roles_swapped` is emitted to **runners only**. Hunters receive no alert, keeping the swap secret.

---

## 5. VIP Disconnect / Inactivity Handling (D16)

If the VIP player disconnects or stops submitting GPS fixes for $> 60\text{ s}$ while live:
1. `advance_game` detects the inactive VIP.
2. The server promotes the geographically closest active, non-frozen bodyguard to VIP:
   $$\text{New VIP} = \operatorname*{arg\,min}_{b \in \text{Bodyguards}} \operatorname{dist}(b, \text{Old VIP})$$
3. Event `vip_promoted` is broadcast to the runner squad.

---

## 6. Win Conditions

| Game Mode | Winner | Condition | End Reason |
| :--- | :--- | :--- | :--- |
| **Any** | **Hunters** | Hunter tags the active VIP | `vip_eliminated` |
| **Classic Chase** | **Runners** | Active VIP enters extraction target radius ($25\text{ m}$) | `target_reached` |
| **Classic Chase** | **Hunters** | Match timer expires before VIP reaches extraction | `time_expired` |
| **Tag Hunt** | **Runners** | Match timer expires and VIP is still alive | `time_expired` |
| **Any** | **Hunters** | All runners (VIP + all bodyguards) are tagged or inactive | `all_tagged` |

> **Note on Classic Chase Extraction:** If a bodyguard enters the extraction target zone without the VIP, the game does **not** end. Only the VIP's arrival completes extraction.

---

## 7. Database Migrations Plan

1. **`20261112000000_b4_vip_escort_schema.sql`**:
   - Ensure `'vip'` is enabled in `app_settings` (`feature.role.vip = true`).
   - Register `'vip'` role in `role_catalogue()` with compatibility for `classic_chase` and `tag_hunt`.
2. **`20261112001000_b4_vip_escort_rpcs.sql`**:
   - Implement `request_role_swap(p_game_id, p_target_player_id)`.
   - Implement `confirm_role_swap(p_game_id)`.
   - Implement `cancel_role_swap(p_game_id)`.
3. **`20261112002000_b4_vip_escort_lifecycle.sql`**:
   - Update `start_game` to assign VIP and Bodyguard roles when `'vip'` is in `roles`.
   - Update `attempt_tag` to branch on `secret_role`:
     - VIP tagged: call `end_game(..., 'hunter', 'vip_eliminated')`.
     - Bodyguard tagged: set `status_detail->>'frozen_until'` for 60 s, emit `bodyguard_frozen`.
   - Update `submit_position` Classic Chase target check: only runner with `secret_role = 'vip'` can trigger `target_reached`.
   - Update `advance_game` to handle 60 s VIP offline promotion to nearest bodyguard.
   - Update `get_game_state` to reveal teammate roles to runners during play, and reveal all roles post-game.

---

## 8. Client UI Plan

1. **`src/lib/modeRegistry.ts`**:
   - Set `enabled: true` for role `vip`.
   - Add `vip` to `compatible_roles` in `tag_hunt`.
2. **`app/lobby/[id].tsx`**:
   - Display VIP Escort role toggle in lobby when host creates or configures Classic Chase or Tag Hunt.
3. **`app/game/[id].tsx`**:
   - HUD banner for VIP (Gold crest) vs Bodyguard (Blue shield).
   - Distance & directional beacon from bodyguard pointing toward their VIP.
   - Frozen overlay on HUD when bodyguard is frozen with countdown timer.
   - Bottom sheet action card for Role Swap (Request swap when $\le 5\text{ m}$, accept prompt).
4. **`app/result/[id].tsx`**:
   - Win banner handling for `vip_eliminated` and role reveal in player roster.

---

## 9. Verification & Test Plan

1. **RLS Checks (`scripts/rls-check.ts`)**:
   - Hunter cannot read runner `secret_role` via direct query during play.
   - Outsider cannot call `request_role_swap` or `confirm_role_swap`.
   - Post-game state reveals all roles to members.
2. **Simulator Scenario (`scripts/sim/index.ts`)**:
   - VIP and Bodyguard assigned properly at start.
   - Tagging bodyguard freezes them for 60 s, does not end game.
   - Tagging frozen bodyguard fails.
   - Role swap validates $\le 5\text{ m}$ proximity and swaps roles cleanly.
   - Tagging new VIP terminates game with `vip_eliminated`.
   - Bodyguard reaching target does not trigger victory; VIP reaching target triggers `target_reached`.
3. **Typecheck & Lint**: Zero errors.
