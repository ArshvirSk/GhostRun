# Mode Specification: Assassin Ring (`assassin_ring`)

**Mode ID:** `assassin_ring`  
**Classification:** Base Mode (Free-for-all tactical elimination ring)  
**Spec Reference:** [`docs/MODES.md` §4.3](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/MODES.md#L423-L447)  
**Current Implementation Status:** Implemented in migrations `20261110000000_b2_assassin_ring.sql`–`20261110008000`, `20261118006000_r3_fix_canonical_game_state.sql`. Requires verification, gap rectification, and user sign-off.

---

## 1. Exact Rules as Specified in `MODES.md` §4.3

1. **Premise:** Free-for-all elimination ring. Every player is secretly assigned exactly one target ("prey") and is simultaneously the unknown target of another player ("hunter").
2. **Player Count:** Minimum 6 players; ideal 8–16 players. No teams (`team = 'solo'`).
3. **Setup & Circular Ring Permutation:**
   - At match start, the server arranges active players into a random single-cycle permutation (Hamiltonian cycle):
     $$P_{\pi(1)} \to P_{\pi(2)} \to P_{\pi(3)} \dots \to P_{\pi(N)} \to P_{\pi(1)}$$
   - Each player $P_{\pi(i)}$ hunts $P_{\pi(i+1)}$.
   - **Zero-Knowledge Secrecy:** Each player learns the identity (display name, avatar color) of their assigned prey only. They do **not** know who is hunting them, nor the layout of the ring.
4. **Information Architecture & Radar Pings:**
   - On each scheduled radar ping interval (`ping_interval_s`, default 30–45 s), each player receives a delayed coordinate ping of **their assigned prey only**.
   - Coordinate fixes of all other players (including their own hunter) are strictly hidden.
5. **Directionless Sensory Proximity Pulse:**
   - When a player's unknown hunter approaches within **100 m**, the player receives a faint amber sensory warning (`hunter_proximity = 'near'`).
   - When the hunter approaches within **40 m**, the sensory alert intensifies to urgent red (`hunter_proximity = 'close'`).
   - Proximity alerts are completely **directionless** and disclose zero hunter coordinates or identities.
6. **Tagging & Ring Relinking:**
   - A player may attempt to tag their prey within `tag_radius_m` (default 15 m + GPS error allowance).
   - If the player attempts to tag someone who is not their assigned prey, the tag fails without penalty or presence leakage (`reason: 'not_your_prey'`).
   - If the player successfully tags their assigned prey:
     - The prey transitions to status `'tagged'` (eliminated spectator).
     - The hunter inherits the eliminated victim's assigned prey:
       $$\text{If } A \to B \to C \text{ and } A \text{ tags } B \implies A \to C$$
     - A `player_eliminated` event is broadcast to all participants.
     - The hunter's HUD updates immediately with their new prey contract.
7. **Safe Zones:**
   - At least two host-placed or auto-generated Safe Zones (default 20 m radius) inside the boundary.
   - Tagging is disabled for any player inside a safe zone.
   - Positions are hidden from radar pings while sheltering inside.
   - Sheltering is permitted for up to 60 s per visit, followed by a 120 s cooldown.
8. **Victory Conditions:**
   - **Last Survivor:** When the active ring contracts to 1 survivor, match ends immediately with winner `'solo'` and reason `'last_survivor'`.
   - **Time Expiry:** When duration expires with $\ge 2$ survivors, player with most eliminations wins.

---

## 2. Implementation in Code and Migrations

### A. Database Migrations
- **Enum Additions:** `game_mode` includes `'assassin_ring'`; `team_type` includes `'solo'`. `games.winner` check constraint allows `'solo'`.
- **`public.ring_assignments` Table:**
  - `(id uuid, game_id uuid, hunter_player_id uuid, prey_player_id uuid, status text, assigned_at timestamptz, eliminated_at timestamptz)`.
  - Status check: `status in ('active', 'eliminated', 'relinked')`.
  - Unique constraint: `unique (game_id, hunter_player_id, status)`.
- **Row Level Security on `ring_assignments`:**
  - Authenticated players can query only their own active hunt row (`hunter_player_id = my_player_id and status = 'active'`).
  - When the match transitions to `'ended'` or `'cancelled'`, RLS lifts to allow all game members to query the complete elimination history for match recaps.
  - Outsiders are blocked during and after the match.
- **`public.mode_catalogue()`:**
  - Registers `assassin_ring` with `teams: ['solo']`, `min_players: 3`, compatible modifiers: `['noise_meter', 'dead_drops', 'qr_tagging', 'shrinking_zone']`.
  - Parameters: `tag_radius_m: 15`, `safe_zone_count: 2`, `safe_zone_radius_m: 20`, `safe_zone_max_s: 60`, `safe_zone_cooldown_s: 120`, `hunter_pulse_far_m: 100`, `hunter_pulse_near_m: 40`, `offline_relink_s: 180`.
- **RPCs:**
  - `set_safe_zone_location(p_game_id, p_zone_index, p_lat, p_lng, p_radius_m)`: Host-only RPC to position safe zones during lobby setup.
  - `start_game(game_id)`: Forces active players to `team = 'solo'`, auto-generates 2 safe zones at $0^\circ$ and $180^\circ$ radial bearings ($45\%$ radius) if fewer than 2 exist, shuffles active players with `order by random()`, and inserts single-cycle Hamiltonian ring into `ring_assignments`.
  - `attempt_tag(game_id)` & `apply_tag(...)`: Validates caller is active, neither caller nor prey is in a safe zone, target matches caller's assigned prey, distance $\le 15\text{ m} + \min(10, \frac{\text{acc}_h + \text{acc}_p}{2})$. Eliminates prey, relinks hunter to victim's prey, checks $\le 1$ survivor for victory.
  - `advance_game(game_id)`:
    - Offline relink: checks active prey with no fix or fix $> 180\text{ s}$ old, marks them `'tagged'` / `offline_timeout`, relinks ring, checks last survivor.
    - Pings: skips scheduled ping if player is inside an active safe zone.
    - Timeout win: ends game with `'solo'` / `'time_expired'`.
  - `get_game_state(game_id)`: Returns root `assassin_ring` payload containing `my_prey`, `hunter_proximity` (`'none'` | `'near'` | `'close'`), `safe_zones`, `in_safe_zone`, and `active_survivors`. Restricts scheduled pings snapshot to `player_id = my_prey_id`.

### B. Client Application
- [`app/create.tsx`](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/create.tsx#L528-L575): Mode selection card for Assassin Ring.
- [`app/lobby/[id].tsx`](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/lobby/[id].tsx#L174-L186): Solo roster view, start button validation ($\ge 3$ players), map rendering of safe zone entities.
- [`app/game/[id].tsx`](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/game/[id].tsx#L1130-L3380):
  - Top Prey Target HUD: "Hunt: [Prey Name]".
  - Hunter Proximity Banner & Screen Flash: Amber "HUNTER NEAR" ($\le 100\text{ m}$), Red "HUNTER CLOSE" ($\le 40\text{ m}$).
  - Safe Zone Map Overlay & Shelter Badge: Green circles, "IN SAFE ZONE (IMMUNE)".
  - TAG Action: "TAG YOUR TARGET" enabled only when within 15 m of assigned prey outside safe zones.
- [`app/result/[id].tsx`](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/result/[id].tsx#L524-L620): "Assassin Victorious" title, "The last assassin standing survived the elimination ring."

---

## 3. Discrepancies and Gap Analysis

| ID | Category | Spec Requirement (`MODES.md` §4.3) | Current Implementation | Impact & Severity |
|:---|:---|:---|:---|:---|
| **X-3** | **Security / RLS Secrecy** | Each player receives delayed pings of **their prey only**. Opponents and outsiders learn nothing. | RLS policy on `public.pings` (`pings_member_read`) allows any game member to query all unexpired pings where `ping_is_visible` is true. `get_game_state` filters pings, but a direct SELECT on `public.pings` returns all active players' locations. | **HIGH**: Direct REST query exposes all player positions during live play, defeating asymmetric ring secrecy. |
| **X-4** | **Rules / Game Logic** | Safe zones disable tags and shelter players for "up to 60 s per visit, with a cooldown [120 s]". | Safe zones in SQL (`attempt_tag`, `advance_game`) check spatial containment (`st_dwithin`) with no dwell clock or cooldown tracking. | **MEDIUM**: Infinite camping exploit. Players can shelter indefinitely in safe zones to run down the round clock. |
| **X-5** | **Rules / Win Condition** | On timeout: "most eliminations when time expires" with tiebreakers. | `advance_game` ends with reason `'time_expired'` without tallying eliminations or designating a specific winning player ID. | **LOW**: Match concludes as an ambiguous group timeout rather than crowning the top assassin. |
| **X-6** | **Rules / Player Count** | Minimum 6 players (8–16 ideal). | Code and catalogue allow starting with 3 players. | **LOW**: At 3 players, identity uncertainty is eliminated ($A \to B \implies C \text{ must hunt } A$). Should show advisory copy in UI for $<6$ players. |
| **X-7** | **Schema Regression** | `get_game_state` must return root `assassin_ring` payload. | Migration 141 omitted root `assassin_ring` (restored locally in migration 146 `20261118006000_r3_fix_canonical_game_state.sql`, pending remote application). | **HIGH (Pending remote deploy)**: Mobile app HUD fails to receive prey target or proximity state without migration 146. |
| **X-8** | **Safety / Consent** | "show a persistent consent and safety notice, and always allow quitting. Keep no-contact tagging." | Standard onboarding safety acknowledgement exists, but lobby lacks a dedicated Assassin Ring no-contact & public space reminder. | **MEDIUM**: Liability in physical pursuit environments where players may chase strangers or private property. |

---

## 4. Parameters and Defaults

| Parameter | Type | Default | Allowable Range | Purpose |
|:---|:---|:---|:---|:---|
| `tag_radius_m` | integer | `15` | 5–50 m | Server-validated maximum tagging distance. |
| `safe_zone_count` | integer | `2` | 1–5 | Number of safe zones placed in the arena. |
| `safe_zone_radius_m` | integer | `20` | 10–50 m | Radius of each safe zone circle. |
| `safe_zone_max_s` | integer | `60` | 15–300 s | Maximum continuous shelter duration before safe zone immunity expires. |
| `safe_zone_cooldown_s` | integer | `120` | 30–600 s | Cooldown period before a player can shelter again. |
| `hunter_pulse_far_m` | integer | `100` | 50–250 m | Proximity threshold for amber "HUNTER NEAR" alert. |
| `hunter_pulse_near_m` | integer | `40` | 20–100 m | Proximity threshold for urgent red "HUNTER CLOSE" alert. |
| `offline_relink_s` | integer | `180` | 60–600 s | Offline grace period before deadlocked prey is auto-eliminated and ring relinked. |
| `min_players` | integer | `3` (code) / `6` (spec) | 3–32 | Minimum active players required to start. |

---

## 5. Concurrency, Races, and Edge Cases

1. **Two-Player Final Duel ($A \leftrightarrow B$):**
   - When the ring contracts to 2 players, both players hunt each other.
   - If both players press TAG simultaneously, both transactions execute `select * from public.games ... for update` and lock their respective player rows.
   - The first transaction to commit executes `apply_tag`, marks the opponent `'tagged'`, decrements active survivors to 1, and invokes `end_game(..., 'solo', 'last_survivor')`.
   - The second transaction sees `target_runner.status <> 'active'` and aborts cleanly (`"That player is not taggable."`).
2. **Double Elimination / Simultaneous Tagging:**
   - If player $A$ tags $B$ at the exact moment $B$ tags $C$:
   - Row-level locking on `players` and `ring_assignments` serializes the actions.
   - If $A$ tags $B$ first, $B$ is marked `'tagged'`. When $B$'s tag on $C$ executes, $B$'s status is no longer `'active'`, rejecting $B$'s tag attempt cleanly.
3. **Disconnected / Abandoned Prey:**
   - If a player's phone dies or loses cellular connectivity, their hunter would be blocked indefinitely.
   - `advance_game` checks active assignments where `pp.recorded_at < now() - interval '180 seconds'`.
   - The inactive player is automatically marked `'tagged'` (`reason: 'offline_timeout'`), and the ring relinks to the next active player.
4. **Safe Zone Edge Boundary Crossing:**
   - A player standing at the exact edge of a safe zone (19.9 m vs 20.1 m) subjected to GPS multipath drift ($\pm 3\text{ m}$).
   - `attempt_tag` validates coordinates using server timestamps and clamps GPS accuracy:
     $$\text{dist} \le R_{\text{zone}} + \min(5, \text{acc})$$

---

## 6. Secrecy, RLS, and Data Access Review

1. **`ring_assignments` Isolation:**
   - Verified in `scripts/rls-check.ts` ([lines 1695–1708](file:///c:/ASK_Main/ASK/Projects/GhostRun/scripts/rls-check.ts#L1695-L1708)):
     - An active player queries `ring_assignments` and receives **only** their own active assignment row (`hunter_player_id = my_id`).
     - Querying for their own incoming assignment (`prey_player_id = my_id`) returns **0 rows**.
     - An outsider receives **0 rows**.
2. **Post-Game Unsealing:**
   - When the round ends (`status in ('ended', 'cancelled')`), the RLS policy permits game members to read all `ring_assignments` rows to construct the complete post-match replay tree.
3. **`public.pings` RLS Leak (Gap X-3):**
   - In `assassin_ring`, `pings_member_read` policy allows any game member to query all visible pings.
   - Fix required in VM2: Add a condition to `pings_member_read` or create an Assassin Ring specific ping policy ensuring that during live play in Assassin Ring, a player can SELECT only pings where `player_id = (select prey_player_id from ring_assignments where hunter_player_id = my_id and status = 'active')`.
4. **Proximity Alert Anonymity:**
   - Proximity warnings are computed server-side in `get_game_state` using `st_dwithin`.
   - Returns a string enum only (`'none'`, `'near'`, `'close'`).
   - Zero hunter coordinates, distances, bearings, or identities are transmitted over the wire.

---

## 7. Environmental and Physical Safety Considerations

1. **Solo Pursuit Dynamics:**
   - Unlike team modes where players operate in visible groups, Assassin Ring involves individual players tailing individual targets.
   - **Risk:** Stalking perception, trespassing into private properties, or cornering players in poorly lit or dangerous areas.
2. **No-Contact Mandate:**
   - Physical contact is strictly prohibited. Tagging is executed exclusively via GPS proximity button (15 m) or optical QR code scan.
3. **Public Arena Restrictions:**
   - Arena center and radius must be restricted to sanctioned public parks, campuses, or open pedestrian zones.
   - Host must position Safe Zones in open, visible, well-lit gathering areas (e.g. park gazebos, central plazas).
4. **Emergency SOS & Pause:**
   - The universal in-game SOS button must immediately halt the match, broadcast an emergency alert to all participants, and reveal all player locations for mutual safety.

---

## 8. Abuse and Griefing Vectors

1. **Safe Zone Camping (Addressed by X-4):**
   - *Attack:* A hunted player sits inside a safe zone for the entire 20-minute match, immune to tags.
   - *Remediation:* Server-enforced dwell clock (max 60 s shelter) after which safe zone immunity expires and a 120 s cooldown begins.
2. **Collusion / Meta-Teaming:**
   - *Attack:* Two friends in the same game share their screens or communicate via phone call, teaming up to hunt down a third player.
   - *Mitigation:* Inherent in free-for-all mechanics; mitigated by randomized Hamiltonian ring generation and large arena sizes ($> 400\text{ m}$ radius).
3. **Grief Quitting:**
   - *Attack:* A player about to be tagged abruptly quits the app or leaves the lobby.
   - *Mitigation:* `leave_game` must trigger an immediate ring relink identical to elimination, awarding the hunter the victim's prey.

---

## 9. Comprehensive Test Plan

### A. Unit Tests
- Hamiltonian single-cycle permutation generator: verify for any $N \in [3, 20]$, the permutation is a single connected cycle with zero sub-loops and no self-assignments ($P_i \neq P_{\pi(i)}$).
- Relinking algorithm: verify that deleting any node $P_k$ from a cycle correctly splices $P_{k-1} \to P_{k+1}$.

### B. Simulator Tests (`scripts/sim/index.ts`)
- `assassin-ring` scenario ([lines 1731–1996](file:///c:/ASK_Main/ASK/Projects/GhostRun/scripts/sim/index.ts#L1731-L1996)):
  - Multi-player startup with 3+ players.
  - Verification of auto-generated safe zones.
  - Proximity warning triggers: verify amber pulse at 100 m, urgent red pulse at 40 m.
  - Safe zone immunity: verify `attempt_tag` returns `{success: false, reason: 'in_safe_zone'}`.
  - Tagging assigned prey outside safe zone: verify prey eliminated, hunter inherits prey's target.
  - Final showdown: verify last survivor elimination triggers match conclusion with winner `'solo'` and reason `'last_survivor'`.

### C. Access Control & RLS Tests (`scripts/rls-check.ts`)
- Hunter cannot query who is hunting them from `ring_assignments`.
- Hunter cannot query positions or pings of non-prey players.
- Negative test for Gap X-3: authenticated player attempting direct `select * from public.pings` in Assassin Ring must receive 0 rows for non-prey players.
- Outsider cannot read `ring_assignments`, safe zones, or game state.
- Post-game unsealing: all ring assignments readable by members only after round reaches `'ended'`.

### D. Physical Device Verification (`docs/PLAYTEST.md`)
- **Proximity Haptics:** Verify distinctive haptic cadence triggers in pocket when hunter enters 100 m and 40 m thresholds.
- **Screen Readability:** Verify high-contrast HUD displays prey display name legibly under bright sunlight.
- **Safe Zone Dwell Warning:** Test audio/visual countdown timer when entering safe zone.
- **Safe Zone Placement:** Confirm safe zones are verified $\ge 50\text{ m}$ away from roads and physical hazards.
- **SOS Response:** Verify emergency SOS immediately halts match for all solo assassins.
