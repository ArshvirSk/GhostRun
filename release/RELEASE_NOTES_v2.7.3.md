# GhostRun v2.7.3 Release Notes — Typography, Tactical Onboarding & Story Navigation Release

**Release Date:** 2026-11-10  
**Artifact:** `release/GhostRun-v2.7.3.apk`  
**Size:** 177,068,688 bytes (168.87 MB)  
**SHA-256 Checksum:** `4DD1AFD697E7990901A17986DCB0BA8E86224F5707F2472155F30546F21CF1E8`  
**Keystore:** `android/app/debug.keystore` (preserves seamless in-place APK updates)  

---

## Overview

GhostRun v2.7.3 delivers a comprehensive typography migration to the paired **Archivo** and **Segoe UI** typefaces, introduces an overhead architectural city map with camera zoom and movement interpolation for the onboarding tour, adds dual-zone story navigation (tap left to step back, tap right to advance), and refines UI copy and layout margins across all tabs.

---

## Key Highlights

### 1. Offline Typography Pair: Archivo & Segoe UI
- **Local Asset Bundling:** Bundled all 7 TrueType font weights locally in `assets/fonts/` for 100% offline gameplay resilience:
  - `Archivo-Black` (900), `Archivo-Bold` (700), `Archivo-SemiBold` (600), `Archivo-Regular` (400)
  - `SegoeUI-Bold` (700), `SegoeUI-SemiBold` (600), `SegoeUI-Regular` (400)
- **Token Hierarchy (`src/theme/tokens.ts` & `src/ui/Text.tsx`):**
  - **Archivo:** Hero greetings, display headers, section titles, telemetry badges, numeric readouts, and capsule buttons.
  - **Segoe UI:** Briefings, body copy, descriptions, form inputs, and metric labels.
- Pre-loaded synchronously via `useFonts` in root layout (`app/_layout.tsx`) to eliminate FOUT.

### 2. Overhead Tactical City Map & Dynamic Camera
- Replaced empty grid lines in the Onboarding Tour with an overhead architectural scale model city map:
  - Dark mode: `assets/onboarding/tactical-city-map-portrait.jpg`
  - Light mode: `assets/onboarding/tactical-city-map-light.jpg`
- **Animated Camera Motion (`Animated.spring`):** Smoothly transitions zoom levels and pan coordinates from wide zone overview (1.0x) to close-up tactical pursuit (1.45x) on "Ghosts" and "Tag".
- **Animated Perimeter Zone:** The perimeter circle dynamically animates and contracts inward on "The Squeeze".
- **Dynamic Player Movements (`Animated.ValueXY`):**
  - Runners visibly scatter outward into city streets during "Head Start".
  - Hunters roam through central courtyards in "Hidden".
  - Concentric radar ping wave ripples outward and reveals decoy ghost markers in "The Ping".

### 3. Dual-Zone Story Touch Navigation
- **Left 50% Touch Zone:** Tapping the left half of the screen steps backward (`handlePrev()`) with tactile haptic feedback (`triggerHaptic('buttonTap')`).
- **Right 50% Touch Zone:** Tapping the right half of the screen steps forward (`handleNext()`).
- Bottom action card remains independent and unobstructed.

### 4. Floating Navbar & Profile Polish
- **Floating Navbar Margins (`_layout.tsx`):** Added explicit `start: 24, end: 24` alongside `left: 24, right: 24` to override Android Material/Yoga container constraints, ensuring the floating capsule maintains 24dp margins on all screen bezels.
- **Profile Codename:** Displayed with `@` prefix in all caps (`@{displayName.toUpperCase()}`) and `textTransform: 'uppercase'`.
- **Palette Overflow Fix:** Added `flexWrap: 'wrap'` to signature color swatches so all 8 choices wrap neatly inside the card.
- **Copy Cleanup:** Removed artificial sci-fi jargon (e.g. `GRID LIVE`, `CASE FILE`, `TACTICAL GRID · OPERATIONAL`) in favor of direct, player-focused copy (`PROFILE`, `FEATURED · CLASSIC CHASE`, `CAREER STATS`, `MATCH HISTORY`).

---

## Automated Verification Suite
- `npm run typecheck` — **0 errors**
- `node --import tsx scripts/test-tour-engine.ts` — **All 8 canonical tour beats and engine assertions passed**
- `npm run test:theme` — **15/15 tests passing**
- `npm run test:routes` — **57/57 tests passing**
- `npm run test:wizard` — **16/16 tests passing**
- Gradle Android Release Build (`assembleRelease`) — **BUILD SUCCESSFUL**
