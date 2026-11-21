# GhostRun Release Notes — Wave v2.9.16

**Release:** `v2.9.16`  
**Version Code:** `31`  
**Milestone:** v3.0 Wave 16 (Pillar 4: Post-Match Glory & 2D Animated Replay Telemetry)  
**Target Environment:** Dual-device physical real-world field deployment (`RZCWA2BC80T` & `RZGL30WT2EJ`)  
**Commit Status:** Verified across unit, privacy, and full TypeScript diagnostics.

---

## Executive Summary

Wave v2.9.16 implements **Pillar 4: Post-Match Glory & 2D Animated Replay Telemetry**, delivering a native, high-octane 9:16 vertical Story Card generator formatted specifically for Instagram Stories, Snapchat, and WhatsApp Status, alongside upgraded 2D replay scrubbing controls with smooth multi-speed cycles and instant tag climax navigation.

---

## Core Capabilities Delivered

### 1. One-Tap 9:16 Shareable Vertical Story Card Generator (`StoryCardExportModal.tsx` & `storyCardCore.ts`)
- **Strict 9:16 Vertical Aspect Ratio**: Math-validated aspect ratio (0.5625) rendering perfectly scaled story cards for modern social sharing.
- **Dynamic Mode-Aware Glory Badges**:
  - **Outbreak Horde Survivor**: `SURVIVED 14M 22S • EVADED 4 INFECTED • EXTRACTED` with emerald `IMMUNE EXTRACTION` badge.
  - **Outbreak Horde Patient Zero**: `PATIENT ZERO // 5 INFECTED • SWARM VECTOR UNLEASHED` with crimson `OUTBREAK APEX` badge.
  - **Classic Runner**: `EXTRACTED • 3.2 KM EVADED` with `MISSION ACCOMPLISHED` badge.
  - **Classic Hunter**: `APEX PREDATOR • 4 CAPTURES • INTERCEPT DOMINANCE` with `SECTOR SECURED` badge.
  - **Valiant Fall / Evasion**: Tactical fall badges for captured operatives highlighting endurance before extraction.
- **Tactical Route Radar Vector Viewport**:
  - Enforces **NF-10 150m Privacy Buffer**: First 150m (origin) and last 150m (destination) are strictly trimmed before coordinate normalization.
  - **Zero Absolute GPS Leaks**: GPS coordinates are translated strictly into local relative screen pixels `[0, width] x [0, height]` within an Obsidian dark `#05070D` radar box with concentric rings and crosshairs.
  - Glowing start beacon (emerald ring) and finish beacon (cyan/crimson ring).
  - When trail is under 350m or confidential, automatically switches to a classified tactical radar notice preserving operational privacy.
- **Embedded QR Code Pod**:
  - Generates cross-platform 24-bit uncompressed BMP QR code via pure JS in ~1.5ms with zero native crashes.
  - Encodes direct lobby join invite link `https://ghostrun.app/join/[CODE]` for instant social infiltration.
- **High-Fidelity Export & System Share**:
  - One-tap `captureRef` rasterization into high-resolution PNG with seamless `expo-sharing` integration and text fallback.

### 2. Multi-Speed Scrubbing & Tag Climax Navigation (`app/replay/[id].tsx`)
- **Multi-Speed Replay Sequence**:
  - Expanded replay playback speed from 1x/10x to smooth cycling sequence: `[1×, 2×, 5×, 10×]`.
  - Driven by `cycleReplaySpeed` pure function.
- **Tag Climaxes Instant Seek**:
  - Added dedicated **Prev Tag** and **Next Tag** buttons to the replay bottom dock.
  - Instantly snaps scrubber cursor to the exact timestamp of high-adrenaline tag moments.
- **Replay Story Export Button**:
  - Added dedicated `Story (9:16)` export button directly in the replay controls bar so players can export post-match stories directly while replaying missions.

### 3. Debrief Screen Integration (`app/result/[id].tsx`)
- Integrated `Export Story Card (9:16)` as a primary action button on Card 6 (Mission Recap Card) in the results carousel alongside `Share Mission Recap Card`.
- Directly connects debrief telemetry, player stats, and trail points to the 9:16 story exporter.

---

## Architectural & Security Verification

1. **Test Suite `scripts/test-story-export.ts`**:
   - Multi-speed cycling sequence `[1x, 2x, 5x, 10x, 1x]`.
   - Dynamic glory headlines for all game modes and asymmetric roles.
   - Tactical triad formatting (distance, duration, top speed).
   - Strict 150m privacy start/finish trimming and 0% GPS coordinate leakage.
   - Next/Prev tag climax search and boundary limits.
   - 9:16 aspect ratio geometry calculations.
   - Story share copy formatting.
2. **Tactical Audio & Horde Mode Regressions**:
   - Verified `test-tactical-audio.ts` (56/56 passing tests).
   - Verified `test-outbreak-horde.ts` (11/11 passing tests).
   - Combined test suite: **74/74 passing tests (100% pass rate)**.
3. **TypeScript Strict Type Check**:
   - `npx tsc --noEmit` cleanly passes with **zero warnings, zero errors**.
