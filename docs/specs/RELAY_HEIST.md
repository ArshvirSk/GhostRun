# B3 — Relay Heist Mode Specification

> **Status:** Draft — awaiting host approval before any code or migrations are written.  
> **MODES.md reference:** Section 4.5 (lines 482–498), compatibility matrix §2.3 (line 147), mode framework §2.1–2.2.  
> **Effort estimate:** M (1–2 weeks).

---

## 1. Rules (from MODES.md §4.5, with clarifications)

### Core concept
A virtual high-value package must be retrieved and escorted from the start zone to an extraction zone. The carrier is burdened and extra noisy, so the runners cannot sprint to the extraction alone. Teammates must execute physical handoffs between runners to keep the package moving. If the carrier is tagged, the package drops on the ground and becomes a public contest between runners recovering it and hunters securing it.

### Teams and players
- **Teams:** Runners and Hunters (`team = 'runner'` and `team = 'hunter'`).
- **Minimum:** 5 players (3 runners, 2 hunters) for production; test harness supports 3+ players (2 runners, 1 hunter).
- **Ideal:** 8 or more players.

### Setup & Extraction Zone
1. During lobby setup, players choose their teams (Runners vs Hunters).
2. The host sets the **Extraction Point** on the map (or the system auto-places it 60 m inside the boundary opposite the center).
   - An extraction entity is registered in `entities` (`kind = 'extraction'`, `visible_to = 'all'`).
   - Default extraction radius: $25\text{ m}$.
3. When the round starts (`start_game`):
   - The server selects one active runner as the initial **Carrier** (`is_carrier = true` in `status_detail` / `entities`).
   - A package entity is spawned in `entities` (`kind = 'package'`) attached to the carrier's coordinates.
   - An event `carrier_designated` is emitted to runners, indicating who has the package.

---

## 2. Carrier Mechanics

1. **Carrier Visibility & Burden:**
   - **Teammates (Runners):** Always see who the current carrier is and their live marker.
   - **Hunters:** Do **not** see the package marker directly while carried. Hunters must infer who is carrying the package through visual sighting or the carrier's radar ping cadence.
2. **Amplified Radar Noise ($1.5\times$ Frequency):**
   - The carrier emits delayed scheduled radar pings at $1.5\times$ normal frequency (e.g. every $30\text{ s}$ instead of $45\text{ s}$ when `ping_interval_s = 45`).
   - Pings carry the standard delayed position of the carrier.
3. **Item Restriction:**
   - The carrier cannot claim Dead Drop items or activate speed/veil abilities while holding the package.
   - If a runner holding items receives the package, their item activation controls are disabled until the package is handed off.

---

## 3. Physical Handoff Mechanics

1. **Proximity Requirement:** Two active runners must be within **$5\text{ m}$** of each other with fresh GPS fixes ($\le 20\text{ s}$ old, accuracy $\le 30\text{ m}$).
2. **Two-Party Confirmation Flow:**
   - Carrier calls `request_handoff(p_game_id, p_target_player_id)`.
   - Receiver receives an instant on-screen prompt: *"Accept Package from [Carrier Name]"* with a $10\text{ s}$ countdown.
   - Receiver calls `confirm_handoff(p_game_id)`.
3. **Outcome:**
   - On confirmation within $10\text{ s}$ while within $5\text{ m}$:
     - The package carrier swaps to the receiver.
     - `package` entity updates `carrier_player_id`.
     - Both players enter a **$20\text{ s}$ handoff cooldown** (`handoff_cooldown_until = now() + interval '20 seconds'`) to prevent rapid ping-pong exploitation.
     - Event `package_handed_off` is broadcast to runners.

---

## 4. Tagging & Package Drop

1. **Tagging the Carrier:**
   - When a hunter tags the current carrier via `attempt_tag`:
     - The carrier is tagged out (`status = 'tagged'`).
     - The package immediately **drops** at the carrier's last known GPS position:
       $$\text{Package Position} = \text{Carrier.last\_position}$$
     - Package status transitions to `'dropped'`.
     - The dropped package becomes **publicly visible to all players** on the map (`visible_to = 'all'`).
     - An audible alert and `package_dropped` event are sent to all players.
2. **Carrier Disconnect / Offline Timeout:**
   - If the carrier provides no GPS fix for $> 60\text{ s}$ while live, `advance_game` automatically drops the package at their last recorded position to prevent game stalls.

---

## 5. Recovery vs Securing (The Drop Contest)

When the package is in `'dropped'` state:

1. **Runner Recovery (Pickup):**
   - Any active runner within **$10\text{ m}$** of the dropped package can call `pickup_package(p_game_id)`.
   - The package immediately returns to `'carried'` status with that runner as the new carrier.
   - The package marker becomes hidden again from hunters (`visible_to = 'runner'`).
   - Event `package_recovered` emitted to all players.
2. **Hunter Securing (Objective Capture):**
   - A hunter within **$10\text{ m}$** of the dropped package can initiate `start_securing_package(p_game_id)`.
   - The hunter must hold position within $10\text{ m}$ continuously for **$20\text{ s}$** (`securing_hold_s = 20`).
   - If a runner picks up the package or the hunter moves $> 10\text{ m}$ away during the hold, securing is cancelled.
   - Upon completing the $20\text{ s}$ hold, the hunter calls `complete_secure_package(p_game_id)`.
   - The package is secured, terminating the round with **Hunters Victory** (`winner = 'hunter'`, `end_reason = 'package_secured'`).

---

## 6. Win Conditions

| Winner | Condition | End Reason |
| :--- | :--- | :--- |
| **Runners** | Package carrier enters within $25\text{ m}$ of the Extraction Zone | `extraction_complete` |
| **Hunters** | Hunters secure the dropped package ($20\text{ s}$ hold) | `package_secured` |
| **Hunters** | All runners are tagged out | `all_tagged` |
| **Hunters** | Round timer expires before extraction | `time_expired` |

---

## 7. Architecture & Database Schema

### 7.1 Database Entities & Columns
- **Mode ID:** `'relay_heist'` in `game_mode` enum and `mode_catalogue`.
- **`public.entities` Integration:**
  - `kind = 'package'`:
    - `team = 'runner'`
    - `geog`: Current carrier fix (or dropped coordinates)
    - `visible_to`: `'runner'` while carried; `'all'` while dropped
    - `state`:
      ```json
      {
        "status": "carried" | "dropped",
        "carrier_player_id": "uuid",
        "dropped_at": "timestamptz | null",
        "dropped_geog": { "lng": 0, "lat": 0 },
        "handoff_pending_to": "uuid | null",
        "handoff_expires_at": "timestamptz | null",
        "securing_hunter_id": "uuid | null",
        "securing_started_at": "timestamptz | null"
      }
      ```
  - `kind = 'extraction'`:
    - `geog`: Coordinates of extraction point
    - `visible_to`: `'all'`
    - `state`: `{ "radius_m": 25 }`

### 7.2 Security Definer RPCs
1. `set_extraction_location(p_game_id uuid, p_lat float8, p_lng float8, p_radius_m int default 25)`: Host sets extraction coordinates during lobby.
2. `request_handoff(p_game_id uuid, p_target_player_id uuid)`: Carrier initiates handoff to nearby runner ($\le 5\text{ m}$).
3. `confirm_handoff(p_game_id uuid)`: Target runner confirms handoff within $10\text{ s}$.
4. `pickup_package(p_game_id uuid)`: Active runner claims dropped package within $10\text{ m}$.
5. `start_securing_package(p_game_id uuid)`: Hunter initiates securing hold on dropped package ($\le 10\text{ m}$).
6. `complete_secure_package(p_game_id uuid)`: Hunter finalizes securing after $20\text{ s}$ hold.

---

## 8. Decisions for Host Approval

### D12: Extraction Zone Visibility to Hunters
- **Option A (Recommended):** Visible to both teams from round start. Creates a strategic objective: hunters can patrol transit corridors or set up ambushes near extraction, while runners must coordinate feints and handoffs to break through.
- **Option B:** Hidden from hunters until the package has been handed off at least once or until carrier is within $100\text{ m}$ of extraction.
- **Recommendation:** **Option A**. GhostRun's delayed pings ensure hunters do not know the exact approach path, while public extraction provides a clear goal for both teams.

### D13: Carrier Frequency Modifier
- **Setting:** Carrier pings every $30\text{ s}$ when default runner ping interval is $45\text{ s}$ ($1.5\times$ cadence).
- **Recommendation:** Keep as host-tunable setting `carrier_ping_multiplier = 1.5` (default 1.5).

### D14: Package Drop Expiry
- If the dropped package is not claimed by runners or secured by hunters within $60\text{ s}$:
- **Option A (Recommended):** Package stays dropped at that spot until picked up or secured. Every $15\text{ s}$ after the initial $60\text{ s}$, a radar pulse pings all players to drive engagement.
- **Option B:** Round immediately ends.
- **Recommendation:** **Option A**. Never end games abruptly on idle drops; maintain high tension.

---

## 9. Safety Review
- **No sprinting rewarded:** Handoffs require stationary/close proximity ($5\text{ m}$) and mutual confirmation. Securing requires holding position for $20\text{ s}$.
- **Extraction placement:** Host is warned not to place extraction points near roadways, bodies of water, or private property (enforced minimum distance inside boundary).
- **Safety overrides:** SOS, speed vehicle detection ($> 8\text{ m/s}$), and mock GPS flagging operate continuously.
