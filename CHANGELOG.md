# Changelog

All notable changes to the **GhostRun** project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Phase B: Milestone B8 — Territory Pulse Base Mode (docs/MODES.md §4.6)
- **Mode Registration & Configuration:**
  - Added enum value `territory_pulse` to `public.game_mode` and updated `games_mode_id_check` constraint.
  - Added `territory_pulse` to `mode_catalogue()` with feature flag `feature.mode.territory_pulse` enabled.
  - Registered `territory_pulse` in client `src/lib/modeRegistry.ts` with teams `['runner', 'hunter']` and compatible roles/modifiers.
  - Added mode selection button, preview card, and default `mode_params` configuration in `app/create.tsx`.
- **Procedural Sector Spawning & Pulse Cadence:**
  - Implemented `spawn_territory_zones(game_id)` spawning 7 tessellated sectors (`entities.kind = 'zone'`): central Sector Core and 6 radial sectors (Alpha through Foxtrot) spaced at $60^\circ$ offsets.
  - Configurable pulse interval (default 90 s, down to 2 s for desk testing).
  - Synchronous pulse evaluation in `advance_game`: tallies non-remote, active, non-incapacitated players in each sector via `st_dwithin`.
  - Neutral sectors claimed immediately on strict player majority.
  - Owned sectors require majority across 2 consecutive pulses to flip (`contender` tracking); defending clears contender.
  - Each held sector scores +1 point per pulse for controlling team.
- **Contest Tagging & Non-Elimination Incapacitation:**
  - In `apply_tag`, hunter tagging a runner applies a 60-second incapacitation timer (`status_detail->'incapacitated_until'`) and emits `contest_tag` event without eliminating player from the match.
  - Incapacitated players remain active on the field but are excluded from sector majority tallies.
- **Dual Victory Conditions:**
  - Dominance victory: controlling $\ge 70\%$ of sectors ($\ge 5$ of 7) across 2 consecutive pulses, or all 7 sectors simultaneously (`end_reason = 'territory_dominance'`).
  - Points victory on match duration timeout (`end_reason = 'points_victory'`, or `'draw'`).
- **Client Map & UI Experience:**
  - MapLibre GeoJSON layers render 7 colored territory rings and radial points: neutral (`#94A3B8`), runner-controlled (`#06B6D4`), and hunter-controlled (`#EF4444`).
  - Top HUD eyebrow, pulse countdown timer, real-time score tracker, and occupied sector status chip.
  - Dedicated 7-sector status card in bottom sheet.
  - Result screen debrief card with sector metrics and mode-specific winner titles.
- **Database Migrations Applied to Production:**
  - `20261116000000_b8_territory_pulse_enum.sql`: Added `territory_pulse` to `public.game_mode`.
  - `20261116001000_b8_territory_pulse_lifecycle.sql`: Sector spawning, lifecycle, scoring, and snapshot in `get_game_state`.
  - `20261116002000_b8_territory_pulse_tag.sql`: Contest tag support in `apply_tag`.
  - `20261116003000_b8_territory_pulse_constraint.sql`: Added `territory_pulse` to `games_mode_id_check`.
  - `20261116004000_b8_fix_get_game_state_color.sql`: Corrected `pr.color` column reference in `get_game_state`.
- **Harness Verification:**
  - Added `territoryPulseScenario()` to `scripts/sim/index.ts` verifying 7 sector spawning, neutral capture, pulse scoring, contest tagging incapacitation, exclusion of incapacitated runners, and 2-pulse flip dynamics.

### Phase B: Milestone B6 — Solo Ghost Duel Base Mode (docs/MODES.md §6.2)
- **Mode Registration & Variant System:**
  - Added `ghost_duel` base mode to `mode_catalogue()` with feature flag `mode.ghost_duel`.
  - Registered `ghost_duel` in client `src/lib/modeRegistry.ts` with teams `['runner', 'hunter']` and variant picker (`time_trial`, `evade`, `mirror_chase`).
  - Added variant selector pills in `app/create.tsx` setup sheet with `mode_params` wiring.
  - Solo start enabled: lobby allows 1 player, auto-assigns runner/hunter team based on variant.
- **Server Authority & Ghost Simulation:**
  - Ghost entity spawned from `ghost_library` (or synthetic benchmark path) at game start via `spawn_ghost_npcs`.
  - Finish target placed at terminal point of ghost path with configurable radius.
  - Ghost position interpolated along stored path by elapsed time; exposed in `get_game_state` snapshot.
  - `submit_position` evaluates Ghost Duel win conditions inline:
    - **Time Trial:** target arrival within radius → scores player time, ghost time, split delta $\Delta t$, route efficiency, and composite score.
    - **Evade:** runner within $\le 20\text{ m}$ of ghost → `end_reason = 'haunted'`, hunters win.
    - **Mirror Chase:** `tag_ghost` RPC validates $\le 10\text{ m}$ proximity to ghost entity → `end_reason = 'ghost_tagged'`, runners win.
  - Scoring formula: `score = max(100, 1000 + delta_s × 10 + efficiency × 200)` with route efficiency = straight-line distance / actual trail distance.
- **Ghost Duel Scores & Leaderboard:**
  - Created `ghost_duel_scores` table with RLS (owner-only read, server-only insert).
  - Implemented `get_ghost_duel_leaderboard(lat, lng, radius_m, variant, row_limit)` RPC with C5 consent-aware name display.
- **Client HUD & Game Screen:**
  - Ghost entity rendered as cyan blip with animated pulse halo on map.
  - Finish target rendered as emerald ring with point marker.
  - Top HUD eyebrow with mode title, variant badge, phase-aware copy (countdown, head start, live, ended).
  - Stats row with compact chips: Target Distance, Ghost Distance, Finish Distance, Clock.
  - Mirror Chase floating dock action button: `TAG GHOST (X m)` enabled within 10 m.
  - Bottom sheet Ghost Duel card with Tag Ghost button.
- **Result Screen:**
  - Winner titles per variant and outcome: "Ghost Beaten!", "Ghost Won", "Ghost Tagged!", "Ghost Escaped", "Haunted", "Evaded Successfully!".
  - Dedicated Solo Ghost Duel Debrief card: Final Score, Your Time vs Ghost Time, Route Efficiency %, variant badge, Top 5 Duel Leaderboard table.
  - Ghost Contribution preview card enabled for `ghost_duel` mode.
- **Database Migrations (8 applied to production):**
  - `20261114000000_b6_ghost_duel_schema.sql`: Core table, RLS, leaderboard RPC, tag_ghost RPC.
  - `20261114001000_b6_ghost_duel_lifecycle.sql`: Mode catalogue, lifecycle handlers, scoring, end reasons.
  - `20261114002000` through `20261114007000`: Incremental fixes for feature flag format, parameter ambiguity, enum casts, column schemas, and submit_position Ghost Duel integration.
- **Verification:**
  - Simulator scenario `ghost-duel` passing 10/10 automated checks across all 3 variants.
  - `npm run typecheck` passing with 0 errors.

## [2.5.0] — 2026-11-05

### Overview
Release 2.5.0 delivers Phase B Milestones B1 through B5, featuring 3 brand new base game modes and 2 tactical role add-ons with full server authority, zero-knowledge secrecy, and automated end-to-end simulation coverage.

- **APK Artifact:** `release/GhostRun-v2.5.0.apk` (165.65 MB)
- **APK SHA-256:** `B95519BC303B8696EB67E89E106CF4D72D38168D5A97AFC8C94EB7E3C48EA1BB`
- **Android versionCode:** `5` | **versionName:** `2.5.0`

### Phase B: Milestone B5 — Operator Remote Role Add-on (docs/MODES.md §5.3)
- **Role Integration & Remote Designation (D18):**
  - Added `'operator'` role to `secret_role` enum and configured `role_catalogue()` with `'operator'` role add-on.
  - Enabled Operator role in `src/lib/modeRegistry.ts` for `classic_chase`, `tag_hunt`, `jailbreak`, and `relay_heist`.
  - Added self/host remote operator designation RPC `set_player_remote(p_game_id, p_is_remote, p_player_id)` with a strict limit of 1 operator per squad.
  - Enforced active field player validation in `start_game` so squads must have physical field players.
- **Remote Operator Lifecycle & GPS Bypass:**
  - Remote operators bypass spatial tracking: `submit_position` short-circuits immediately with zero GPS storage.
  - Remote operators are immune to tagging (`attempt_tag` and `apply_tag` reject tags against remote players) and cannot tag others.
  - Automatic disable of location sharing and GPS tracking on client HUD for remote operators.
- **Tactical Markers & Team Secrecy:**
  - Implemented `place_marker` and `clear_marker` RPCs allowing remote operators to place up to 3 tactical markers (90-second TTL, auto-prunes oldest).
  - RLS strictly enforces squad-only visibility: runner markers are hidden from hunters and vice versa; outsiders receive 0 rows.
- **Tactical Reconnaissance Scans (D19, D20):**
  - Implemented `operator_scan` RPC with 90-second squad cooldown.
  - Runner Operator Tactical Sweep: detects nearest active hunter with a fresh fix ($\le 45\text{ s}$), returning a 150 m circular envelope fuzzed pseudorandomly by 10–30 m via deterministic hash, valid for 10 seconds. Raw hunter GPS coordinates are never leaked to clients.
  - Hunter Operator Sector Census: scans a 200 m radius at operator-chosen map coordinates strictly within boundary limits, returning an integer census count of active runners only.
- **Tactical Radio Comms:**
  - Implemented `send_operator_message` RPC allowing short tactical directives (up to 120 chars) broadcast to squad teammates via live event feed.
- **Client & HUD:**
  - Lobby UI: added remote toggle button `[Op]` in player roster with `[Operator]` sub-label and remote status indicators.
  - Game HUD: added "MISSION CONTROL: OPERATOR" tactical banner, "+ MARK" waypoint placement mode, and "SCAN" dock action button.
  - Map rendering: MapLibre GeoJSON layers for tactical markers with pulse animations and 150 m scan envelopes.
- **Verification:**
  - Simulator scenario `operator` passing 14/14 automated checks (`scripts/sim/index.ts`).
  - RLS test suite `npm run rls` passing 100% of operator secrecy and security checks.

### Phase B: Milestone B4 — VIP Escort Role Add-on (docs/MODES.md §5.2)
- **Role Integration & Secrecy:**
  - Added `'vip'` and `'bodyguard'` secret roles to `secret_role` enum and registered `'vip'` role add-on in `role_catalogue()`.
  - Added VIP Escort role compatibility in `src/lib/modeRegistry.ts` for `tag_hunt` and `classic_chase`.
  - Server-side role secrecy: hunter clients cannot read runner `secret_role` during live play; radar pings and positions are indistinguishable from normal runners. Secrecy is lifted post-match.
- **Bodyguard Freeze Mechanics (D15):**
  - Tagging a bodyguard immobilizes them for 60 seconds (`status_detail->'frozen_until' = now() + 60s`) instead of eliminating them.
  - While frozen, bodyguards cannot move outside a 10 m dwell zone, cannot swap roles, and cannot be re-tagged (`already_frozen`).
  - Emits `bodyguard_frozen` event: runners see teammate identity and timer; hunters receive anonymous confirmation that an escort was incapacitated.
- **VIP Elimination & Tactical Swap (D16, D17):**
  - Tagging the VIP eliminates them and ends the match immediately (`winner = 'hunters'`, `end_reason = 'vip_eliminated'`).
  - Tactical physical role swap: mutual proximity ($\le 5\text{ m}$) protocol (`request_role_swap`, `confirm_role_swap`, `cancel_role_swap`) with a 15-second acceptance window and 120-second cooldown.
  - Offline fail-safe: VIP offline $> 60\text{ s}$ triggers auto-promotion of an active bodyguard (`vip_promoted`).
- **Client & HUD:**
  - Runner HUD displays squad VIP tracker, distance to VIP, and bodyguard role status.
  - Frozen bodyguard banner with real-time countdown timer and restricted movement alert.
  - Nearby role swap prompt and mutual confirmation bottom sheet modal.
  - Post-game results and replay screen displays VIP and GUARD badges alongside `vip_eliminated` win reason.
- **Verification:**
  - Simulator scenario `vip-escort` passing 10/10 automated checks.
  - Full test suite passing: `npm run typecheck` (0 errors), `npm run lint` (0 errors), `npm run rls` (100% checks passing), and `npm run sim` (all 6 base modes and role scenarios passing).

### Phase B: Milestone B3 — Relay Heist Base Mode (docs/MODES.md §4.5)
- **Base Mode Integration:**
  - Added `relay_heist` base mode enum, catalogue entry in `mode_catalogue()`, and mode configuration validation.
  - Added `relay_heist` mode registry rules in `src/lib/modeRegistry.ts` and lobby selection in `app/create.tsx`.
  - Added host extraction point placement in `app/lobby/[id].tsx` with validation and boundary clamping.
- **Server Authority & Secrecy:**
  - Mandatory host extraction point placement (`set_extraction_location`) validated before start.
  - Designated initial carrier randomly from active runners at match start; package entity created with `visible_to = 'runner'` for live secrecy.
  - Physical handoff protocol (`request_handoff`, `confirm_handoff`) requiring $< 5\text{ m}$ proximity and 15-second mutual confirmation window.
  - Carrier burden: $1.5\times$ radar ping cadence, item lock, and position broadcast to teammates.
  - Package drop mechanics: tagging the carrier drops the package at their coordinates; dropped package pulses radar beacon every 15 s until recovered or secured.
  - Drop contest: surviving runners can recover dropped package within 10 m (`pickup_package`); hunters can execute a 20-second continuous hold (`start_securing_package`, `complete_secure_package`, `cancel_securing_package`) to secure the package.
  - Win conditions: extraction victory when carrier enters extraction zone (`winner = 'runners'`, `end_reason = 'extraction_complete'`); package secured victory when hunters complete hold (`winner = 'hunters'`, `end_reason = 'package_secured'`); or timeout.
  - Inactivity auto-drop: carrier going offline for > 60 seconds drops the package at their last known fix.
- **Client & HUD:**
  - Rendered extraction zone fill, outline, and marker on live MapLibre map.
  - Rendered dropped package beacon marker and radar pulse ring on map.
  - Added carrier handoff request and receiver confirmation action cards in bottom sheet.
  - Added runner pickup card and hunter 20-second hold-to-secure action button with animated progress.
  - Results screen support for `extraction_complete` and `package_secured` win reasons.
- **Verification:**
  - Passed `npm run sim relay-heist` and full simulator suite (`npm run sim`).
  - Added dedicated Relay Heist RLS and secrecy checks in `scripts/rls-check.ts` (100% pass).

### Phase B: Milestone B2 — Assassin Ring Base Mode (docs/MODES.md §4.3)
- **Base Mode Integration:**
  - Added `assassin_ring` base mode enum, team type `'solo'`, and mode catalogue entry in `mode_catalogue()`.
  - Added `assassin_ring` mode registry rules in `src/lib/modeRegistry.ts` and lobby selection in `app/create.tsx`.
  - Added solo roster support and 3+ player threshold in `app/lobby/[id].tsx`.
- **Server Authority & Secrecy:**
  - Implemented circular Hamiltonian cycle contract permutation generation in `start_game` stored in `public.ring_assignments`.
  - Zero-knowledge secrecy: RLS policy `ring_assignments_select` ensures each player only reads their assigned active prey. Stalker identity and ring layout remain hidden until the game concludes.
  - Directionless proximity warnings: amber proximity warning when hunter $\le 100\text{ m}$, rapid red pulse when hunter $\le 40\text{ m}$.
  - Safe zones: auto-places 2 safe zones (20 m radius) inside the boundary (host-adjustable via `set_safe_zone_location`). Tagging is disabled inside safe zones, and scheduled radar pings are masked.
  - Contract relinking: eliminated players are removed from active play; their hunter inherits their prey contract ($P_{hunter} \to P_{prey's\_prey}$).
  - Win conditions: last survivor wins (`winner = 'solo'`, `end_reason = 'last_survivor'`), or timeout with most eliminations.
  - Offline inactivity timeout: automatically eliminates players who stop sending position fixes for > 3 minutes while live and relinks the contract ring.
- **Client & HUD:**
  - HUD displays assigned prey profile, status, and live directional tracking against prey.
  - Added hunter proximity sensory warning indicator and haptic feedback.
  - Safe zone visual indicators and tag disabled banner.
  - Results screen support for solo winners and `last_survivor` outcome.
- **Verification:**
  - Passed `npm run sim assassin-ring` and full simulator suite (`npm run sim`).
  - Added 13 dedicated Assassin Ring access and secrecy checks in `scripts/rls-check.ts` (100% pass).

### Phase B: Milestone B1 — Jailbreak Base Mode (docs/MODES.md §4.1)
- **Base Mode Integration:**
  - Added `jailbreak` base mode enum and registry entry in `src/lib/modeRegistry.ts` and `app/create.tsx`.
  - Added host-authoritative `set_jail_location` RPC and interactive map placement in `app/lobby/[id].tsx`.
- **Server Authority & Secrecy:**
  - Migrated `jail` entity placement within the play boundary with mandatory host configuration before start.
  - Added `'jailed'` player status: tagged runners transition to `'jailed'`, excluded from scheduled radar pings, and teammate location broadcast paused.
  - Implemented `start_rescue`, `complete_rescue`, and `cancel_rescue` SECURITY DEFINER RPCs requiring 10-second continuous hold inside 10m radius.
  - `rescue_started` and rescue hold events are concealed from hunters to prevent camp baiting.
  - Implemented auto-release after `auto_release_s` (default 300s / 5 min) and automatic emergency jail evacuation if overrun by shrinking safe zone.
  - Hunters win on `all_jailed` (all runners jailed simultaneously); runners win on match timer expiration with active runners.
- **Client & HUD:**
  - Rendered distinct jail boundary ring, center marker, and radius overlay on live game map.
  - Added jailed HUD state, countdown badge, hold-to-rescue progress bar button, and audio cues.
  - Post-round results screen displays `all_jailed` win reason and roster statuses.
- **Verification:**
  - Passed `npm run sim jailbreak` and full simulation suite (`npm run sim`).
  - Added 11+ dedicated Jailbreak access control checks in `scripts/rls-check.ts` (100% pass).

## [2.4.0] — 2026-11-01

### Phase A: Stabilisation & Spec Alignment Sign-Off
- **S1 (Security, Fairness & Timing):**
  - Enforced `ping_visible_s` (default 10s) server-side during live rounds; full ping history revealed only post-match.
  - Added `pg_cron` schedule advancing active games every 30s; hardened `health_ping()` with bounded execution, retention cleanup, and shared-secret validation.
  - Ghost NPC fairness gates: 3-second continuous dwell requirement, GPS accuracy gate ($\le 30\text{ m}$), velocity cap ($\le 2.0\text{ m/s}$), boundary clamping, and `ghost_mode` (`haunt` vs `assist`).
  - Added mock-location detection event (`mock_location_detected`) and universal vehicle speed warnings ($\ge 8\text{ m/s}$ for 10s).
  - Implemented guest/anonymous authentication with full parity across consent gate (C1–C6), age confirmation (16+), and self-service export/deletion.
- **S2 (Mode & Spec Alignment):**
  - Activated Double Agent role in lobby registry with host-configurable Scramble charges (1–3) and cooldown.
  - Aligned Dead Drops hold parameters (15m radius, 40m reveal, 4–5s claim hold) and tactical item pools.
  - Added post-match recap metrics (Closest Call guarded by C3 private route consent, Longest Unseen, Loudest Noise, Heat Hit Rate, Drops Claimed).
- **S3 (Privacy & Release Hygiene):**
  - Purged all legal/GDPR claims from documentation and UI copy in favor of neutral privacy controls and consent terminology.
  - Added automated multi-asset account deletion test in `scripts/rls-check.ts`.
  - Added GitHub Actions CI workflow in `.github/workflows/ci.yml`.
  - Added `docs/RELEASE.md` release checklist.
- **S4 (Release):**
  - Bumped version to `2.4.0` (versionCode `4`).
  - Verified SHA-256 APK checksum: `9D8D78077D3B077D1EE126A6827D13A6B1EC905DE4FF748CE08FABD4A3076E02`.

---

## [2.3.0] — 2026-11-01

### Added
- Sensory Audio SFX engine with procedural 16-bit 44.1kHz sound effects (ping, hot, cold, tag, whisper, victory, defeat, scan).
- HUD master SFX mute toggle with device persistence.
- Camera-based QR tagging viewfinder with animated laser reticle and dynamic runner QR card.
- Concentric expanding radar ping ripple animations on live map.

---

## [2.2.0] — 2026-11-01

### Added
- Haunted Map NPC simulation engine with historical runner routes replayed as autonomous AI entities.
- Ghost Library contribution flow with automated 150m privacy start/end trimming and Douglas-Peucker trail simplification.
- Self-service ghost route inspection and deletion in Settings.

---

## [2.1.0] — 2026-11-01

### Added
- Hot & Cold Hunt binary proximity sensor with shared team charge pool and area-fuzzed radius.
- Noise Meter modifier with EMA speed smoothing and acoustic alert thresholds.
- Dead Drops modifier with tactical runner items (Veil, Decoy, Recon) and hunter items (Free Ping, Jam, Sweep).
- Shrinking Zone modifier with multi-stage boundary contraction.
- Double Agent hidden role with Whisper and Scramble abilities, and emergency Tribunal voting.

---

## [2.0.0] — 2026-11-01

### Added
- v2 Mode Framework: Base mode, role add-on, and modifier layering.
- Granular Consent Architecture (C1–C6) and mandatory pre-game route-sharing prompt (C3).
- 30-day automated cascading retention via `cleanup_old_games()`.
- Self-service data export bundle and account deletion.

---

## [1.0.0] — 2026-10-31

### Initial Production Release
- Classic Chase and Tag Hunt base modes.
- Asymmetric radar pings with server-enforced RLS secrecy.
- MapLibre GL Native mapping with OpenFreeMap vector styles.
- Android foreground service background location tracking.
- Post-match interactive replay scrubbing and emergency SOS beacon.
