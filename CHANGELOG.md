# Changelog

All notable changes to the **GhostRun** project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
