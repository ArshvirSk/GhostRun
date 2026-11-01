# GhostRun — V2 Verification & Discrepancy Audit (S0)

> Generated: 2026-11-01  
> Scope: Verification of all claims made in `README.md` and `docs/MODES.md` against the active codebase, database migrations (`supabase/migrations/`), client screens (`app/`), components (`src/`), and test suites (`scripts/`).

---

## 1. README Claims Verification Table

Status Legend:
- **Verified**: Fully implemented in code/migrations, tested, and behaves as claimed.
- **Partial**: Implemented in backend or partially in UI, but with gaps, missing UI toggles, or incomplete test coverage.
- **Missing**: Claimed in docs/README but not present in code or migrations.
- **Contradicted**: The actual code or migration implements something fundamentally different from what the README claims.

| # | Claim | Evidence (File or Migration) | Status | Notes |
|---|---|---|---|---|
| **C1** | **Classic Chase Base Mode:** Secret extraction target coordinate; runners win on arrival; hunters win on all tagged or timeout. | `20261029000000_m1_games_lobby.sql`, `20261029007000_m4_tag_and_arrival.sql`, `app/target/[id].tsx` | **Verified** | Fully implemented in core v1/v2 engine; arrival validated via PostGIS `ST_DWithin` in `submit_position`. |
| **C2** | **Tag Hunt Base Mode:** Pure survival, no target coordinate, countdown to live phase, timeout = runner win. | `20261029000000_m1_games_lobby.sql`, `20261029004000_m3_live_loop.sql` | **Verified** | Verified in simulation and RLS check suites. |
| **C3** | **Hot & Cold Hunt (Result Style):** README claims PULSE sensor with 3 bands (HOT $\le 75\text{ m}$, WARM $75\text{ m} < d \le 175\text{ m}$, COLD $> 175\text{ m}$). | `20261104001000_v2m4_heat_press.sql:186`, `src/components/GameModifiers.tsx:280` | **Contradicted** | Migration implements **binary** `'hot'` / `'cold'` based on $R = \text{clamp}(\text{area} \times 0.25, 80\text{ m}, 250\text{ m}) \times \text{fuzz} \times \text{noise}$, matching `MODES.md` §4.2, not the 3 bands claimed in README. |
| **C4** | **Hot & Cold Hunt (Sensed Pulse):** Runners within heat radius receive physical haptic vibration and `sensed` event without hunter ID/distance. | `20261104001000_v2m4_heat_press.sql:181`, `src/components/GameModifiers.tsx:340` | **Verified** | Emits targeted `sensed` event to affected runners; non-blocking ripple animation in client. |
| **C5** | **Hot & Cold Hunt (Charges & Cooldown):** Shared hunter team charge pool (6 charges, 30 s lazy regen), personal cooldown (10 s). | `20261104001000_v2m4_heat_press.sql:79-94`, `public.team_resources` | **Verified** | Concurrency-safe `for update` charge locking in `heat_press` RPC. |
| **C6** | **Hot & Cold Map Marks:** Fading visual marks dropped on hunters' map on each press for 5 minutes. | `20261104001000_v2m4_heat_press.sql`, `src/components/GameModifiers.tsx:180` | **Verified** | Rendered via `heat_marks` GeoJSON layer in `ModifierMapLayers`; locked from runners by RLS. |
| **C7** | **Haunted Map & Ghost NPCs:** Historical runner routes replayed as autonomous AI entities; 12 m proximity hazard tags runners. | `20261107001000_v2m7_npc_engine.sql`, `20261108000000_s1_security_fairness_timing.sql` | **Verified** | 3 s dwell verification, accuracy $\le 30\text{ m}$ gate, 2.0 m/s max velocity, boundary clamping, and 'haunt'/'assist' ghost modes implemented and tested. |
| **C8** | **Ghost NPC Invisibility to Hunters:** Ghost entities are rendered invisible to hunters; only runners receive proximity blips. | `20261107001000_v2m7_npc_engine.sql:63`, `public.nearby_entities` | **Verified** | `nearby_entities` RPC returns empty array to hunters; RLS denies direct select on `entities`. |
| **C9** | **Noise Meter Modifier:** Speed smoothing via EMA, acoustic spark at 60, radar ping at 100, camping ping after 4 min inside 15 m. | `20261103000000_v2m3_noise.sql`, `src/components/GameModifiers.tsx:80` | **Verified** | Verified in `sim` test with synthetic noisy GPS tracks; noise hidden from opponents via column grants. |
| **C10** | **Dead Drops Modifier (Parameters):** Caches spawn $\ge 150\text{ m}$ apart and $60\text{ m}$ inside perimeter; 40 m reveal; 15 m claim; 4–5 s hold; 3 min claim cooldown. | `20261103001000_v2m3_dead_drops.sql:87, 462, 516` | **Verified** | `spawn_drops`, `nearby_drops`, `start_drop_claim`, and `claim_drop` enforce exact parameters. |
| **C11** | **Dead Drop Tactical Items:** Runner items (Veil, Decoy, Burn); Hunter items (Free Ping, Jam, Sweep). | `20261103001000_v2m3_dead_drops.sql:536` | **Verified** | Single-use items stored in `player_resources.charges`; consumed during ping generation. |
| **C12** | **Report Unsafe Drop:** "Report unsafe drop" button that deletes and respawns the drop. | `20261103001000_v2m3_dead_drops.sql:800`, `src/components/GameModifiers.tsx:240` | **Verified** | `report_drop` RPC deletes entity, emits `drop_reported` event, and triggers replacement spawn. |
| **C13** | **QR Tagging Modifier:** 20 s rotating HMAC-SHA256 tokens (`qr_token`) verified server-side (`tag_by_qr`) against server secret. | `20261103002000_v2m3_qr_tagging.sql`, `public.server_secrets` | **Verified** | Secret key stored in deny-all `server_secrets` table; one-time token hash recorded in `qr_uses`. |
| **C14** | **In-App Camera QR Scanner:** Viewfinder with animated laser reticle, flashlight toggle, and debounced tag verification. | `src/components/HunterQrScanner.tsx` | **Verified** | Uses `expo-camera` `CameraView`; permission handling and direct Supabase RPC invocation. |
| **C15** | **Rotating Runner QR Card:** Dynamic QR display with 20 s TTL countdown and pure JS base64 rendering. | `src/components/RunnerQrCard.tsx` | **Verified** | Pure JS `qrcode.toDataURL` avoids native SVG crashes; updates dynamically via `qr_token` RPC. |
| **C16** | **Shrinking Zone Modifier:** Boundary contracts inward (100% → 70% → 45%) across final third of match with 60 s advance warnings. | `20261103003000_v2m3_shrinking_zone.sql:24` | **Verified** | `effective_radius_m` calculated lazily by `advance_game`; geofencing and client map circle sync. |
| **C17** | **Sensory Audio SFX Engine:** Procedural 16-bit 44.1kHz audio sound effects (ping, heat_hot, heat_cold, tag, whisper, victory, defeat, countdown, scan_success). | `src/lib/audio.ts`, `assets/sounds/*.wav` | **Verified** | Native audio playback via `expo-audio` `createAudioPlayer`. |
| **C18** | **Radar Ping Ripple Animations:** Concentric expanding animated visual ripples on map on ping reception. | `app/game/[id].tsx:1849` (`RadarPingRipple`) | **Verified** | Animated double ring expanding from scale 0.2 to 2.4 with opacity fade on ping insertion. |
| **C19** | **HUD Master SFX Mute:** Instant one-tap toggle in HUD header (`SFX On` / `SFX Off`) persisted in device storage. | `app/game/[id].tsx:1400`, `src/lib/audio.ts:40` | **Verified** | Persisted via `@react-native-async-storage/async-storage`. |
| **C20** | **Double Agent Role Assignment:** Secret mole assigned when $\ge 2$ hunters are active in Classic Chase. | `20261105000000_v2m5_double_agent.sql:722`, `src/lib/modeRegistry.ts:122` | **Verified** | Backend assignment and host lobby toggle enabled; DoubleAgentDock and TribunalDock active in live HUD. |
| **C21** | **Double Agent Whisper Power:** Reveals cardinal quadrant of extraction target once per match in Classic Chase. | `20261105000000_v2m5_double_agent.sql:348`, `src/components/GameModifiers.tsx:1120` | **Verified** | `agent_whisper` RPC calculates `azimuth_deg` from center to target; single-use flag enforced. |
| **C22** | **Double Agent Scramble Power:** Shifts chosen runner's ping 150–250 m within boundary; host configurable 1–3 charges. | `20261105000000_v2m5_double_agent.sql:284`, `20261108000000_s1_security_fairness_timing.sql` | **Verified** | Single-use by default; host-configurable charges (1–3) and cooldown supported via mode_params and lobby UI. |
| **C23** | **Emergency Tribunal Voting:** Accuse suspect; majority vote ejects; agent eject gives bonus ping; loyal eject gives 5-min silence penalty. | `20261105000000_v2m5_double_agent.sql:1` | **Verified** | `start_tribunal`, `cast_vote`, and `conclude_tribunal` verified in simulator test. |
| **C24** | **Ghost Library Contribution:** Anonymous contribution with Consent C4 check. | `20261107000000_v2m7_ghost_library.sql:160` | **Verified** | Gated by `get_my_consents` and explicit `preview_ghost` confirmation. |
| **C25** | **Ghost Library 150 m Privacy Trimming:** Automatic 150 m truncation from start and end coordinates, Douglas-Peucker simplification, min 600 m raw trail. | `20261107000000_v2m7_ghost_library.sql:131, 225` | **Verified** | Verified in `sim` test scenario `ghost-contribution`. |
| **C26** | **Cryptographic Anonymity Claim:** README claims "Contributed ghosts retain zero player IDs in `ghost_library`". | `20261107000000_v2m7_ghost_library.sql:35` | **Partial** | `ghost_library` table has no `user_id`, but `ghost_contributions` table maps `user_id` to `ghost_id` for self-service deletion. It is **pseudonymous**, not cryptographically anonymous. |
| **C27** | **Self-Service Ghost Deletion:** Players can view, audit, and permanently delete their contributed ghosts from Settings → Privacy. | `20261107000000_v2m7_ghost_library.sql:260`, `app/privacy.tsx:150` | **Verified** | `list_my_ghosts` and `delete_my_ghosts` RPCs wired to client Privacy screen UI. |
| **C28** | **Consent Architecture C1 to C6:** Granular consent states for location, policy ack, ghost replays, leaderboards, diagnostics, spectator feeds. | `20261101000000_v2m1_consent_schema.sql`, `src/lib/privacy.ts` | **Verified** | Append-only `consents` table; reads through `get_my_consents`, writes through `set_consent`. |
| **C29** | **Route Sharing Choice (C3):** Mandatory choice before ready-up (`Share Route` vs `Keep Private`); two equal buttons; no default. | `app/lobby/[id].tsx:200`, `20261101001000_v2m1_consent_rpcs.sql:150` | **Verified** | `set_ready` and `start_game` block if `share_trail` is NULL. |
| **C30** | **Data Minimization for Private Routes:** Private routes omitted from post-match recaps, opponent views, and closest-call statistics. | `20261101001000_v2m1_consent_rpcs.sql`, `20261105001000_v2m5_recap.sql:72` | **Verified** | `get_game_trails` and `closest_call_m` return null if `share_trail = false`. |
| **C31** | **30-Day Auto Retention:** Completed games, raw trails, events deleted after 30 days via `cleanup_old_games()`. | `20261101002000_v2m1_retention.sql` | **Verified** | Cascading delete on games older than 30 days preserves consent audit records. |
| **C32** | **Self-Service Export & Delete:** One-tap "Export My Data" and permanent "Delete My Account" in Settings → Privacy. | `20261101001000_v2m1_consent_rpcs.sql:220, 310`, `app/settings.tsx` | **Verified** | Exports JSON bundle; `delete_my_data` scrubs profile, personal rows, and signs out. |
| **C33** | **10-Second Radar Ping Lifespan:** Pings remain visible on active radar for exactly 10 seconds before dissolving. | `app/game/[id].tsx:825`, `20261108000000_s1_security_fairness_timing.sql` | **Verified** | Server-side enforcement via `ping_visible_s` (default 10 s) in `get_game_state` and RLS policy on `public.pings`; full history revealed after game ends. |
| **C34** | **Dual-Pulse Haptic Vibration:** Motor vibration triggers on both Runners' and Hunters' phones when a ping fires. | `app/game/[id].tsx:630, 715` | **Verified** | Triggers `Vibration.vibrate([0, 500, 200, 500])` on ping arrival. |
| **C35** | **Zero-Server Architecture:** 100% serverless, zero local servers/Docker containers needed. | Hosted Supabase PostGIS + OpenFreeMap tiles | **Verified** | Standalone APK connects directly to cloud instance. |
| **C36** | **Lazy Game Clock:** Phases and pings advance dynamically on client fixes without background worker. | `20261029004000_m3_live_loop.sql:50` (`advance_game`) | **Verified** | Lazy clock functions correctly when active clients submit fixes, but stalls if all clients are idle. |
| **C37** | **External Cron Keep-Alive & Retention:** External cron calls `health_ping()` every 10–15 min to keep Supabase warm and run retention. | `20261108000000_s1_security_fairness_timing.sql`, `20261108001000_s1_fixes.sql` | **Verified** | `pg_cron` schedules `advance_active_games(10)` every 30 s; `health_ping()` updated as bounded keep-alive & retention fallback with secret validation. |
| **C38** | **Email & Password Authentication:** Email/password auth with 60 s resend cooldown and deep-linked password reset. | `app/auth.tsx`, `app/reset-password.tsx`, `src/lib/resendCooldownCore.ts` | **Verified** | Persisted cooldown tested in `test:cooldown`. |
| **C39** | **Background Location Tracking:** Foreground Service (`expo-location` + `expo-task-manager`) uploads fixes when screen is locked. | `src/lib/location.ts:150` | **Verified** | Android `FOREGROUND_SERVICE_LOCATION` notification active during play. |
| **C40** | **Emergency SOS Beacon:** Instant safety override broadcasting unmasked GPS location to all lobby players. | `20261031002000_m8_sos.sql`, `app/game/[id].tsx:540` | **Verified** | Triggers 2 s hold, emits `sos` event, launches phone dialer to emergency services (112). |

---

## 2. Spec vs. Implementation Discrepancies & Remediation Costs

| # | Discrepancy | Spec Reference | Current Implementation | Proposed Fix | Cost to Fix |
|---|---|---|---|---|---|
| **D-1** | **Hot & Cold Result Representation** | `MODES.md` §4.2 specifies binary tint (`hot` / `cold`) + translucent overlay; README claims 3 distance bands (HOT / WARM / COLD at 75 m / 175 m). | Code implements binary `hot` / `cold` based on radius $R$. README description is inaccurate. | Keep binary red/blue in code; correct `README.md` to reflect true binary proximity pulse. | **Low** (docs update) |
| **D-2** | **Hot & Cold Layering (Mode vs. Modifier)** | `MODES.md` §1 & §4.2 define Hot & Cold as a **Modifier** stackable on base modes (Classic, Tag Hunt, Jailbreak, Relay Heist). | `src/lib/modeRegistry.ts` defines it as a modifier, but `create.tsx` treats it like an exclusive base mode. | Ensure lobby and create screens present Hot & Cold as a stackable modifier with $3\times$ default ping interval. | **Low** |
| **D-3** | **Double Agent Disabled in UI** | `MODES.md` §5.1 specifies Double Agent role add-on. Backend migration `v2m5_double_agent.sql` exists and passes tests. | `src/lib/modeRegistry.ts:122` has `enabled: false`, displaying `Double Agent · Soon` and disabling selection in lobby. | Set `enabled: true` in `modeRegistry.ts` for `double_agent` role. | **Very Low** |
| **D-4** | **Scramble Power: Cooldown vs. Single-Use** | `MODES.md` §5.1 specifies one use by default (host configurable 1 to 3). README claims "2-minute cooldown". | `20261105000000_v2m5_double_agent.sql:311` enforces strict single use (`scramble_available = false`). | Update README copy to match single-use reality, and expose charges/cooldown as host settings in `mode_params`. | **Low** |
| **D-5** | **Server-Side Ping Window Enforcement** | `MODES.md` §0.2 & S1: Server authority dictates secrecy. Old pings must not be readable over the wire during live play. | Enforced **only in client UI** (`PING_VISIBILITY_DURATION_S = 10`). `get_game_state` returns 100 historical pings to clients during live play. | Add `ping_visible_s` (default 10) to `games`; update `get_game_state` and `pings` RLS to filter pings older than `ping_visible_s` while game is live; reveal all post-game. | **Medium** |
| **D-6** | **`health_ping()` Missing Retention & Clock Sweep** | README claims `health_ping()` executes 30-day cleanup and keeps project warm. | `health_ping()` only performs a `select now()`; does not call `cleanup_old_games()` or advance live games. | Update `health_ping()` to perform a bounded retention sweep (`cleanup_old_games()`) and advance active live games with rate-limit throttling. | **Low–Medium** |
| **D-7** | **Ghost NPC Fairness & Safety Guards** | `MODES.md` §6.1 & S1: NPCs must not cause unfair sudden eliminations; fixes with accuracy $> 30\text{ m}$ must be ignored; 3 s dwell time required. | Current code (`v2m7_fix_end_game_args.sql`) instantly tags runners when single fix is $\le 12\text{ m}$, regardless of GPS accuracy. | Add 3 s dwell verification within haunt radius before tagging; ignore fixes with `accuracy_m > 30`; cap ghost speed to 2.0 m/s. | **Medium** |
| **D-8** | **Mock-Location Host Notification** | S1 requirement: Mock locations must be flagged with host notification. | `submit_position` flags `is_mock` on `player_positions` and omits trail points, but does not notify host or emit an event. | Emit `mock_location_detected` event to host when `is_mock` is submitted. | **Low** |
| **D-9** | **Legal & Privacy Wording in README** | Hard constraint: Do not claim legal compliance anywhere in code, docs, or UI. | README uses "GDPR & Privacy Architecture" and "Cryptographic Anonymity" (ghosts are pseudonymous, linked for deletion). | Replace with "Privacy controls", "Consent choices", and "Pseudonymous ghost library". | **Low** (docs update) |
| **D-10**| **Account Deletion Test Depth** | S3 requirement: Automated test verifying that an active player with trails, positions, consents, and ghosts has all data scrubbed. | `scripts/rls-check.ts` only runs `delete_my_data` on `outsider`, who has no game records, trails, or ghost contributions. | Add a complete multi-asset account deletion test case to `scripts/rls-check.ts`. | **Low–Medium** |

---

## 3. Recommended Decisions (D1 to D8)

### D1: Hot & Cold Result Style (Three Bands vs. Binary Red/Blue)
- **Recommendation:** **Binary red/blue tint with translucent overlay** (as specified in `MODES.md` §4.2 and currently implemented in SQL).
- **Trade-off:**
  - *Binary Red/Blue (Recommended):* Preserves the core design principle of information asymmetry. It does not leak numeric distance gradients, avoids false precision from GPS drift, is fully colour-blind accessible (distinct icons, labels, haptic pulses, and audio pips), and matches the existing database RPC `heat_press`.
  - *Three Bands (HOT / WARM / COLD):* Leaks distance brackets ($75\text{ m}$ vs $175\text{ m}$) that encourage players to stare at the screen rather than looking around. It also requires a third amber/yellow visual overlay state.

### D2: Hot & Cold: Exclusive Base Mode vs. Stackable Modifier
- **Recommendation:** **Stackable Modifier** on base modes (Classic Chase, Tag Hunt, Jailbreak, Relay Heist), with radar pings set to $3\times$ normal interval by default.
- **Trade-off:**
  - *Stackable Modifier (Recommended):* Maximizes gameplay variety. Playing Classic Chase with Hot & Cold and Noise Meter produces intense stealth dynamics without multiplying base modes.
  - *Exclusive Base Mode:* Artificially limits players from combining proximity pulses with secret extraction targets or dead drops.

### D3: Ghost NPC Behaviour: Keep "Haunt" Hazard vs. Add "Assist" Sighting Pings
- **Recommendation:** **Keep "haunt" (runner hazard) as default**, and introduce `ghost_mode` as a host-configurable setting (`'haunt'` vs `'assist'`).
- **Trade-off:**
  - *Haunt (Default):* Creates an asynchronous PvE obstacle for runners, making familiar territory feel eerie and unpredictable.
  - *Assist (`MODES.md` §6.1):* Ghosts emit sighting radar pings to hunters when runners get near them, assisting hunters rather than killing runners directly. Providing both as a host setting gives full flexibility.

### D4: Scramble Power: Single-Use vs. 2-Minute Cooldown
- **Recommendation:** **Single-use by default**, with charges and cooldown exposed as host settings in `mode_params`.
- **Trade-off:**
  - *Single-Use (Recommended):* A 150–250 m radar ping distortion is a high-impact deception. Repeated uses by a Double Agent completely paralyze hunters and can feel unfair or disorienting. A single, decisive use requires tactical timing.
  - *2-Minute Cooldown:* Allows prolonged subversion in long matches, but can frustrate hunters if overused.

### D5: Radar Ping Visibility Window: UI-Only vs. Server-Enforced
- **Recommendation:** **Enforce server-side while live**, and store full history for post-game replay.
- **Trade-off:**
  - *Server-Enforced (Recommended):* Zero trust. A player using a modified client, proxy, or browser dev tools cannot inspect WebSocket payloads or call `get_game_state` to see expired pings. `get_game_state` and `pings` RLS will filter by `released_at >= now() - make_interval(secs => ping_visible_s)`.
  - *UI-Only:* Easy to implement, but fundamentally violates the project's non-negotiable server-authority and secrecy constraints.

### D6: Game Clock: Lazy-Only vs. pg_cron vs. Extended `health_ping()`
- **Recommendation:** **Extend `health_ping()` to advance active live games and run retention**, while keeping lazy client advancement as a zero-latency fallback. If pg_cron is available on the Supabase plan, schedule it every 30 seconds.
- **Trade-off:**
  - *Extended `health_ping()` + Lazy Fallback (Recommended):* Guarantees that matches progress and expire even if all runners/hunters close their phones or lose signal, without requiring a paid pg_cron tier.
  - *Lazy-Only:* If all players lose signal or close the app, match timers and scheduled pings freeze indefinitely until someone reopens the app.

### D7: Authentication: Email/Password Only vs. Guest/Anonymous Sign-In
- **Recommendation:** **Keep Email/Password as primary, but add an instant Guest Sign-In (`auth.signInAnonymously()` or local guest profile)** if email rate limits or confirmation friction block casual players.
- **Trade-off:**
  - *Email/Password:* Guarantees account recovery, persistent cross-device profile, and secure GDPR data export/deletion. However, Supabase's built-in email rate limit (3–4 emails per hour on free tier) can block new players during group onboarding.
  - *Guest Sign-In:* Eliminates onboarding friction for impromptu outdoor games, but account recovery is lost if local app storage is cleared.

### D8: iOS Platform Strategy (Phase B Item B13)
- **Recommendation:** **Reuse the existing Expo / React Native codebase** without any native Swift rewrite.
- **Trade-off:**
  - *Expo/React Native Shared Codebase (Recommended):* MapLibre React Native, `expo-location`, `expo-camera`, and `expo-audio` support iOS out of the box. Only permissions (`NSLocationAlwaysAndWhenInUseUsageDescription`) and an Apple Developer Account for TestFlight distribution are required.
  - *Native Swift Rewrite:* Unnecessary duplication of effort, doubling maintenance overhead.

---

## 4. Next Steps for Phase A

Upon receiving user decisions on D1 through D8:
1. **Milestone S1 (Security, Fairness & Timing) — COMPLETED:**
   - Server-side ping window enforcement (`ping_visible_s`, default 10 s) active in `get_game_state` and RLS policy on `public.pings`.
   - `pg_cron` scheduled every 30 s for `advance_active_games(10)`; `health_ping()` extended with bounded idempotent sweep and shared-secret validation.
   - Ghost NPC fairness gates: 3 s continuous dwell time, GPS accuracy gate ($\le 30\text{ m}$), velocity clamp ($\le 2.0\text{ m/s}$), play boundary clamping, and `ghost_mode` (`'haunt'` vs. `'assist'`).
   - Mock location detection emits `mock_location_detected` event.
   - Universal vehicle speed warning ($\ge 8\text{ m/s}$ for 10 s).
   - Guest sign-in enabled with mandatory consent gate, age confirmation (16+), and self-service export/deletion parity.
   - All tests passing (`npm run sim`, `npm run rls`, `npm run typecheck`).
2. **Milestone S2 (Mode & Spec Alignment) — COMPLETED:**
   - Enabled `double_agent` role in [src/lib/modeRegistry.ts](file:///c:/ASK_Main/ASK/Projects/GhostRun/src/lib/modeRegistry.ts#L122).
   - Added host settings for Double Agent Scramble charges (1–3 charges, 120 s cooldown) in [app/lobby/[id].tsx](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/lobby/[id].tsx#L482) persisted to `games.mode_params`.
   - Verified Dead Drops hold times (4–5 s hold, 15 m radius, 40 m reveal envelope) aligned across server and client.
   - Verified post-game recap stats parity (Closest Call with C3 private route guard, Longest Unseen, Loudest Moment, Heat Hit Rate, Drops Claimed) in [app/result/[id].tsx](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/result/[id].tsx#L658).
3. **Milestone S3 (Privacy & Hygiene):** Replace compliance claims in docs/copy, add comprehensive multi-asset account deletion test, and add GitHub Actions PR workflow.
4. **Milestone S4 (Release):** Assemble preview APK v2.4.0 with SHA-256 checksum, run through playtest checklists, and sign off.
