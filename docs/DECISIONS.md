# GhostRun — Decisions

## 2026-10-28 — Use OpenFreeMap Liberty for the initial map style

**Decision:** Use `https://tiles.openfreemap.org/styles/liberty` as the default MapLibre style, overridable through `EXPO_PUBLIC_MAP_STYLE_URL`.

**Reason:** It is compatible with MapLibre Native and does not require an API key, which keeps M0 setup simple and avoids adding a third-party credential. MapLibre's attribution control remains visible.

**Trade-off:** OpenFreeMap is a community-operated public service offered without an availability guarantee. Revisit the provider if field testing shows reliability issues or the app needs an SLA-backed map service.

## 2026-10-29 — End M1 at target selection, not the countdown

**Decision:** The lobby advances to `target_selection` for Classic Chase only, and `set_target` is its own RPC. Tag Hunt lobbies stay in `lobby` where players ready up. Neither mode starts a round yet.

**Reason:** The countdown, head start and live map belong to the gameplay milestone. Shipping a `countdown` status before those screens exist would leave players on a screen the app cannot render, and would make `set_ready` reject changes for a phase nobody can act in.

**Trade-off:** The host has no “start” action until the next milestone. The target screen states this in plain copy rather than offering a disabled button that looks broken.

**Superseded 2026-10-30:** the round-start milestone below adds the host start action and phases.

## 2026-10-30 — Server timestamps drive the round clock

**Decision:** `start_game` is host-only and starts a fixed 10-second countdown. It writes `head_start_at`, `live_at`, `ends_at` and `next_ping_at` once, and `advance_game` moves `countdown → head_start → live → ended` when those timestamps pass. `get_game_state` calls it before returning, so any member reading state keeps the phase current. Clients derive every timer from the snapshot's `server_time`, never the device clock.

**Reason:** Every player must see the same countdown even when phone clocks differ. Lazy advancement avoids depending on pg_cron before the location and ping loop exists; the next read after a deadline catches up, including across several phases at once.

**Trade-off:** With nobody reading state, the phase changes on the next read rather than exactly on time. The `live` window can also end by time expiry before target-reached and tag endings exist; Classic awards the win to hunters and Tag Hunt to runners, per `TRD.md`.

## 2026-10-30 — Live positions are team-only; hunters get scheduled pings

**Decision:** `submit_position` stores only the caller's fix and returns the phase. `get_game_state` includes the caller's own position and their teammates' positions, and includes opponents' positions only after the round ends. Pings are delayed snapshots of active runners, released by `advance_game` once per `ping_interval_s`, and both teams can read them (runners see exactly what hunters know).

**Reason:** The PRD's core promise is inference from delayed pings, not following a live dot. Filtering inside the security-definer snapshot and in RLS means a client cannot opt into opponent positions. Pings contain runners only, so showing them to runners leaks nothing.

**Trade-off:** Realtime `player_positions` rows reach teammates only; hunters rely on the `pings` insert to refresh. A runner with no stored fix is omitted from that ping round rather than appearing as an empty marker.

## 2026-10-30 — Ping release is lazy; uploads are latest-fix-wins

**Decision:** No pg_cron job is installed. Any member's `get_game_state` or `submit_position` call runs `advance_game`, which releases one ping round when `next_ping_at` has passed and then skips missed rounds instead of replaying them. The live screen reads state at the ping boundary, and runners upload every 5-10 s. `submit_position` upserts one position per player, appends a trail point at most every 10 s, clamps client timestamps to a 5-second future / 2-minute past window, emits one boundary warning per excursion, and releases one extra ping per excursion when the `extra_ping` penalty is configured. The phone keeps a foreground fallback uploader when background permission is refused and drops failed uploads in favour of the next fix.

**Reason:** Only the newest position matters for gameplay, and a bounded trail is enough for replay. Lazy release removes the scheduled-job dependency and still keeps pings accurate while at least one player is reading. Treating client clocks as untrusted keeps `position_age_s` honest. The fallback lets players who deny “all the time” location still share while the screen is open.

**Trade-off:** With nobody polling, a ping is released on the next read rather than exactly on schedule. Background tracking needs a development build and, on Android, the “Allow all the time” setting; the app shows a foreground-only notice when that is missing. There is no 50-point offline queue: an outage longer than one interval yields no snapshot for that runner, and the next round uses the newer fix.

## 2026-10-30 — The result screen reads trails through a recap RPC

**Decision:** `game/[id]` replaces itself with `result/[id]` when the round is `ended`. The result loads `get_game_state` for the winner, final positions and revealed target, then calls `get_game_trails` for the recorded routes. The RPC is member-only and refuses any game that is not ended; `trail_points` RLS keeps the same gate.

**Reason:** The live screen's job is over once the round ends, so the recap gets its own screen and camera. Trails are larger than the rest of the snapshot and are read once, so they do not belong in every `get_game_state` poll. The RPC is security definer because PostGIS coordinates are awkward to select through PostgREST, and the explicit status check keeps the secrecy rule in one server-side place.

**Trade-off:** The result makes one extra round trip after the state snapshot. The RPC caps the response at 30,000 points as a payload guard. Play again was still future work at that point; it now opens a fresh lobby (see below).

## 2026-10-30 — Tagging and arrival are server-authoritative endings

**Decision:** `attempt_tag` is hunter-only and live-only. It requires a fresh (under 20 s) hunter fix, finds the nearest active runner with a fresh fix inside `tag_radius_m` plus up to 10 m of average GPS accuracy, and returns only `{success:false, reason}` on failure. A failed attempt starts an 8-second cooldown; a successful tag records the tag, marks the runner `tagged`, emits `runner_tagged`, and ends the round `all_tagged` when no active runners remain. `submit_position` ends a Classic round `target_reached` when a runner's fix is inside `target_radius_m` of the secret target. Both paths call an internal `end_game` whose execute privilege is revoked from every API role. The live screen shows hunters a tag-radius ring and a TAG control; a tagged runner becomes a spectator and stops sharing location.

**Reason:** The round should be decided by what players actually do, not only by a clock. Keeping range, freshness and winner checks inside Postgres prevents a modified client from tagging from across the map or ending a round at will. Omitting distance and direction from failures preserves the inference game.

**Trade-off:** A successful tag does not start a cooldown, so a hunter standing among several runners can tag again immediately (the next runner must still be fresh and in range); only a failed tag starts the timer. Spectators see pings and teammate positions, but the screen does not yet name who tagged them; the `runner_tagged` event is the source for that feed.

## 2026-10-30 — Replay scrubs tags, pings and trails from server data

**Decision:** The result screen links to `replay/[id]`. The replay loads `get_game_state` for the round, `get_game_trails` for routes, and `get_game_replay` for every tag and released ping. `get_game_replay` is member-only and ended-only. The scrubber runs from `live_at` to `ended_at` (or `ends_at` when time expired), truncating trails, positions and pings at the playhead. Tags and pings are drawn as timeline markers; play advances at 1× or 10×.

**Reason:** The replay should show what the server recorded, not reconstruct gameplay from live state. One ended-only RPC keeps the tag and ping history complete and gives the screen display names, colors and coordinates without exposing raw PostGIS rows. Truncating client-side is cheap because the data is terminal and already bounded.

**Trade-off:** A tag record stores the distance between players, not the tag coordinates, so the map places a tag at the runner's last trail point at or before the tag; the exact spot can be up to one trail interval away. Playback is local rather than a shared synchronized stream, and the result's replay button is the only entry point beyond a deep link.

## 2026-10-30 — Play again opens one fresh lobby for the whole crew

**Decision:** `rematch_game(p_game_id)` is callable by any active member of an `ended` game, not only the host. The first press creates a new lobby with a new code and copies the mode, play area and every round setting. It inserts every player from the finished game whose status is not `left`, keeps their side, resets them to `active` with `is_ready = false`, and keeps the original host if they are still in the crew (otherwise the caller hosts). The old game stores the new id in `games.rematch_game_id`; later presses return that same lobby, and the result screen polls that pointer and replaces itself with the lobby for every player. A rematch cannot start until the source round is `ended`.

**Reason:** The result screen already knows the crew and settings, so a rematch should not require sharing another code or picking teams again. Making the RPC idempotent and locking the source row means two players pressing play again at once cannot create two lobbies. Letting any member press avoids a dead end when the host has stepped away.

**Trade-off:** Every non-left player is pulled into the new lobby, including one who quit mid-round and was recorded as tagged; they can leave again. Preserving sides also means a lopsided rematch stays lopsided until the host changes teams. A player who goes home before the rematch is created is still on the roster but gets no automatic redirect, because Home has no active-lobby resume yet.

## 2026-10-30 — Email and password replace anonymous onboarding

**Decision:** `app/auth.tsx` signs players up or in with an email and password. Sign-up then opens the existing welcome screen for display name, colour and the safety acknowledgement; sign-in goes straight to Home when a profile exists and to Welcome when it does not. Home gains a sign-out action. The app no longer calls `signInAnonymously`.

**Reason:** The hosted project has anonymous sign-ins disabled, so the previous onboarding could not create any player. Email/password is self-contained (no OAuth provider or extra SDK), keeps the profile step, and lets a crew return on a new install.

**Trade-off:** New accounts need a confirmation email until "Confirm email" is turned off or custom SMTP is configured, so first-run onboarding may pause at "Check your inbox". Existing anonymous sessions keep working until they sign out, but those accounts have no email and cannot be recovered afterwards; there is no account-linking migration.

## 2026-11-01 — Mode framework keeps the v1 enum beside mode_id (V2-M2)

**Decision:** `games.mode_id text` is the canonical v2 selector, defaulted to `classic_chase` and kept equal to the legacy `games.mode` enum by `create_game` and `rematch_game`. Roles and modifiers are validated server-side against one catalogue (`mode_catalogue`, `role_catalogue`, `modifier_catalogue`), first for existence and compatibility, then for the `app_settings` feature flag. Unimplemented items therefore report "not available yet", while an incompatible pair still reports the compatibility error even when both are disabled. `set_game_modes` lets the host change modifiers/roles in the lobby; the base mode stays on the create screen, matching the v1 flow.

**Reason:** the released APK reads the enum; changing it in place would be a risky type migration for zero benefit. Validating before flags makes the matrix testable while nothing is switched on. The feature flags are server-only rows (`app_settings`), so turning a mode on later is a data change, not a deploy.

**Trade-off:** two mode columns must stay in sync; both RPCs do it, and legacy rows are backfilled by the migration.

**Decision (secret per-player state):** `secret_role` and `status_detail` are hidden with column-level grants on `players` rather than row policies, because teammates share the same row. The owner reads them through `get_my_role`. Direct selects on those columns fail for everyone, including the owner. `entities` visibility supports runner/hunter/all; `'owner'` stays closed until an owner column exists.

**Decision (ping window):** the approved server-side enforcement is live: `get_game_state` returns a ping only if it was released in the last 10 seconds (or the game has ended, for the recap). `get_game_replay` keeps the full history.

**Decision (resources):** `start_game` seeds empty `player_resources` rows for active players and both `team_resources` rows, so later modifiers can read totals without null checks. `rematch_game` copies mode_id, roles, modifiers and mode_params, but resets each player's `share_trail` (C3 is per game).

## 2026-11-01 — Consent comes before new modes (V2-M1)

**Decision:** C3 (route sharing) is now required per game: `players.share_trail` starts NULL, the lobby shows a two-button sheet with no default, and both `set_ready` and `start_game` refuse to advance while any active player is still NULL. `consents` is append-only and has no client grants; the app reads state through `get_my_consents` and writes through `set_consent`. `trail_points` and `get_game_trails` reveal another player's route only when that player's `share_trail = true`; everyone always sees their own.

**Reason:** v1 showed every player's route to every member after a game, which is a privacy-relevant default. MODES.md 7.4 requires a deliberate, equal-choice prompt and least sharing by default.

**Trade-off:** routes recorded before this migration have `share_trail = NULL`, so other players no longer see them in old recaps. This is a deliberate privacy deviation from v1 behaviour: no consent, no sharing. New games in the current APK ask before ready-up and keep working.

**Decision (retention):** `cleanup_old_games()` deletes whole games ended more than 30 days ago, which cascades trails, pings, tags, events and positions. Consent rows and accounts survive. If pg_cron is not enabled, the migration leaves a notice and the operator schedules the same job from the dashboard.

**Decision (account deletion):** `delete_my_data()` first makes the caller leave any in-flight round (with leave-game win checks), passes on unfinished hosted games, then tries to delete the `auth.users` row. If the API role lacks that privilege, it still deletes the profile and every personal row and reports `account_removed: false`; the sign-in record then needs removing from the dashboard.

**Decision (ping lifespan enforcement):** the 10-second on-screen ping life stays. Server-side trimming of `get_game_state` is approved but deferred to V2-M2, where that function is replaced anyway for roles and `mode_id`.

## 2026-10-30 — Recovery links return to a dedicated reset screen

**Decision:** The auth screen offers "Forgot password?" and, for unconfirmed accounts, resends the confirmation with `auth.resend({ type: 'signup' })`. A reset request calls `resetPasswordForEmail` with `redirectTo: Linking.createURL('/reset-password')`. `app/reset-password.tsx` parses implicit (`#access_token`, `#refresh_token`) and PKCE (`?code`) payloads with `src/lib/authLink.ts`, establishes the session, and updates the password in place before routing to Home or Welcome.

**Reason:** Email is the only identity the app has, so a reset link that lands on the wrong screen or fails silently would lock a player out. Handling both link formats keeps the screen working whether the project uses the implicit or PKCE flow.

**Trade-off:** The redirect must be allowlisted for each environment, so a project without `ghost-run://reset-password` (or the Expo development URL) rejects the send. Resends share the mailer's rate limits with sign-up, and the recovery session signs the player straight in instead of forcing a second login.

## 2026-11-01 — Modifiers are server rules, not client flags (V2-M3)

**Decision (Noise Meter):** noise is an integer on `player_positions` whose status is drawn from an exponential moving average of speed over recent fixes (alpha 0.25, 5 s cadence) rather than a stored 15-second history. Fixes with accuracy over 50 m never raise the estimate. Crossing 100 releases an immediate `reason='noise'` ping and resets to 40; crossing 60 emits one `noise_spark` to hunters per crossing; four minutes inside 15 m emits a camping ping. `noise`, its alert latch, the anchor and the vehicle latches are hidden by column grants, and the owner reads the bar through `get_my_status` or the `submit_position` reply.

**Reason:** the spec's intent is a smooth loudness estimate; an EMA needs one row instead of a fix history and is immune to GPS spikes by construction. Column grants are the same technique used for `secret_role`, because teammates share the position row.

**Trade-off:** the decay is cadence-dependent when fixes are sparse, so a clamped 1–30 s delta is applied. The vehicle warning is derived from smoothed speed and is advisory only, not a fairness verdict.

**Decision (Dead Drops):** drops are `entities` rows with `visible_to='none'`; `nearby_drops` is the only reveal (40 m), and a hold is only valid if the server recorded its start (`start_drop_claim`), at least ~4 s ago, with a fresh fix inside 15 m. A claim is atomic on the drop row, rolls the item for the claimer's team, and writes `drop_claims` (server-only). Veil and Decoy are consumed by the scheduled ping loop; a rolled item is delivered only to the claimer, while the broadcast claim event carries the team and never a location. Reporting a drop deletes it and spawns a replacement.

**Reason:** client timers are not trustworthy for a hold, and drop positions are the most sensitive information the modifier creates.

**Trade-off:** items stack in `charges`, but Veil/Decoy cannot be primed twice at once (a second use is refused without consuming). Decoys are clamped back inside the original area, not the shrunken one.

**Decision (QR Tagging):** an HMAC-SHA256 key is generated by the migration into `server_secrets`, a deny-all table that only `SECURITY DEFINER` functions read. Tokens are `<player>.<expiry>.<sig>` with a 20 s TTL, bound to the game and runner, and one-time via a unique `qr_uses` hash. `apply_tag` is the single tag path shared with `attempt_tag`, so both endings mark, log and finish identically. The modifier flag stays **off** until the camera UI ships; the server is complete and tested by the simulator only behind a temporary flag.

**Reason:** the secret must never reach the client, and duplicated tag logic is how GPS and QR rules drift apart.

**Trade-off:** a token is single-use across all hunters, so a second hunter must wait for the runner's next code (≤20 s). Rotating the key is a manual delete of the `server_secrets` row; outstanding codes then fail.

**Decision (Shrinking Zone):** stage percentages come from `mode_params.shrinking_zone.stages` (default 100/70/45), are clamped to 10–100, and apply over the last third of `duration_s` in equal segments. `effective_radius_m` is the single boundary source for `submit_position`, `get_game_state` and the client's drawn circle; the stage and a 60-second pre-announcement are advanced lazily by `advance_game`. Only the radius moves, never the centre.

**Reason:** one derived radius keeps the drawn boundary and the enforced boundary identical, and the lazy clock avoids another scheduled job.

**Trade-off:** a round paused across a stage boundary will announce and shrink on the next read rather than at the exact wall-clock second; no data is lost.

## 2026-11-01 — Hot & Cold Hunt Variant A Proximity Engine (V2-M4)

**Decision (Hot & Cold Hunt Base Mode):** Implemented Variant A (Proximity pulse) with 5 charges per hunter and a 2-second cooldown. When a hunter activates `heat_press`, the server evaluates the distance to the nearest active runner with a fresh GPS fix: $\le 75\text{ m}$ returns `hot`, $75\text{ m} < \text{dist} \le 175\text{ m}$ returns `warm`, and $> 175\text{ m}$ returns `cold`. Hunters receive a `heat_mark` event with the result and their remaining charges. Runners within $175\text{ m}$ receive a `sensed` pulse event; all runners receive an advisory `heat_used` announcement without revealing the result.

**Reason:** Keeps the server-authoritative information asymmetry principle intact: the exact distance to the nearest runner is never exposed over the network, only the categorical band.

**Trade-off:** Hunters without a fresh fix (<20 s) cannot press; if runners have stale fixes (>30 s), the press safely returns `cold` rather than leaking location age. Base table `heat_presses` is locked during live play by RLS; hunters view marks through `heat_press_feed` view which strips `nearest_runner_m`.

## 2026-11-01 — Double Agent and Recap Stats Gating (V2-M5)

**Decision (Double Agent Role & Tribunal):** When `double_agent` is enabled in Classic Chase and there are at least two hunters, `start_game` secretly assigns one hunter `secret_role = 'agent'`. If fewer than 2 hunters are present, the role is automatically disabled with a warning event. The Double Agent receives two powers: Whisper (reveals the secret target's cardinal quadrant `North`/`East`/`South`/`West`, once per game) and Scramble (shifts a chosen runner's next scheduled ping by 150–250 m within the play boundary). Loyal hunters can call an emergency Tribunal against a suspect; a majority vote ejects the accused. Ejecting the true agent triggers an immediate bonus ping round; ejecting a loyal hunter penalizes hunters by delaying the next ping by one interval and silencing pulses for 5 minutes.

**Reason:** Creates psychological tension and counter-intelligence within the hunting pack without requiring external moderator oversight. The tribunal mechanic provides a high-stakes self-policing mechanism.

**Trade-off:** A Double Agent who does not use their abilities plays like a normal hunter; voting ties result in acquittal without penalty.

**Decision (Recap Stats & C3 Route Gating):** `get_game_stats(game_id uuid)` compiles match highlights including Closest Call, Longest Unseen Streak, Loudest Noise, Heat Hit Rate, and Drops Claimed. Closest Call calculation strictly respects user consent C3 (`share_trail`): if either player in the encounter declined route sharing (`share_trail = false`), `closest_call_m` returns `null` and the client renders "Private route". Secret roles are revealed only after the game reaches `ended`.

## 2026-11-01 — Field Playtest Status & Contact Verification

**Decision:** The user-confirmed contact email `arshvirsk26@gmail.com` is established across the privacy framework, settings, and documentation. Physical outdoor playtesting requires physical execution with 6+ players and explicit sign-off by the project owner; marked pending. External recurring cron execution (running `advance_active_games(10)` and `cleanup_old_games()` 30-day retention) is confirmed active.

## 2026-11-01 — Core Architecture Decisions (D1–D8)

### D1: Hot & Cold Result Representation (Binary Red/Blue)
- **What was approved:** Confirmed binary red/blue result representation (hot = closer, cold = farther). Shared team charge pool (6 charges, 30 s lazy regen), personal cooldown (10 s), radius fuzz (area-scaled, clamped 80–250 m, fuzzed ±15%), repeat-press rule, fading map heat marks layer (5 min expiry), and `heat_press_feed` view (stripping raw distance metrics).
- **What is implemented:** Binary red/blue representation in `public.heat_presses`, `heat_press_feed` view, and `app/game/[id].tsx`.
- **Status:** Ratified.

### D2: Modifiers Framework & Ping Multiplier
- **What was approved:** Confirmed Hot & Cold as a stackable modifier compatible with base modes (Classic Chase, Tag Hunt, Jailbreak, Relay Heist). When Hot & Cold modifier is active, `start_game` triples the scheduled ping interval (`ping_interval_s * 3`) by default to balance proximity pulses with delayed radar snapshots.
- **What is implemented:** Registered as stackable modifier in `modifier_catalogue()`, `ping_interval_s * 3` applied in `start_game`.
- **Status:** Ratified.

### D3: Ghost NPC Behaviour Modes (Haunt vs. Assist)
- **What was approved:** Added `games.ghost_mode` with values `'haunt'` (default) and `'assist'`.
  - **Haunt:** Ghost acts as an autonomous PvE hazard tagging runners within 12 m. Requires a 3-second continuous dwell time and discards fixes with GPS accuracy $> 30\text{ m}$ to prevent unfair drift tags.
  - **Assist:** Ghost emits `'ghost_sighting'` radar pings to hunters whenever an active runner is within 40 m of a ghost, in addition to the 12 m haunt tag.
  - Ghost entity speeds are strictly clamped to $\le 2.0\text{ m/s}$ with coordinate clamping inside the active play boundary.
- **What is implemented:** `games.ghost_mode` column, `spawn_ghost_npcs`, velocity clamps, and sighting pings in `advance_game`.
- **Status:** Ratified.

### D4: Scramble Power Configuration
- **What was approved:** Scramble is single-use by default. Host-configurable charges (1–3) and cooldown periods are supported via `mode_params.double_agent.scramble_charges` and `scramble_cooldown_s`.
- **What is implemented:** `agent_scramble` arms single-use scramble shifting pings by 150–250 m with bearing randomization.
- **Status:** Ratified.

### D5: Server-Side Ping Window Enforcement
- **What was approved:** Enforced `ping_visible_s` (default 10 s) server-side during live play via RLS policy on `public.pings` and within `get_game_state`. Expired pings are purged from live wire responses and cannot be queried during an active round; full ping history is revealed once the match reaches `ended`.
- **What is implemented:** Enforced in RLS policy `pings_hunter_window` and in `get_game_state` live query.
- **Status:** Ratified.

### D6: Game Clock, Automation & Retention Delay
- **What was approved:** Check whether `pg_cron` extension is available first; if available, schedule `advance_active_games(10)` on a 30-second schedule; maintain `health_ping()` as an idempotent keep-alive and fallback endpoint with internal shared-secret validation (`server_secrets.health_ping_secret`).
- **What is implemented:** `pg_cron` is enabled; job 2 runs `select public.advance_active_games(10)` every 30 seconds. `health_ping(body)` RPC exists as fallback, but `health_ping_secret` was not populated in `server_secrets` (allowing calls with arbitrary or empty secret).
- **Status:** Pending (propose configuring `health_ping_secret` in `public.server_secrets` to enforce shared secret rejection).

### D7: Guest Authentication & Privacy Architecture
- **What was approved:** Added guest sign-in (`supabase.auth.signInAnonymously()`) on `AuthScreen`. Guests are subject to the identical safety onboarding, consent gate (C1–C6), self-service data export (`export_my_data`), account deletion (`delete_my_data`), and explicit age confirmation: **"18 or older, or supervised by a guardian"**.
- **What is implemented:** Code paths for guest sign-in, self-service export, account deletion, and 18+ or guardian confirmation (`PRIVACY_VERSION = 2`) exist. However, remote Supabase project currently has anonymous sign-ins toggled off in Supabase dashboard.
- **Status:** Pending (requires enabling Anonymous Sign-Ins in Supabase Auth dashboard to activate guest authentication).

### D8: Cross-Platform Strategy
- **What was approved:** Confirmed continuous reuse of the unified Expo / React Native codebase for Android and future iOS releases. iOS platform validation is scheduled for Phase B item B13.
- **What is implemented:** Pure React Native / Expo codebase without Android-only binary dependencies that would prevent iOS builds.
- **Status:** Ratified.

## 2026-11-04 — B1: Jailbreak Base Mode (docs/MODES.md §4.1)

**Decision:**
1. **Base Mode Integration:** Added `jailbreak` base mode enum (`game_mode`) and mode catalogue entry (`jailbreak`). Validated server-side in `mode_catalogue` and exposed in `get_mode_registry`.
2. **Host Jail Placement:** Host sets jail location via `set_jail_location(p_game_id, p_lat, p_lng, p_radius_m)`. Stored in `entities` table (`type = 'jail'`, `visibility = 'all'`) and validated to be strictly within the active play boundary. `start_game` refuses to launch a Jailbreak game if no jail has been placed within bounds.
3. **Jailed Player Status:** Added `'jailed'` value to `player_status` enum. When a hunter tags a runner in Jailbreak:
   - If other active runners remain: runner transitions to `'jailed'`, `jailed_at = now()`, `active_rescuer_id = null`, and `runner_jailed` event is emitted. Jailed runners are excluded from scheduled radar pings and teammate location broadcasts.
   - If no active runners remain: round terminates immediately via `end_game(p_game_id, 'hunter', 'all_jailed')`.
4. **Stealth Rescue Operation:**
   - Rescuer must be an `active` runner with fresh GPS fix within `release_radius_m` (default 10 m) of jail center.
   - Rescuer initiates via `start_rescue(p_game_id)`. Emits `rescue_started` event visible to runners only (hunters are not notified, preventing camp baiting).
   - Rescuer must maintain fix within `release_radius_m` for at least `release_hold_s` (default 10 s).
   - Rescuer completes via `complete_rescue(p_game_id)`. Sets all jailed runners to `'active'` (`jailed_at = null`), emits `player_released` event with rescuer and player names, and awards stats.
   - Rescuer moving $> 10\text{ m}$ away or being tagged cancels the rescue.
5. **Passive Safeguards:**
   - `advance_game` checks `auto_release_s` (default 300 s / 5 min). Expired prisoners are automatically freed and restored to `active`.
   - Shrinking Zone Overrun: If the active safe zone shrinks past the jail perimeter (`dist(center, jail) + jail_radius > zone_radius`), `advance_game` immediately auto-releases all jailed runners to prevent trapped unwinnable states.
6. **Time Expiry Victory:** If match timer runs out while at least one runner is `active`, runners win (`time_expired`).

**Reason:** Matches the full specification in `docs/MODES.md` §4.1 while enforcing strict server-side authority, RLS secrecy, zero hunter leaks during rescue attempts, and graceful recovery from GPS drift or shrinking zone traps.

**Trade-off:** Hunters must balance guarding the jail with hunting free runners. The stealth rescue window ensures runners have realistic comeback potential without hunters camping the rescue button.

## 2026-11-04 — B2: Assassin Ring Base Mode (docs/MODES.md §4.3)

**Decision:**
1. **Base Mode Integration & Solo Team:**
   - Added `assassin_ring` value to `game_mode` enum and `'solo'` to `team_type` enum.
   - Registered `assassin_ring` in `mode_catalogue` with compatible modifiers `noise_meter`, `dead_drops`, `qr_tagging`, `shrinking_zone`.
   - In `assassin_ring`, players play as individuals (`team = 'solo'`).
2. **Ring Assignment & Secrecy:**
   - Implemented `ring_assignments` table: `(game_id, hunter_player_id, prey_player_id, status, assigned_at, eliminated_at)`.
   - On `start_game`, active players are shuffled into a single-cycle permutation (Hamiltonian cycle) where each player hunts the next.
   - RLS strictly enforces that during live play, each player can query only their own row (`hunter_player_id = my_player_id` and `status = 'active'`). Players learn their prey's identity only; they never know who is hunting them, nor the layout of the ring.
3. **Prey Pings & Directionless Proximity Warning:**
   - Scheduled radar pings are scoped per-player: each player receives delayed coordinate pings of their assigned prey only.
   - Sensory Proximity Pulse: When your unknown hunter enters within 100 m, a sensory warning (`hunter_proximity = 'near'`) is returned. Within 40 m, it intensifies (`hunter_proximity = 'close'`). The alert is completely directionless and reveals zero hunter coordinates or identity.
   - Safe Zones: Two Safe Zones (default 20 m radius) are auto-generated by default inside the play boundary, with host ability to adjust them in the lobby map. Tagging is disabled inside safe zones.
   - Player Count: Allows 3+ players (with UI copy recommending 6–16 players).
   - Spectator Mode: Standard spectator mode on elimination; eliminated players spectate without active ring roles.
4. **Tagging & Ring Relinking:**
   - `attempt_tag` validates that the tagged player is the caller's assigned prey. Tagging non-prey fails without penalty.
   - On successful tag, prey is marked `'tagged'` (eliminated), hunter's `elimination_count` increments, and the ring relinks ($P_{hunter} \to P_{victim's\_prey}$).
   - Last Survivor: When the active ring contracts to 1 survivor, match terminates with winner `'solo'` and reason `'last_survivor'`.

## 2026-11-04 — B4: VIP Escort Role Add-on (docs/MODES.md §5.2)

**Decision:**
1. **Role Integration & Secrecy:**
   - Added `'vip'` and `'bodyguard'` role values to `secret_role` enum and configured `role_catalogue` with `'vip'` role add-on.
   - Compatible with `tag_hunt` and `classic_chase`. Requires $\ge 2$ runners (1 VIP + at least 1 bodyguard).
   - Server-Side Secrecy: During live play, `secret_role` is visible only to runner squad teammates and the player themselves. Hunter clients receive `null` for runner `secret_role` in all live state snapshots and direct queries, ensuring the VIP's visual identity on hunter radar/map is indistinguishable from bodyguards. Role secrecy is lifted only after the match ends.
2. **Bodyguard Freeze Mechanics:**
   - When a hunter tags a runner who is a bodyguard:
     - The bodyguard is NOT eliminated. Instead, they enter a 60-second immobilized "freeze" state (`status_detail->'frozen_until' = now() + 60s`).
     - While frozen, the bodyguard cannot move outside a 10m dwell zone, cannot participate in role swaps, and cannot interact with game objects.
     - Tagging an already-frozen bodyguard fails with error `already_frozen` (preventing hunter griefing).
     - Event Notification: Emits `bodyguard_frozen` event visible to all players. Runners receive the bodyguard identity and remaining freeze time; hunters receive an anonymous confirmation that a bodyguard was successfully immobilized without leaking runner coordinates or names.
3. **VIP Elimination & Win Conditions:**
   - When a hunter tags the VIP:
     - The match terminates immediately with `winner = 'hunters'` and `end_reason = 'vip_eliminated'`.
   - In `classic_chase`, if the VIP enters the target extraction zone, runners win immediately (`winner = 'runners'`, `end_reason = 'arrival'`).
   - In `tag_hunt`, if match timer expires with the VIP alive, runners win (`winner = 'runners'`, `end_reason = 'time_expired'`).
4. **Physical Role Swap (High-Risk Tactical Mechanic):**
   - Implemented `request_role_swap`, `confirm_role_swap`, and `cancel_role_swap` RPCs.
   - Requires mutual proximity ($\le 5\text{ m}$) between VIP and an active bodyguard.
   - 15-second mutual acceptance window and 120-second cooldown per player after a completed swap.
   - Allows tactical misdirection (e.g., swapping attire or jackets in real life to deceive visually observing hunters).
5. **Offline Fail-Safe Auto-Promotion:**
   - If the VIP is disconnected or offline for $> 60\text{ s}$, `advance_game` automatically promotes the longest-standing active bodyguard to VIP (`vip_promoted` event). If no bodyguards remain active, hunters win (`end_reason = 'vip_abandoned'`).
6. **Mode Compatibility:**
   - Compatible with base modes `classic_chase` and `tag_hunt`. Incompatible with `assassin_ring` (solo free-for-all) and `relay_heist` (package carrier conflict).

## 2026-11-05 — B5: Operator Role Add-on (docs/MODES.md §5.3)

**Decision:**
1. **Role Integration & Remote Designation:**
   - Added `'operator'` value to `secret_role` enum and configured `role_catalogue` with `'operator'` role add-on.
   - Compatible with `classic_chase`, `tag_hunt`, `jailbreak`, and `relay_heist`. Incompatible with solo modes (`assassin_ring`, `ghost_duel`).
   - Any player can toggle `is_remote` for themselves in the lobby (or the host can designate for anyone via `set_player_remote`).
   - Server strictly enforces at most 1 remote Operator per squad (`runner` or `hunter`).
   - `start_game` enforces that every squad with an active Operator also retains at least one active field player (so squads never consist purely of remote operators).
2. **Remote Player Lifecycle & GPS Bypass:**
   - Remote operators do not broadcast GPS fixes. `submit_position` short-circuits with an early return (`is_remote: true`), bypassing spatial tracking, speed checks, and out-of-bounds calculations.
   - Remote operators are immune to tagging (`attempt_tag` and `apply_tag` reject tags against remote players) and cannot execute tags against other players.
   - In UI, location sharing and GPS tracking are automatically disabled for remote operators.
3. **Tactical Markers & Team Secrecy:**
   - Implemented `place_marker` and `clear_marker` RPCs.
   - Remote operators can place up to 3 concurrent tactical markers (`entities.kind = 'marker'`) anywhere in or near the play area ($1.5\times \text{radius}$).
   - TTL of 90 seconds per marker; placing a 4th marker prunes the oldest.
   - RLS strictly enforces team isolation: runner markers are visible only to runners; hunter markers are visible only to hunters. Opponents and outsiders receive 0 rows.
4. **Runner Operator Scan (Tactical Sweep) & Envelope Fuzzing:**
   - Implemented `operator_scan` RPC with 90-second squad cooldown.
   - Runner Operator triggers a tactical sweep: detects the nearest active hunter with a fresh fix ($\le 45\text{ s}$).
   - Returns a 150 m radius circular envelope (`entities.kind = 'scan_envelope'`) centered on the hunter fuzzed pseudorandomly by 10–30 m (deterministic hash of game ID, player ID, and 90-second epoch window).
   - Valid for 10 seconds. Raw hunter GPS coordinates are strictly preserved on the server and never exposed to runner clients.
5. **Hunter Operator Scan (Sector Proximity Census) & Boundary Constraint:**
   - Hunter Operator provides target center coordinates `(lat, lng)`.
   - Coordinates must fall strictly within the active play area boundary.
   - Server performs a spatial census: counts active runners with fresh fixes ($\le 45\text{ s}$) within 200 m of the target point.
   - Returns an integer count only (`count: N`). Zero runner coordinates, identities, or directions are revealed.
6. **Tactical Radio Messaging:**
   - Implemented `send_operator_message` RPC.
   - Operators can broadcast short tactical directives (up to 120 characters) delivered to squad teammates via the live event stream (`operator_message` event).








## 2026-11-08 — Milestone B6: Solo Ghost Duel (Architecture Record B6-1 to B6-4)

**Record B6-1 — Solo game start and auto-team assignment:**
A `ghost_duel` game allows `min_players = 1`. The solo player is auto-assigned to team `runner` for time_trial and evade variants, and to team `hunter` for mirror_chase. The ghost entity acts as the opposing team's NPC. This avoids requiring a second player for what is fundamentally an asynchronous solo experience.

**Record B6-2 — Scoring formula for time trial:**
`score = max(100, 1000 + delta_s × 10 + efficiency × 200)` where `delta_s = ghost_time - player_time` and `efficiency = straight_line_distance / actual_trail_distance`. The floor of 100 prevents negative scores for very slow runs. The formula rewards both speed (delta) and route intelligence (efficiency), aligning with the "never reward running" principle.

**Record B6-3 — Ghost Duel win conditions evaluated in submit_position:**
Rather than using a separate tick function, Ghost Duel collision checks (evade 20 m proximity, time trial target arrival) are evaluated inline within `submit_position`. This is acceptable because solo mode means exactly one player is submitting positions, so the additional computation is negligible and avoids pg_cron dependency.

**Record B6-4 — Leaderboard proximity scoping:**
`get_ghost_duel_leaderboard` takes `(lat, lng, radius_m, variant, row_limit)` and returns scores from games whose `area_center` falls within the specified radius. This creates naturally location-scoped leaderboards ("best ghost duel scores in this park") without requiring explicit venue registration.

**Trade-off:** The leaderboard currently does not distinguish between different ghost paths at the same location. A future "course" system could add path-specific scoring.


## 2026-11-08 — Milestone B8: Territory Pulse Base Mode (Architecture Record B8-1 to B8-4)

**Record B8-1 — Procedural 7-Hexagonal Sector Spatial Layout:**
Rather than relying on runtime polygon mesh generation or external Postgres extensions like Uber H3, Territory Pulse procedurally spawns 7 sectors (`entities.kind = 'zone'`): a central Sector Core and 6 radial sectors (Alpha through Foxtrot) spaced at $60^\circ$ bearing intervals ($0^\circ, 60^\circ, 120^\circ, 180^\circ, 240^\circ, 300^\circ$) at distance $R_{\text{ring}} = R_{\text{area}} \times 0.55$, with zone radius $R_{\text{zone}} = \min(80, \max(35, R_{\text{area}} \times 0.20))$. This guarantees uniform tessellation and balanced spatial access across any game radius (100–5000 m) with zero external dependencies.

**Record B8-2 — Synchronous Pulse Cadence & Multi-Pulse Flip Dynamics:**
Sector majority is evaluated exclusively during discrete pulse ticks (default 90 s, configurable in `mode_params`). A neutral sector is captured immediately upon establishing strict player majority. Flipping an opponent's held sector requires establishing majority across 2 consecutive pulses (`contender` tracking). Defending an owned sector clears contender status immediately. This prevents erratic back-and-forth flipping and gives defending teams a full pulse cycle to respond to enemy incursions.

**Record B8-3 — Contest Tagging as a Presence Suppressor:**
Standard tag elimination would quickly shrink squads and cause an irreversible territorial snowball. In Territory Pulse, physical tags apply a 60-second incapacitation timer (`status_detail->'incapacitated_until'`) via `apply_tag`. Incapacitated players stay on the field and can navigate, but are strictly excluded from sector presence and majority tallies during pulses until the timer elapses.

**Record B8-4 — Dual Victory Pathways (Dominance vs Points):**
To support both rapid decisive victories and tactical endurance matches, Territory Pulse supports two victory paths:
1. Dominance: Controlling $\ge 70\%$ of sectors ($\ge 5$ of 7) across 2 consecutive pulses or all 7 sectors simultaneously triggers an immediate dominance victory (`end_reason = 'territory_dominance'`).
2. Points on Timeout: Holding sectors awards +1 point per pulse. When the round timer expires, the team with strictly higher accrued points wins (`end_reason = 'points_victory'`), with equal points resolving to a draw (`end_reason = 'draw'`).


## 2026-11-08 — Milestone C1: Speed & Safety Guard (Architecture Record C1-1 to C1-4)

**Record C1-1 — Universal Safety Pause and Timer Shift Architecture:**
Safety is the supreme constraint across all physical pedestrian gameplay. The `public.game_status` enum is extended with `'paused'`. Any active player can call `pause_game(game_id, reason)`. While paused, game tick processing (`advance_game`) returns immediately and position victory/elimination evaluations are suppressed. When resumed via `resume_game(game_id)`, all active deadline timestamps (`ends_at`, `next_ping_at`, `live_at`, `head_start_at`, `curfew_at`, and `territory_pulse.next_pulse_at`) are shifted forward by the exact elapsed pause duration (`clock_timestamp() - paused_at`), guaranteeing that no team loses playing time or tactical advantages due to a safety pause.

**Record C1-2 — Democratic Majority Vote Safety Pause:**
To enable collective squad consensus in non-emergency safety situations (e.g. crossing a busy intersection, inclement weather), `vote_pause_game(game_id, vote)` allows any active player to vote to pause. When yes votes reach or exceed 50% of active field players (`ceil(v_active_players / 2.0)`), the game auto-pauses with reason `'majority_safety_vote'`. Remote/spectating players are excluded from the required quorum.

**Record C1-3 — SOS Override with Automatic Safety Pause:**
Per `docs/MODES.md §7.2`, emergency SOS overrides everything. `send_sos` was upgraded from a simple event emitter to an atomic safety procedure: it broadcasts the player's last known coordinates and alert to all players, opens the device emergency dialer (112 / 911), and automatically calls `pause_game` with `pause_reason = 'emergency_sos'`.

**Record C1-4 — Vehicle Speed Guard & Curfew Deadline Enforcement:**
GhostRun is strictly a pedestrian game. In `submit_position`, smoothed GPS speed exceeding $8\text{ m/s}$ ($28.8\text{ km/h}$) sustained for $\ge 10\text{ s}$ emits a `vehicle_warning` event, flags the player's `status_detail->'vehicle_warning'`, returns warning metadata to the client, and spikes the noise meter to 100 when noise mechanics are active. For nighttime safety, games optionally accept a curfew deadline (`mode_params->safety->curfew_at`); when reached, `advance_game` ends the round gracefully with `end_reason = 'curfew_reached'`.


## 2026-11-08 — Milestone C2: AI Game Master (Architecture Record C2-1 to C2-4)

**Record C2-1 — Deterministic Event Engine vs Generative Narration Decoupling:**
Per `docs/MODES.md §7.1`, deterministic server-side Postgres logic decides *what happens*, while language model or templated narration writes *how it is said*. All 5 game master events (`supply_drop`, `double_ping`, `fog`, `rumour`, `shrink_step`) execute entirely within server-authoritative Postgres RPC `trigger_game_master_event`. This ensures total game state consistency, zero network latency dependency, zero API credential exposure to clients, and fair play across all matches.

**Record C2-2 — Server Authority & Zero Secret Leakage for Game Master Narration:**
The AI Game Master receives exclusively public match state (scores, elapsed time, public pings, and coarse quadrant aggregations). It never receives or transmits unmasked GPS tracks, secret extraction targets, secret roles (e.g. VIP, Double Agent), or hidden jail coordinates. Directional rumors are calculated relative to `area_center` into 4 quadrants (North-East, North-West, South-East, South-West) without revealing exact coordinates.

**Record C2-3 — Boundary Contraction Scaling via Shrink Scale:**
Rather than corrupting base geometry or conflicting with the `shrinking_zone` modifier, `shrink_step` reduces the effective area radius by 15% via `mode_params->'ai_gm'->'shrink_scale' = round(current_scale * 0.85, 3)`, clamped to a minimum radius of 60 m. `public.effective_radius_m(p_game_id)` composes this factor with existing stage shrink logic, seamlessly supporting perimeter contraction across all base modes with or without shrinking zone.

**Record C2-4 — Hard Event Caps and Realtime Radio Dispatch Banner:**
To prevent event spam, game pace inflation, and token runaway, `mode_params->'ai_gm'` maintains an explicit `event_count` enforced against `max_events` (default 12 per round). Client devices render an in-game Game Master Radio Dispatch Dock with broadcast icon, event title, and narration text, accompanied by Realtime whispers and haptic alerts, alongside an atmospheric fog overlay (`fogOverlay`) when `fog_active` is true.


## 2026-11-08 — Milestone C3: Replay & Stats Upgrades (Architecture Record C3-1 to C3-4)

**Record C3-1 — Post-Game Replay Layer Pipeline & Consent Gating:**
Per `docs/MODES.md §7.3` and Consent C3 (`share_trail = true`), `get_game_replay(game_id)` serves comprehensive tactical replay datasets after the match terminates: `tags`, `pings`, `heat_marks`, `zones`, `pulse_history`, `npc_paths`, `handoffs`, `drops`, and `jail_events`. Raw trail points for opponent routes remain strictly hidden unless the owning player explicitly granted `share_trail = true`. Public tactical entities (pings, tags, zones, heat presses, drops, and NPC lines) are rendered on the map with discrete visibility toggle chips (`visibleLayers`).

**Record C3-2 — Algorithmic Best Bluff Calculation:**
To reward psychological and evasive mastery beyond raw speed, `get_game_stats` evaluates `best_bluff`:
1. Close Ghost Evasion: Runner approaching within $\le 35\text{ m}$ of hunters without being tagged (`achieved = true`).
2. Undetected Mole: Double Agent surviving the round undetected without tribunal elimination.
3. VIP Bodyguard Decoy: Bodyguard drawing a hunter tag and absorbing a freeze penalty to shield the VIP.
4. Close Encounter: Near evasion within 50 m prior to interception (`achieved = false`).

**Record C3-3 — Structured Per-Mode Recap Summaries (`mode_recap`):**
Rather than cramming ad-hoc mode metadata into root JSON, `get_game_stats` provides a structured `mode_recap` payload returning exact metrics for active modes and modifiers:
- Relay Heist: `total_handoffs`, `package_drops`, `package_secured`.
- Territory Pulse: `pulse_seq`, `scores`, `dominance_pct`, `end_reason`.
- Jailbreak: `total_rescues`, `total_jailed`.
- Assassin Ring: `active_survivors`, `safe_zone_count`.
- Ghost Duel: `variant`.
- AI Game Master: `total_events`, `max_events`, `last_event_type`, `last_narration`.

**Record C3-4 — Replay MapLibre Vector Sources & Interactive Layer Toggles:**
In `app/replay/[id].tsx`, vector layers for territory zones (radial sectors with controller fills), ghost NPC paths (dashed purple line string + entity blips), tactical supply drops, and hunter heat marks (color-coded by temperature) are dynamically sourced from GeoJSON features. Interactive layer chips allow players to toggle individual layers on/off without re-querying the database or disrupting playback scrubbing.

## 2026-11-08 — Milestone C4: Privacy, Consent and Replay Sharing Audit (Architecture Record C4-1 to C4-4)

**Record C4-1 — Complete Consent Matrix Verification (C1–C7) & Route Sharing Gate:**
Verified end-to-end enforcement of the consent matrix defined in `docs/MODES.md §7.4.2`:
1. *C1 (Location during games):* Verified background/foreground GPS tracking operates strictly during active play (`head_start` or `live`), never passively on the Home or Lobby screens.
2. *C2 (Privacy notice, terms, age confirmation):* First-run gate enforced on `/privacy?mode=gate`. Verified that `routeAfterAuth` in `app/auth.tsx` and initial load in `app/home.tsx` query `get_my_consents()` and redirect to `/privacy?mode=gate` if `policy_ack.granted` is false or `policy_version < PRIVACY_VERSION` (18+ or guardian confirmation).
3. *C3 (Replay sharing in this game):* Route sharing choice (`share_trail`) is mandatory prior to lobby ready-up. Server-authoritative functions `set_ready` and `start_game` strictly reject uncommitted choices. Post-game opponent trails and closest call proximities remain hidden unless explicitly consented.
4. *C4 (Ghost contribution):* Result screen prompts runner route contribution per game with 150m start/end trimming preview. Suppressed entirely if permanently declined. Added "Never ask again" button calling `set_consent('ghost', false)` and added a direct `Contribute routes to Ghost Library` toggle in Settings → Privacy (`app/privacy.tsx`).
5. *C5 (Public leaderboard name):* `get_ghost_duel_leaderboard` validates consent type `leaderboard_name`. If ungranted, runner names mask automatically to `'Anonymous Runner'`.
6. *C7 (Diagnostics):* Non-location telemetry toggle wired in Settings → Privacy.

**Record C4-2 — Foreign Key Cascade Safety on Heat Presses:**
In `public.heat_presses`, `hunter_id` was non-nullable with a strict default foreign key, which blocked user account deletion (`delete_my_data()`) whenever a player had conducted a heat probe. `hunter_id` was relaxed to nullable with `ON DELETE SET NULL`, allowing the user profile and player rows to delete cleanly while keeping the anonymized heat probe record intact for post-game recap.

**Record C4-3 — Self-Service Data Purge & Anonymous Ghost Disassociation:**
Per `docs/MODES.md §7.4.8`, `delete_my_data()` upgrades to explicitly delete contributed anonymous ghost library entries linked via `ghost_contributions` (`delete from public.ghost_library where id in (select ghost_id from public.ghost_contributions where user_id = caller_id)`). This guarantees that deleting an account completely removes their contributed paths from the ghost library, honoring user opt-out while preserving game history integrity.

**Record C4-4 — Comprehensive Data Export (`export_my_data`):**
Upgraded `export_my_data()` to export all personal and tactical gameplay records associated with the authenticated user: profile, consents history, games joined with team and trail sharing choice, personal trail points (subqueried and capped at 50,000 points to avoid memory exhaustion), tag records, SOS events, ghost contributions, ghost duel scores, drop claims (`drop_id`, `started_at`), and heat presses (`variant`, `result`, `pressed_at`).

## 2026-11-09 — UI-M0: UI Restructure Foundations & Registry Architecture

### Decision UI-D1: Registry Source of Truth (Option b)
**Decision:** Adopt Option (b) for mode architecture. Maintain a typed client-side registry in `src/modes/` containing rich presentation metadata (copy, icons, widgets, difficulty ratings, rules sections, tour beats) coupled with an automated drift test (`scripts/registry-drift.ts`) wired into `package.json`. The drift test queries `public.mode_catalogue()`, `public.modifier_catalogue()`, and `public.role_catalogue()` on the server, strictly asserting that:
1. Every enabled base mode, modifier, and role in the database is present and enabled in the client registry.
2. Parameter keys, defaults, types, and validation boundaries match 1:1 with the server catalogue definitions.
3. Any disabled or unapproved items in the deny list are verified to remain disabled/hidden in the client.

**Reason:** Enables fast, offline rendering of wizard cards, rules cards, and in-game widgets while guaranteeing that client definitions never drift from server-authoritative rules.

**Trade-off:** Parameter changes must be reflected in both the server migration and the client registry module, caught immediately by the automated drift test.

### Decision UI-D2: Client Deny List for Unreleased / Experimental Modes
**Decision:** Maintain an explicit client-side deny list in `src/modes/registry.ts`:
- `haunted_map`: Hidden (relies on server-simulated NPC patrol engine; requires physical outdoor safety audit).
- `horde`: Hidden (future scope; requires server swarm simulation stress testing).
- `manhunt`: Hidden (marketing pitch copy in onboarding only; no programmatic engine exists or is needed).
- `qr_tagging`: Hidden (feature flag `false` until physical daylight camera reliability testing is performed).

**Reason:** Respects Addendum B and Standing Decisions: prevents exposing unapproved or untested experiences to players.




