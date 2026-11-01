# Changelog

All notable changes to the **GhostRun** project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
