# Double Agent Role Add-on Specification (VM1 Verified)

> **Document Status:** Complete & Verified (`VM1: Spec check`)  
> **Target Role:** `double_agent` (Double Agent Role Add-on)  
> **Compatible Base Modes:** `classic_chase`, `tag_hunt`, `jailbreak`, `relay_heist` (docs/MODES.md §2.3, §5.1)  
> **Source Specification:** [`docs/MODES.md` §5.1](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/MODES.md#L531-L548) & [`docs/DECISIONS.md`](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/DECISIONS.md#L155-L162)  
> **Effort Estimate:** S–M (0.5 day for VM2 fixes)  

---

## 1. Executive Forensic Summary: Dispelling the Discrepancy

The verification protocol posed the following direct question:
> *"Double Agent: the spec has a hunter secretly working for the runners (powers: Whisper reveals the target's quadrant, Scramble shifts one ping, hunters can call a Tribunal vote). A summary describes a saboteur embedded in the runner team who transmits coordinates to hunters. Which is built? What are the powers, limits and secrecy rules?"*

### Forensic Determination:
1. **Which version is built in the codebase?**
   - The codebase implements **EXACTLY the spec version**: **a hunter secretly working for the runners**.
   - The summary describing "a saboteur embedded in the runner team who transmits coordinates to hunters" was **completely unverified, inaccurate, and does not exist in any migration, RPC, or UI file**.
2. **Assignment & Powers:**
   - **Assignment:** During `start_game`, if `double_agent` is active and there are $\ge 2$ active field hunters, the server randomly selects exactly one hunter and assigns them `secret_role = 'agent'`. If fewer than 2 hunters exist, the role is automatically disabled with a warning event ([`supabase/migrations/20261118006000_r3_fix_canonical_game_state.sql#L190-L208`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261118006000_r3_fix_canonical_game_state.sql#L190-L208)).
   - **Power 1 — Whisper (`agent_whisper`):** In Classic Chase mode, the Agent receives the approximate **cardinal quadrant** (`North`, `East`, `South`, `West`) of the runners' secret extraction target relative to the play area center. Single-use per match ([`supabase/migrations/20261105000000_v2m5_double_agent.sql#L348-L413`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261105000000_v2m5_double_agent.sql#L348-L413)).
   - **Power 2 — Scramble (`agent_scramble`):** The Agent designates one active runner. That runner's next scheduled radar ping is shifted by **150 to 250 m** in a random direction, clamped within the game boundary ([`supabase/migrations/20261108000000_s1_security_fairness_timing.sql#L464-L545`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261108000000_s1_security_fairness_timing.sql#L464-L545)).
   - **Counter-play — Tribunal (`start_tribunal`, `cast_vote`, `evaluate_tribunal`):** Once per match, any active hunter can convene an emergency tribunal against a fellow hunter suspect. All active hunters vote to Eject or Dismiss:
     - **Guilty (True Agent Ejected):** Accused is eliminated (`status = 'tagged'`), and hunters are immediately awarded a **bonus ping round** ([`20261105000000_v2m5_double_agent.sql#L81-L113`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261105000000_v2m5_double_agent.sql#L81-L113)).
     - **Innocent (Loyal Hunter Ejected):** Hunters' next scheduled ping is delayed by one interval (`ping_interval_s`), and the falsely accused hunter is silenced for 5 minutes (`silenced_until = now() + interval '5 minutes'`) ([lines 115–123](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261105000000_v2m5_double_agent.sql#L115-L123)).
     - **Tie / Dismissal:** The accused is acquitted; no penalties apply.
3. **Win Condition:**
   - The Double Agent shares the **runners' win condition** ([`MODES.md` §5.1 line 542](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/MODES.md#L542)).

---

## 2. Rules Comparison: MODES.md §5.1 vs Implementation

| Rule Aspect | MODES.md §5.1 Specification | Implemented Behaviour | Status / Difference ID | Resolution Recommendation |
|---|---|---|---|---|
| **Pitch & Role Concept** | One hunter secretly works for the runners. Trust is part of the game. | Implemented: 1 hunter assigned `secret_role = 'agent'`. Shares runners' win condition. | Matching | **Keep as implemented** |
| **Role Assignment** | Server picks one hunter (random, or host-chosen) as Agent. Only Agent knows. | `start_game` picks 1 active field hunter via `order by random() limit 1`. Requires $\ge 2$ field hunters. If $< 2$ field hunters, removes `double_agent` from roles and emits warning event. Excludes remote operators (`not p.is_remote`). | Matching | **Keep as implemented** |
| **Power: Scramble** | Shift the next ping of one chosen runner by 150 to 250 m. | `agent_scramble(game_id, runner_id)` verifies agent role, charges, and arming. However, in `advance_game` (migrations 143–150), ping loop queries `entities where kind = 'scramble'` instead of checking `target_runner.status_detail->'scramble'`. | **X-18 (High Severity)** | **Fix in VM2:** Restore canonical check in `advance_game` so `status_detail ? 'scramble'` actually displaces the runner's ping by 150–250 m |
| **Power: Whisper** | Receive approximate quadrant (N/E/S/W of area centre) of runners' target in Classic mode. Single use. | `agent_whisper(game_id)` verifies Classic Chase mode, calculates `st_azimuth` between `area_center` and target coordinate, maps to North (315–45°), East (45–135°), South (135–225°), West (225–315°). Sets `whisper_available = false`. | Matching | **Keep as implemented** |
| **Hunter Counter-play: Tribunal** | Once per game, hunters vote on suspect. Ejecting real Agent gives immediate bonus ping round. Ejecting loyal hunter loses one ping round and silences accused for 5 min. | Implemented via `tribunals` table and `start_tribunal`, `cast_vote`, `evaluate_tribunal`. Once-per-game enforced (`tribunals_game_idx`). Majority threshold $> \text{active\_hunters} / 2$. Ejecting agent sets `status = 'tagged'` and triggers immediate ping release. Ejecting loyal adds `ping_interval_s` to `next_ping_at` and sets `status_detail->>'silenced_until'` for 5 min. | Matching | **Keep as implemented** |
| **Double Agent Win Condition** | Shares the runners' win condition. | Evaluated post-match: Double Agent is scored as a victor if runners win. In recap stats (`get_game_stats`), surviving without being tribunal-ejected awards the `best_bluff` ("Undetected Mole") highlight ([`docs/DECISIONS.md` line 398](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/DECISIONS.md#L398)). | Matching | **Keep as implemented** |
| **Scramble Configuration** | Agent powers (one use each). | Implemented with configurable `scramble_charges` (default 1) and `scramble_cooldown_s` (default 120 s) in `mode_params->'double_agent'`. | **X-19 (Minor Variance)** | **Keep as implemented** (default 1 use strictly matches spec) |

---

## 3. Code & Migrations Inventory

### Database Migrations
- [`supabase/migrations/20261102000000_v2m2_mode_schema.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261102000000_v2m2_mode_schema.sql): Sets `feature.role.double_agent = true` in `app_settings`; registers `double_agent` in `role_catalogue()` and mode compatibility.
- [`supabase/migrations/20261105000000_v2m5_double_agent.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261105000000_v2m5_double_agent.sql): Core Double Agent implementation: creates `public.tribunals` table and RLS policy; creates `evaluate_tribunal`, `start_tribunal`, `cast_vote`, `agent_scramble`, `agent_whisper`, and `get_my_status`.
- [`supabase/migrations/20261108000000_s1_security_fairness_timing.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261108000000_s1_security_fairness_timing.sql): Adds charge counter and cooldown timer guards to `agent_scramble`.
- [`supabase/migrations/20261118006000_r3_fix_canonical_game_state.sql`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261118006000_r3_fix_canonical_game_state.sql): Restores Double Agent role assignment in canonical `start_game` ([lines 190–208](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261118006000_r3_fix_canonical_game_state.sql#L190-L208)).

### Server RPCs
- `public.agent_whisper(game_id uuid)`: Computes and returns target cardinal quadrant to Double Agent in Classic Chase. Single-use enforcement.
- `public.agent_scramble(game_id uuid, runner_id uuid)`: Arms ping scramble on target runner. Verifies caller is active agent, charges $> 0$, and cooldown expired.
- `public.start_tribunal(game_id uuid, accused_hunter_id uuid)`: Convenes hunter tribunal. Enforces once-per-game constraint, live phase, caller active hunter, accused active hunter, and rejects self-accusation.
- `public.cast_vote(game_id uuid, vote boolean)`: Records hunter vote on active tribunal. Calls `evaluate_tribunal`.
- `public.evaluate_tribunal(tribunal_id uuid)`: Internal security-definer helper. Calculates majority vote, applies ejection/silence/penalty, and releases bonus pings.
- `public.get_my_status(game_id uuid)`: Returns caller's private state, including `secret_role`, `agent_powers`, and active `tribunal` status.

### Client UI Components
- [`src/components/GameModifiers.tsx` lines 1105–1205](file:///c:/ASK_Main/ASK/Projects/GhostRun/src/components/GameModifiers.tsx#L1105-L1205):
  - `AgentDock`: Renders exclusively for `status?.secret_role === 'agent'`.
  - Blue radar action button ("Scramble Ping" / "Scramble Used"). Tapping displays runner selection picker.
  - Blue compass action button ("Whisper Target" / "Whisper Used"). Tapping displays prominent cyan banner: *"Secret Target is in the [North/East/South/West] quadrant"*.
- [`src/components/GameModifiers.tsx` lines 1210–1325](file:///c:/ASK_Main/ASK/Projects/GhostRun/src/components/GameModifiers.tsx#L1210-L1325):
  - `TribunalDock`: Renders exclusively for active hunters when `double_agent` is enabled.
  - If no active tribunal: displays "CONVENE TRIBUNAL" button with suspect selection picker.
  - If tribunal in progress: displays red gavel alert card with accused suspect's name and "Eject" vs "Innocent" voting buttons.

---

## 4. Parameters, Defaults, and Ranges

| Parameter | Default | Range / Constraints | Defined In | Description |
|---|---|---|---|---|
| `scramble_displacement_m` | `150–250` | $150\text{ m} + \text{random}() \times 100\text{ m}$ | `advance_game` | Radial distance target runner's next scheduled ping is shifted from true position. |
| `scramble_boundary_buffer_m` | `20` | $\text{area\_radius\_m} - 20\text{ m}$ | `advance_game` | Inward margin ensuring fuzzed pings never spawn across or outside the boundary. |
| `scramble_charges` | `1` | $\ge 1$ (default 1) | `start_game` / `mode_params` | Number of times the Double Agent can scramble runner pings per round. |
| `scramble_cooldown_s` | `120` | Fixed at 120 s | `start_game` / `mode_params` | Cooldown required between successive scramble activations if multiple charges are configured. |
| `whisper_uses` | `1` | Fixed at 1 use | `agent_whisper` | Maximum uses of target quadrant reveal per round. |
| `min_field_hunters` | `2` | $\ge 2$ active field hunters | `start_game` | Minimum active field hunters required to activate the Double Agent role. |
| `tribunal_uses` | `1` | Strictly 1 per match | `start_tribunal` | Maximum number of tribunals that may be convened per round. |
| `tribunal_majority_pct` | `> 50%` | Strictly $> \text{active\_hunters} / 2$ | `evaluate_tribunal` | Proportion of affirmative votes required to convict and eject the accused. |
| `loyal_eject_silence_s` | `300` | Fixed at 5 minutes (300 s) | `evaluate_tribunal` | Duration falsely convicted hunter is silenced (`silenced_until`). |
| `loyal_eject_ping_penalty` | `1 interval`| `+ ping_interval_s` | `evaluate_tribunal` | Time added to `next_ping_at` following wrongful execution of a loyal hunter. |

---

## 5. Concurrency, Races, and Failure Modes

1. **Simultaneous Tribunal Accusations:**
   - Two hunters attempt to convene tribunals against different suspects at the exact same moment.
   - **Protection:** Handled safely via PostgreSQL row lock on `tribunals` and table check `select * from tribunals where game_id = current_game.id`. The second call raises `'Tribunal has already been held in this game.'`.
2. **Voting Concurrency & Deadlocks:**
   - Multiple hunters submit votes concurrently via `cast_vote`.
   - **Protection:** `cast_vote` executes `select * into current_tribunal from tribunals where game_id = p_game_id for update`. Updates to `votes` JSONB and transitions to `'concluded'` serialize cleanly.
3. **Double Agent Offline / Disconnection:**
   - If the assigned Double Agent drops connection or quits before using abilities:
   - **Protection:** Abilities expire silently. Because Double Agent is an unrevealed role during play, the hunting pack simply continues normal hunting gameplay. If a tribunal convenes against the offline agent, votes are tallied normally against remaining active hunters.
4. **Tied Tribunal Vote:**
   - Voting concludes with an exact tie (e.g. 1 Yes, 1 No in a 2-hunter game).
   - **Protection:** Strict majority (`yes_votes > active_hunters_count / 2`) is required for ejection. A tie results in acquittal (`outcome = 'dismissed'`); no penalties are assessed.

---

## 6. Secrecy & Privacy Architecture

```mermaid
flowchart TD
    subgraph Clients["Clients"]
        DA[Double Agent (Hunter)]
        LH[Loyal Hunter]
        R[Runner Squad]
    end

    subgraph SecurityBoundary["PostgREST RLS & Column Grants"]
        CSR[Column Grant: players.secret_role revoked from anon/auth]
        GMS[get_my_status Security Definer]
        TRB[tribunals Table RLS: Hunter Members Only]
        EVT[events Table Audience Filtering]
    end

    DA -->|Calls| GMS
    GMS -->|Returns secret_role: 'agent'| DA
    LH -->|Calls| GMS
    GMS -->|Returns secret_role: null| LH

    DA -->|Calls agent_whisper| WhisperRes[Quadrant: 'North']
    LH -.->|Calls agent_whisper: REJECTED| WhisperRes

    LH -->|Reads tribunals| TRB
    DA -->|Reads tribunals| TRB
    R -.->|Reads tribunals: BLOCKED by RLS| TRB

    EVT -->|Audience: 'hunter'| LH
    EVT -->|Audience: 'hunter'| DA
    EVT -.->|Audience: 'hunter': BLOCKED| R
```

1. **Column-Level Revocation:**
   - Direct SELECT grants on `players.secret_role` and `players.status_detail` are revoked from `anon` and `authenticated`.
   - Neither teammate nor opponent can select secret roles through PostgREST. The owner reads their role exclusively via `get_my_status()`.
2. **Post-Game Unmasking:**
   - In `get_game_state`, `players.secret_role` returns `null` for all other players while the round is active. It is unmasked for the entire roster only when `current_game.status in ('ended', 'cancelled')` ([`supabase/migrations/20261118006000_r3_fix_canonical_game_state.sql#L651-L655`](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261118006000_r3_fix_canonical_game_state.sql#L651-L655)).
3. **Tribunal Secrecy:**
   - RLS policy `tribunals_hunter_member` on `public.tribunals` enforces `public.is_member(game_id) and public.my_team(game_id) = 'hunter'`.
   - Runners cannot query, subscribe to, or inspect the `tribunals` table.
   - Events `tribunal_started` and `tribunal_concluded` specify `audience = 'hunter'`.
4. **Whisper Secrecy:**
   - `whisper_revealed` event specifies `audience = 'hunter'` and `target_player = me.id`. Only the Double Agent receives the whisper dispatch; other hunters and runners receive nothing.

---

## 7. Environmental & Player Safety Review

1. **Coarse Intelligence Prevents Road Pursuit:**
   - `agent_whisper` delivers only a broad quadrant (`North`, `East`, `South`, `West`). It never gives coordinates, distances, or bearings to the target, preventing reckless driving or street sprints.
2. **Boundary Safety on Scramble Displacement:**
   - `advance_game` shifts pings by 150–250 m, but explicitly enforces an inward safety buffer (`greatest(0, area_radius_m - 20)`).
   - Scrambled pings are guaranteed to remain well inside the designated park boundary, preventing hunters from being lured toward roads, highways, or water hazards.
3. **Emergency SOS & Pause Integration:**
   - SOS distress immediately pauses the game for all players, freezing the tribunal vote clock and disabling all agent abilities until cleared.
4. **Player Policy:**
   - Double Agent is strictly restricted to players 18+ or under guardian supervision. No minors features exist.

---

## 8. Abuse & Cheating Vectors

1. **Hunter Pack Collusion / Frivolous Tribunals:**
   - *Threat:* Hunter group griefs another player by immediately ejecting them at round start.
   - *Mitigation:* Wrongful conviction imposes a severe double penalty on the hunters: immediate delay of their next radar ping by one full interval and silencing of the ejected player for 5 minutes. Frivolous voting cripples the hunting team's radar capabilities.
2. **Double Agent Throwing / Griefing:**
   - *Threat:* Double Agent refuses to use abilities or behaves maliciously.
   - *Mitigation:* If the Agent uses no powers, gameplay is identical to a standard hunter game. The Agent has no ability to expose runner coordinates or harm runners.
3. **Out-of-Band Text Messaging:**
   - *Threat:* Double Agent reveals their identity to runners over WhatsApp/SMS.
   - *Mitigation:* Trust and counter-intelligence are the core design philosophy of the mode. Out-of-band communication is a social dynamic of social-deduction games (like Mafia/Werewolf).

---

## 9. Test Plan & VM2 Fix List

### Test Plan:
1. **Automated RLS Secrecy Matrix (`scripts/rls-check.ts`):**
   - [ ] Runner cannot select rows from `public.tribunals` under RLS.
   - [ ] Outsider cannot select rows from `public.tribunals`.
   - [ ] Non-hunter calling `start_tribunal` is rejected.
   - [ ] Non-hunter calling `cast_vote` is rejected.
   - [ ] Hunter calling `start_tribunal` on self is rejected.
   - [ ] Hunter calling `agent_whisper` when not Double Agent is rejected.
   - [ ] Hunter calling `agent_scramble` when not Double Agent is rejected.
   - [ ] Double Agent calling `agent_whisper` a second time is rejected.
   - [ ] Convening a second tribunal in the same match is rejected.
2. **Simulator Scenario (`scripts/sim/index.ts` `doubleAgentScenario`):**
   - [ ] Verify `start_game` assigns exactly 1 Double Agent when $\ge 2$ field hunters present.
   - [ ] Verify `agent_whisper` returns cardinal quadrant of target.
   - [ ] Verify `agent_scramble` arms displacement on chosen runner.
   - [ ] Verify `advance_game` ping release actually applies 150–250 m displacement when scramble is armed.
   - [ ] Verify `start_tribunal` and `cast_vote` majority voting and ejection.
3. **Physical Playtest Checklist:**
   - [ ] Update [`docs/PLAYTEST.md`](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/PLAYTEST.md) §3.8 with physical device checklist for Double Agent & Tribunal.

### Fix List for VM2:
1. **Reconcile Scramble Ping Displacement in `advance_game`:**
   - Author migration 152 (`supabase/migrations/20261118012000_vm2_double_agent_advance_game_canonical.sql`) or update canonical `advance_game` so that `(runner.status_detail ? 'scramble')` is inspected and consumed during ping release, applying the 150–250 m displacement as specified.
2. **Add RLS Test Coverage:**
   - Add Double Agent and Tribunal test block to `scripts/rls-check.ts`.
3. **Update Playtest Checklist:**
   - Enhance `docs/PLAYTEST.md` §3.8.
