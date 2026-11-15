# GhostRun v2.8.0 Release Notes — Master Release (Waves 1–6 Complete)

**Release Date:** 2026-11-15  
**Artifact:** `release/GhostRun-v2.8.0.apk`  
**Size:** 56,305,320 bytes (53.70 MB)  
**SHA-256 Checksum:** `095C1912D207176FA8F34CEE8657794E958805F363E2B60AA8967A7B69CC153D`  
**Version:** `2.8.0`  
**VersionCode:** `13`  
**Architecture:** `arm64-v8a`  
**Privacy Protocol:** `Version 3.0` (Consents C1–C9, 60-min anti-stalking delay)  
**Keystore:** `android/app/debug.keystore` (preserves seamless in-place APK updates)  

---

## Overview

GhostRun v2.8.0 is the definitive master milestone for the platform, bringing together all **6 Roadmap Waves** into a unified, battle-hardened real-world tactical GPS stealth chase experience.

This release introduces an operative network graph with unique `@handles`, friends presence indicators, a mathematically calibrated **Season Echo** scoring engine (ensuring sub-3.3% role disparity and anti-collusion protection), a privacy-first private friends board with a strict 60-minute anti-stalking delay, and completes the full suite of communication, safety, tournament, cross-platform, accessibility, and retention features.

---

## Key Highlights & Wave Deliverables

### 1. Operative Network & Identity (Wave 6 / FL1)
- **Global Unique Handles:** Clean `@handle` identity system with homoglyph/spoofing protection, 3–20 character limits, regex validation (`/^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$/`), and case-insensitive reservation safeguards.
- **Reporting & Moderation Pipeline:** Cryptographically logged player reporting system, in-game blocking with bidirectional contact suppression, and automated 24-hour moderation digests.

### 2. Friends Graph & Real-Time Presence (Wave 6 / FL2)
- **Mutual Operative Graph:** Canonical pair sorting (`least(user_a, user_b)`), friend invite links, mutual request acceptance, 7-day decline cooldowns, and full cascade cleanups on unfriend.
- **Lobby Host Presence (Consent C8):** Opt-in presence indicator showing active host lobbies to mutual friends on the Play tab, backed by 30-minute auto-expiry heartbeats.

### 3. Season Echo Scoring Engine & Calibration (Wave 6 / FL3)
- **Balanced Multi-Role Scoring:** Mathematically balanced rating formula evaluated across 600 simulated matches:
  $$\Delta \text{Echo} = 10 \times \text{Result} \times \left(1 + \frac{D - 1}{2}\right) \times \left(0.5 + 0.5 \times \frac{Y + 3 \times 0.5}{T + 3}\right) \times \text{DurationFactor}$$
- **Role Parity:** Runner/Hunter win-rate score disparity reduced to **0.6%–3.3%** across all ranked base modes (`classic_chase`, `tag_hunt`, `territory_pulse`).
- **Collusion & Farm Prevention:** 50% discount on rounds against the same opponent group after 3 rounds in a single day, plus a 6-round daily season cap.
- **Best-12 Season Rollups:** Season totals reflect an operative's top 12 scoring matches of the season.

### 4. Private Friends Leaderboard (Wave 6 / FL4)
- **Privacy-First Friends Board:** Tactical leaderboard visible exclusively to mutual connections with opt-in Echo score sharing (Consent C9).
- **60-Minute Anti-Stalking Delay:** Rounds completed within the last 60 minutes are strictly withheld from friends boards to prevent real-world trailing or routine profiling.
- **Zero Coordinate Leakage:** Friends board exposes discrete counters only (`timesGhostedThem`, `timesHuntedWith`, etc.) with absolute zero GPS coordinates, timestamps, or route polylines.

### 5. Pre-Game Readiness, Safety & Comms (Waves 1 & 2)
- **Pre-Game Ready Check (NF-04):** Dual-phase countdown with real-time GPS precision gating ($<20\text{m}$) and auto-abort timers.
- **Tactical Silent Alerts (NF-05):** Android Notification Channels configured for silent, vibration-only tactical immersion.
- **Safety Check-In & Night Curfew (NF-06):** In-game automated safety check-ins with 45-second response countdowns, inactivity alarms, and night warnings.
- **Rematch & Role Rotation Engine (NF-07):** One-tap post-match rematch voting preserving squad balance and fair role alternation.
- **Universal Invites & QR Scanner (NF-02):** Deep-link routing via `ghostrun.app/join/:code`, in-app QR code generator, and native camera scanner.
- **Tactical Team Radio (NF-08):** Team-scoped tactical audio messaging and pre-canned tactical quick-chips with rate limiting.
- **Boundary Rules & Geofences (NF-10):** Custom play area boundaries with customizable penalty modes (`auto_tag`, `reveal_live`, `buffer`).
- **150m Privacy Trimming (NF-11):** Shareable high-res match summary cards automatically trim the first and last 150 meters of route data.
- **Operative Medals & Achievements (NF-12):** 7 canonical achievement badges tracked in the You dossier.

### 6. Retention, Schedules & Squads (Wave 3)
- **Remote Push Notifications (NF-13):** FCM and Expo push pipelines for game mobilization, lobby alerts, and friend updates.
- **Scheduled Operations (NF-14):** RFC 5545 `.ics` calendar generation with operative RSVP management.
- **Season Recap ("Wrapped") (NF-15):** Monthly performance dossiers aggregating stealth time, hunter tags, and milestones.
- **Persistent Crews (NF-16):** Persistent squad rosters, crew management modals, and invite codes.
- **Seasonal Themes & Banners (NF-17/31):** Dynamic remote announcement banners and telemetry kill-switches.

### 7. Cross-Platform, Scale & Deep Immersion (Waves 4 & 5)
- **Official Web Gateway (NF-19):** High-performance static web companion at `/join`, safety protocols, and Apple Universal Links.
- **Tactical Internationalization (NF-20):** Full i18n support across English, Spanish, German, French, and Japanese.
- **iOS Enterprise Capabilities (NF-21):** Full iOS entitlements, background location modes, and universal links config.
- **Discord Dispatch Webhooks (NF-22):** Privacy-safe match mobilization, lobby alerts, and round recaps sent directly to Discord.
- **Universal Accessibility (NF-25):** Deuteranopia, Protanopia, and Tritanopia color palettes, scalable HUDs, and TalkBack cues.
- **Live Operations Admin Console (NF-26):** Role-based admin tools, dynamic mode disablement, and backend telemetry.
- **AI Game Master Spoken Narration (NF-33):** Screen-off tactical TTS speech announcements for radar pings and game events.
- **Tournament Event Mode (NF-23):** Realtime broadcast channels, delayed spectator buffer, and referee controls for large matches.
- **Wear OS Companion Protocol (NF-24):** Standalone watch HUD protocol with directional haptics, one-tap check-in, and emergency wrist SOS.
- **Tactical Replay Video Export (NF-27):** Frame-by-frame replay renderer with animated ghost trails and privacy trimming.
- **Community Rule Packs (NF-36):** Declarative, safe rule presets with physical safety validation and instant shareability.

---

## Privacy Protocol Version 3.0 Updates
- **Consent C8 (`show_presence`):** Controls visibility of active lobby hosting to mutual friends (default ON, toggleable in Settings).
- **Consent C9 (`share_echo`):** Controls sharing of Season Echo ratings and tier rankings on the private friends board (default ON, toggleable in Settings).
- **60-Minute Privacy Delay:** Friends board enforces a strict 60-minute delay before newly completed rounds reflect on the board.
- **Strict Data Minimization:** Head-to-head records and friends leaderboards contain zero coordinate or polyline telemetry.

---

## Automated Verification Suite
- `npm run typecheck` — **0 errors**
- `npm run test:registry` — **51/51 checks passed**
- `npm run test:handles` — **16/16 tests passed**
- `npm run test:friends` — **5/5 tests passed**
- `npm run test:echo` — **8/8 tests passed**
- `npm run calibrate:echo` — **600 rounds simulated, parity $\le 3.3\%$ verified**
- `npm run test:board` — **5/5 tests passed**
- `npm run test:diagnostics` — **17/17 tests passed**
- `npm run test:admin` — **3/3 tests passed**
- `npm run test:routes` — **57/57 tests passed**
