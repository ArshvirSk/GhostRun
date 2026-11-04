# Changelog

All notable changes to the **GhostRun** project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
