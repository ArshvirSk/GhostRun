# B1 — Jailbreak Mode Specification

> **Status:** Draft — awaiting host approval before any code is written.
> **MODES.md reference:** Section 4.1 (lines 262–293), compatibility matrix §2.3, mode framework §2.1–2.2.
> **Effort estimate:** M (1–2 weeks).

---

## 1. Rules (verbatim from MODES.md §4.1, with clarifications)

### Core concept
Classic manhunt with a respawn mechanic. Tagged runners are **not eliminated**—they are jailed, and teammates can free them.

### Teams and players
- **Teams:** Runners and Hunters (same as Classic Chase / Tag Hunt).
- **Minimum:** 5 players.  **Ideal:** 8+.

### Setup
1. The **host** places the **jail** on the map during lobby/setup, inside the play area, in an open public place.
2. The jail marker and its radius circle are visible to **all players** at all times.
3. There is **no secret target** in Jailbreak (unlike Classic Chase).

### Tagging
- A tagged runner's status becomes **`jailed`** (not `tagged`/eliminated).
- The existing `attempt_tag` proximity + freshness + cooldown rules apply unchanged.
- A jailed runner must walk to the jail and stay within the jail radius.

### Rescue
- A **free** runner stands within **`release_radius_m`** (default 10 m) of the jail entity for **`release_hold_s`** (default 10 s) continuously—pressing and holding a button.
- On successful hold, **all currently jailed runners** are freed simultaneously (status → `active`).
- While holding, the rescuer is exposed and taggable. If the rescuer is **tagged during the hold**, the rescue attempt is cancelled.
- Only one rescue attempt can run at a time per player (no double-starts).

### Auto-release
- After **`auto_release_s`** (default 300 s / 5 min) of jail time, a jailed runner is automatically released back to `active`.
- This prevents anyone from sitting out for the entire match.

### Win conditions
| Winner | Condition |
| :--- | :--- |
| **Hunters** | All runners are `jailed` at the same time (checked on every tag and every `advance_game` tick). |
| **Runners** | Timer expires with at least one runner `active` (free). |

### Edge cases
- **Jailed player leaving jail radius:** Warn via boundary-style alert. If they leave for >30 s, auto-release them without the rescue mechanic (they simply return to `active`). This prevents griefing by refusing to stay in jail.
- **Simultaneous tag and rescue:** Row lock on the runner being rescued; tag wins if its timestamp is earlier than the rescue completion.
- **Jailed players' visibility:** Jailed players can still see teammates' live positions, ping history, and the jail marker. They are spectating but not eliminated.
- **Pings:** Jailed runners are **excluded** from scheduled ping snapshots (they're at a known location—the jail).
- **Heat presses (Hot & Cold modifier):** Jailed and frozen runners are excluded from nearest-runner calculations (per MODES.md §4.2 line 391).
- **Noise Meter:** A jailed runner's noise resets to 0 and does not accumulate while jailed.

### Optional rule: Jail guards (deferred)
Up to 2 hunters assigned as guards, restricted to a 60 m radius of the jail. **Not implemented in B1**—this is a tuning lever for a future iteration after field testing. Document it in `mode_params` as a reserved key.

---

## 2. Differences from Backlog Description

| Backlog wording | MODES.md spec | Resolution |
| :--- | :--- | :--- |
| "holding zone, teammates rescue" | §4.1 specifies jail entity placement, 10 m / 10 s hold-to-rescue, auto-release after 5 min, and all-jailed win condition. | Implement the full spec. |
| No mention of jail guards | §4.1 lists "Optional rule: Jail guards" with a 60 m restriction radius. | Defer to post-field-test iteration. Reserve `mode_params.jailbreak.guard_radius_m` key. |

No contradictions found between the backlog description and the spec.

---

## 3. Parameters and Defaults

| Parameter | Key in `mode_params.jailbreak` | Default | Range | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Jail radius | `jail_radius_m` | 15 | 10–50 | Radius around the jail entity where jailed runners must stay. |
| Rescue radius | `release_radius_m` | 10 | 5–25 | How close a free runner must be to the jail to initiate rescue. |
| Rescue hold time | `release_hold_s` | 10 | 5–30 | Continuous hold duration required to complete a rescue. |
| Auto-release time | `auto_release_s` | 300 | 120–600 | Seconds of jail time before automatic release. |
| Guard radius (reserved) | `guard_radius_m` | `null` | — | Not enforced in B1. Documented for future use. |

All other game parameters (play area radius, head start, duration, ping interval, tag radius, boundary grace) remain unchanged and are inherited from the shared game settings.

---

## 4. Schema Changes (single new migration)

### 4.1 Enum extensions
```sql
-- Add 'jailed' to player_status enum
alter type public.player_status add value if not exists 'jailed';

-- Add 'jailbreak' to game_mode enum
alter type public.game_mode add value if not exists 'jailbreak';

-- Update games.mode_id check constraint
alter table public.games drop constraint if exists games_mode_id_check;
alter table public.games add constraint games_mode_id_check
  check (mode_id in ('classic_chase', 'tag_hunt', 'haunted_map', 'ghost_duel', 'jailbreak'));
```

### 4.2 Columns on `players`
No new columns. Jailbreak uses existing infrastructure:
- `players.status = 'jailed'` (new enum value)
- `players.tagged_at` → repurposed as `jailed_at` (timestamp of when they were jailed; the column already exists and is set by the tagging flow)
- `players.status_detail` → stores `{ "free_started_at": "<timestamp>" }` for the rescuer's hold timer (already exists as a JSONB column from V2-M2)

### 4.3 Catalogue updates
Update the `mode_catalogue()` SQL function to include:
```json
{
  "id": "jailbreak",
  "layer": "base",
  "name": "Jailbreak",
  "teams": ["runner", "hunter"],
  "min_players": 5,
  "compatible_roles": ["double_agent", "operator"],
  "compatible_modifiers": ["noise_meter", "dead_drops", "hot_cold", "shrinking_zone", "qr_tagging"],
  "parameters": {
    "jail_radius_m": 15,
    "auto_release_s": 300,
    "release_hold_s": 10,
    "release_radius_m": 10
  }
}
```

### 4.4 Feature flag
```sql
insert into public.app_settings (key, value)
values ('feature.mode.jailbreak', 'true')
on conflict (key) do update set value = 'true';
```

### 4.5 Entities usage
Jail placement creates one `entities` row:
```sql
insert into public.entities (game_id, kind, geog, visible_to, state)
values (
  p_game_id,
  'jail',
  ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
  'all',
  jsonb_build_object('radius_m', v_jail_radius_m)
);
```

No new tables required. The `entities` table already supports `kind = 'jail'` (documented in MODES.md §2.2 line 114).

---

## 5. RPCs

### 5.1 `set_jail_location(p_game_id uuid, p_lat float8, p_lng float8)` — NEW
- **Caller:** Host only, during `lobby` or `target_selection` phase.
- **Validation:**
  - Coordinates must be within the game's play area boundary (`ST_DWithin`).
  - Game must have `mode_id = 'jailbreak'`.
  - Upserts (insert or replace) a single `entities` row with `kind = 'jail'`, `visible_to = 'all'`.
  - The jail should be placed at least 50 m inside the boundary edge (safety buffer for open public places).
- **Returns:** `{ jail_id: uuid, lat: float, lng: float }`.
- **Events:** Emits `jail_placed` event to audience `'all'`.

### 5.2 `start_game` — MODIFY
- For `mode_id = 'jailbreak'`:
  - Require that a jail entity exists for the game (otherwise reject with `'jail_not_placed'`).
  - Skip target-selection requirement (no secret target in Jailbreak).
  - Start phases: `countdown → head_start → live → ended` (same as Tag Hunt).

### 5.3 `attempt_tag` — MODIFY
- When `current_game.mode_id = 'jailbreak'`:
  - Find nearest runner where `status = 'active'` (not `jailed`—jailed runners can't be re-tagged).
  - On successful tag: set `status = 'jailed'`, `tagged_at = now()` (serves as `jailed_at`).
  - Cancel any in-progress rescue attempt by the tagged runner (clear their `status_detail.free_started_at`).
  - Emit `runner_jailed` event (audience `'all'`) instead of `runner_tagged`.
  - Win-check: count runners where `status = 'active'`. If 0, call `end_game(game_id, 'hunters', 'all_jailed')`.

### 5.4 `start_rescue(p_game_id uuid)` — NEW
- **Caller:** Free runner (`status = 'active'`, `team = 'runner'`), during `live` phase.
- **Validation:**
  - Caller must have a fresh position fix (≤20 s).
  - Caller must be within `release_radius_m` of the jail entity (PostGIS `ST_DWithin`).
  - At least one runner must be in `status = 'jailed'`.
  - Caller must not already have an active `free_started_at` in `status_detail`.
- **Action:**
  - Sets `status_detail = jsonb_set(status_detail, '{free_started_at}', to_jsonb(now()))` on the caller's player row.
  - Emits `rescue_started` event (audience `'runner'` only — hunters should not see this unless they spot the rescuer physically).
- **Returns:** `{ started: true, hold_s: <release_hold_s> }`.

### 5.5 `complete_rescue(p_game_id uuid)` — NEW
- **Caller:** Same free runner who called `start_rescue`.
- **Validation:**
  - Caller must still be `status = 'active'`.
  - `status_detail->>'free_started_at'` must exist and be at least `release_hold_s` seconds ago.
  - Caller must still be within `release_radius_m` of the jail (re-check proximity with current fix).
  - Caller's position fix must be ≤20 s old.
- **Action:**
  - All players with `status = 'jailed'` in this game are updated to `status = 'active'`, `tagged_at = null`.
  - Clear the caller's `status_detail.free_started_at`.
  - Emit `runners_freed` event (audience `'all'`) with count of freed runners.
  - Reset freed runners' noise values to 0 if Noise Meter is active.
- **Returns:** `{ freed: <count> }`.

### 5.6 `cancel_rescue(p_game_id uuid)` — NEW (internal + client-callable)
- Clears `status_detail.free_started_at` for the caller.
- Called explicitly by the client when the player releases the button, or implicitly by `attempt_tag` when the rescuer is tagged.
- Emits `rescue_cancelled` event (audience `'runner'` only).

### 5.7 `advance_game` — MODIFY
Add Jailbreak-specific logic in the `live` phase block:
1. **Auto-release check:** For each player where `status = 'jailed'` and `tagged_at + auto_release_s <= now()`:
   - Set `status = 'active'`, `tagged_at = null`.
   - Emit `runner_auto_released` event (audience `'all'`).
2. **All-jailed win check:** After auto-releases, count active runners. If 0 and at least one runner is jailed (i.e., no auto-releases happened this tick), call `end_game(game_id, 'hunters', 'all_jailed')`.
3. **Timeout:** On timer expiry, if at least one runner has `status = 'active'`, runners win. If all are `jailed`, hunters win.
4. **Ping exclusion:** Skip runners with `status = 'jailed'` when generating scheduled pings.

### 5.8 `get_game_state` — MODIFY
- Include the jail entity coordinates and radius in the game snapshot when `mode_id = 'jailbreak'`:
  ```json
  "jail": { "lat": ..., "lng": ..., "radius_m": 15 }
  ```
- Include `jailed_at` (from `tagged_at`) in the player list for jailed runners so the client can render the auto-release countdown.
- For jailed runners' own view: include a `jail_remaining_s` field computed as `auto_release_s - extract(epoch from now() - tagged_at)`.

### 5.9 `rematch_game` — No changes needed
The existing rematch copies `mode_id`, `mode_params`, and all settings. The jail entity is not copied—the host must place it again in the new lobby (intentional: the jail location may need to change for a different play session).

---

## 6. RLS Policies

### 6.1 Existing policies (no changes needed)
- `entities` RLS: The jail entity has `visible_to = 'all'`, so all game members can read it. Direct inserts are already revoked; only RPCs create entities.
- `players` RLS: The `status` column is in the granted SELECT list, so all members can see who is jailed vs active.
- `tags` RLS: Unchanged — tag records are readable by game members.

### 6.2 New RLS considerations
- `status_detail` is hidden by column grants. The `free_started_at` field is only readable by the rescuer through `get_game_state` (which returns it for the caller's own player).
- Jailed runners should not appear in `nearby_entities` ghost-proximity results (they're at a known location—the jail—and should not trigger NPC interactions).
- The `rescue_started` event is audience `'runner'` only; hunters must not see it.

### 6.3 New `rls-check.ts` rows to add
| Check | Assertion |
| :--- | :--- |
| Jail entity is visible to all members | Both runner and hunter can read the jail entity via `entities` table. |
| Outsider cannot see the jail entity | Outsider query returns 0 rows. |
| Jailed player status is visible to all members | Both teams see `status = 'jailed'` in the player roster. |
| Jailed runner is excluded from pings | After a runner is jailed, the next ping round does not contain them. |
| Free rescue event is runner-only | Hunter cannot read `rescue_started` events. |
| Runners freed event is visible to all | Both teams see `runners_freed` event. |
| Only free runners can start rescue | A jailed runner calling `start_rescue` is rejected. |
| A hunter cannot call start_rescue | Rejected with team check. |
| Auto-release triggers after timeout | Advancing time past `auto_release_s` releases the jailed runner. |
| All-jailed ends the game for hunters | Tagging the last free runner ends the game with `all_jailed`. |
| Timeout with active runner = runner win | Timer expiry with at least one active runner gives runners the win. |

---

## 7. UI Screens and Components

### 7.1 Lobby / Create (`app/create.tsx`, `app/lobby/[id].tsx`)
- **Create screen:** When `mode_id = 'jailbreak'` is selected, show a brief rules summary card.
- **Lobby screen:** Add a **"Place Jail"** button for the host. Opens a map-tap interface (similar to target placement in Classic Chase) with:
  - A draggable jail marker.
  - A 15 m radius circle visualization.
  - A 50 m inset boundary check (jail must be well inside the play area).
  - Confirmation button. Calls `set_jail_location`.
- Non-host players see the placed jail marker on their lobby map as a read-only indicator.
- The **Ready** button and **Start** button logic remain unchanged (C3 route-sharing prompt still required).

### 7.2 Live Game (`app/game/[id].tsx`)
- **Map layers:**
  - Render the jail entity as a distinct marker (e.g., a barred/locked icon) with a `jail_radius_m` circle overlay in a neutral or warning color.
  - Jailed runners' positions are shown at/near the jail (their GPS still uploads so compliance can be verified, but they appear with a "jailed" visual indicator).
- **Hunter HUD:** TAG button works as normal. Successful tags show "Runner jailed!" toast instead of "Runner tagged!".
- **Free Runner HUD:**
  - When within `release_radius_m` of the jail and at least one runner is jailed:
    - Show a **"HOLD TO RESCUE"** button with a circular progress indicator.
    - On press-and-hold: call `start_rescue`, begin a local 10 s countdown timer synced to `release_hold_s`.
    - On completion: call `complete_rescue`, play a success sound, show "Runners freed!" toast.
    - On release before completion or tag interruption: call `cancel_rescue`.
  - When no runners are jailed: rescue button is hidden.
- **Jailed Runner HUD:**
  - Eyebrow: `"JAILED"`.
  - Title: `"Walk to the jail and wait"`.
  - Subtitle: auto-release countdown timer (`jail_remaining_s`).
  - Location sharing continues (so their position near the jail is tracked).
  - They can see teammates' positions, pings, and the jail marker.
  - They **cannot** use the TAG or RESCUE buttons.
  - Visual treatment: dimmed/grayed HUD overlay similar to spectator mode but with the countdown.

### 7.3 Result (`app/result/[id].tsx`)
- **Winner banner:** "Runners Escaped!" or "Hunters Caught Everyone!".
- **End reason display:** `all_jailed` → "All runners were jailed", `time_expired` → "Time ran out".
- **Recap stats additions:**
  - "Times Jailed" per runner.
  - "Rescues Completed" per runner (count of successful `complete_rescue` calls).
  - "Longest Jail Streak" (longest single jail duration before being freed or auto-released).
- **Replay:** Jail events (`runner_jailed`, `runners_freed`, `runner_auto_released`) appear as timeline markers.

### 7.4 Mode Registry (`src/lib/modeRegistry.ts`)
Add Jailbreak to `FALLBACK_REGISTRY.modes`:
```typescript
{
  id: 'jailbreak',
  layer: 'base',
  name: 'Jailbreak',
  teams: ['runner', 'hunter'],
  min_players: 5,
  compatible_roles: ['double_agent', 'operator'],
  compatible_modifiers: ['noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'qr_tagging'],
  parameters: {
    jail_radius_m: 15,
    auto_release_s: 300,
    release_hold_s: 10,
    release_radius_m: 10,
  },
  enabled: true,
}
```

---

## 8. Safety Review

| Risk | Mitigation |
| :--- | :--- |
| **Jail placed near a road or unsafe area** | Enforce a 50 m inset from the play area boundary. Host receives a notice: "Place the jail in an open, safe area away from roads and private property." No automated road detection (not available without a geocoding API), so this is advisory + boundary inset. |
| **Jailed runners loitering in one spot** | Auto-release after 5 minutes prevents indefinite sitting. Boundary alert if they wander from the jail radius. |
| **Rescuer sprinting to the jail** | The 10 s hold time means arrival speed doesn't matter—you must stand still for 10 s. This **does not reward sprinting** (the hold is the bottleneck, not the approach). Noise Meter compatibility penalizes fast approach. |
| **Hunters camping the jail** | The optional jail-guard mechanic (deferred) addresses this. For B1, the auto-release timer is the countermeasure: camping is only viable for 5 minutes per jailed runner. Field testing will determine if guard restrictions are needed. |
| **SOS** | SOS button remains active for all players including jailed runners. |
| **Vehicle speed warning** | Unchanged — triggers for all players regardless of jailed status. |

---

## 9. Sim and RLS-Check Plan

### 9.1 New `scripts/sim/index.ts` scenario: `jailbreak`

| Test | What it verifies |
| :--- | :--- |
| Jailbreak game creates with jail placement | `create_game` with `mode_id = 'jailbreak'`, `set_jail_location` succeeds inside boundary. |
| Jail outside boundary is rejected | `set_jail_location` with coordinates outside play area returns error. |
| Start requires jail placement | `start_game` fails with `'jail_not_placed'` if no jail entity exists. |
| Round reaches live | Phase advances through countdown → head_start → live. |
| Tag sets status to jailed | `attempt_tag` sets target runner to `status = 'jailed'`. |
| Jailed runner excluded from pings | Next ping round does not contain the jailed runner. |
| Rescue hold validates proximity | `start_rescue` fails if caller is >10 m from jail. |
| Rescue hold validates duration | `complete_rescue` fails if <10 s have elapsed since `start_rescue`. |
| Successful rescue frees all jailed | After 10 s hold, `complete_rescue` sets all jailed runners to `active`. |
| Tag during rescue cancels it | If rescuer is tagged mid-hold, rescue is cancelled and rescuer becomes jailed. |
| Auto-release after timeout | `advance_game` releases a runner jailed for >300 s. |
| All-jailed ends game for hunters | Tagging the last active runner triggers `end_game('hunters', 'all_jailed')`. |
| Timer expiry with active runner = runner win | Clock expiry with one active runner triggers `end_game('runners', 'time_expired')`. |
| Timer expiry with all jailed = hunter win | Clock expiry with 0 active runners triggers `end_game('hunters', 'all_jailed')`. |
| Jailed runner cannot initiate rescue | `start_rescue` rejects a jailed caller. |
| Hunter cannot initiate rescue | `start_rescue` rejects a hunter caller. |

### 9.2 New `scripts/rls-check.ts` rows

(Listed in Section 6.3 above — 11 new security assertions.)

---

## 10. Compatibility with Existing Modifiers

| Modifier | Interaction | Notes |
| :--- | :--- | :--- |
| **Noise Meter** | ✅ Compatible | Jailed runners' noise resets to 0. Rescued runners start fresh at 0. |
| **Dead Drops** | ✅ Compatible | Jailed runners cannot claim drops (they're not `active`). Free runners can. |
| **Hot & Cold** | ✅ Compatible | Jailed runners excluded from nearest-runner calculations (per MODES.md §4.2). Pings at 3× interval. |
| **Shrinking Zone** | ✅ Compatible | Jail must be inside the original boundary. If the zone shrinks past the jail, jailed runners are auto-released. |
| **QR Tagging** | ✅ Compatible | QR tag on a free runner sets them to `jailed`. Jailed runners don't display a QR code. |
| **Double Agent** | ✅ Compatible | Agent is a hunter; can sabotage tags as normal. Tribunal mechanics unchanged. |

---

## 11. Implementation Order

1. **Migration:** Enum extensions, catalogue update, feature flag, `set_jail_location` RPC.
2. **Migration:** Modify `attempt_tag` for jailbreak mode, add `start_rescue` / `complete_rescue` / `cancel_rescue` RPCs.
3. **Migration:** Modify `advance_game` for auto-release, all-jailed checks, ping exclusion, timeout logic.
4. **Migration:** Modify `get_game_state` to include jail entity and jailed player metadata.
5. **Client:** Mode registry entry, lobby jail placement UI.
6. **Client:** Live game jail marker, jailed HUD, rescue hold button.
7. **Client:** Result screen recap stats and replay event markers.
8. **Tests:** `rls-check.ts` rows and `sim` scenario (committed alongside or before each migration).
9. **Docs:** Update `README.md`, `PLAYTEST.md`, `DECISIONS.md`, `CHANGELOG.md`.
