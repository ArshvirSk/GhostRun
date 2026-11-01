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

## 2026-11-01 — Field Playtest Completion, External Cron & Contact Verification

**Decision:** The user-confirmed contact email `arshvirsk26@gmail.com` is established across the privacy framework, settings, and documentation. Physical outdoor playtesting is signed off as completed. External recurring cron execution (pinging `health_ping` and running `cleanup_old_games()` 30-day retention) is confirmed active.


