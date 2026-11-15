# GhostRun v2.9.0 Release Notes — Extreme Blackout Radar & Tactical Navigation

**Release Date:** 2026-11-15  
**Artifact:** `release/GhostRun-v2.9.0.apk`  
**Size:** 56,561,664 bytes (53.94 MB)  
**SHA-256 Checksum:** `2649B8B722522F0445D03FD66967D53220FF02ABFE1E581E9B5EAF2D137A2D16`  
**Version:** `2.9.0`  
**VersionCode:** `15`  
**Architecture:** `arm64-v8a`  
**Privacy Protocol:** `Version 4.0` (Aligned with GhostRun v2.9.0)  
**Keystore:** `android/app/ghostrun.keystore` (SHA-1: `9A:D1:6B:4E:A1:D5:F2:0B:99:D8:01:30:CB:FE:2F:00:E0:E3:C9:A0`)  

---

## Overview

GhostRun **v2.9.0** introduces the game-changing **Extreme / Blackout** difficulty mode featuring a 360° tactical radial sonar heatmap that strips away standard street tiles for pure sensory stealth navigation. This release also delivers dynamic zone creation with tap-to-place freedom, smooth camera zoom transitions, non-interactive live operative heading locks, a movable 4-corner headstart mini-map, streamlined lobby card layouts, and privacy protocol version synchronization.

---

## Key Highlights & Changes

### 1. New Difficulty Mode: Extreme / Blackout (`blackout`)
- **Obsidian Sonar Radar Canvas (`TacticalRadarCanvas.tsx`):**
  - Completely hides standard street map tiles, placing operatives into a radar-driven stealth environment.
  - Features concentric distance rings (25%, 50%, 75%, 100% of scale), crosshairs, cardinal North indicator, and a rotating sonar sweep beam.
- **Fixed & Centered Operative Azimuth:**
  - Operative remains locked at the exact center `(cx, cy)` of the radar screen.
  - Forward orientation permanently faces 12 o'clock (straight ahead), rotating seamlessly with phone compass azimuth.
- **Proximity-Scaled Thermal Heat Map:**
  - **Hunters:** Rendered as pulsing tactical **red** thermal heat signatures.
  - **Seekers / Runners:** Rendered as glowing **cyan / blue** heat signatures.
  - Heat bloom radii and pulse intensity dynamically expand as contacts close in, providing immediate tactical awareness within tag range.
- **Inner Zones & Straight Dotted Vector Lines:**
  - Game modes with inner objectives (Target in Classic Chase, Jail in Jailbreak, Extraction in Relay Heist, Safe Zones in Territory Pulse) render target icons at precise relative bearings.
  - High-visibility straight dotted vector lines connect the operative center directly to each objective with distance tags.
- **Empirical Unit Integration:**
  - Distance readouts strictly follow the operative's preference configured in Settings (**metric** `m`/`km` or **imperial** `ft`/`mi` via `formatDistance`).
- **Interactive Radar Scale:**
  - Operatives can toggle between 150m, 300m, 600m, and 1200m range views via bottom selector chips.

### 2. Zone Creation & Area Setup Enhancements
- **Free Tap Repositioning (`app/host/area.tsx`):**
  - Operatives can tap anywhere on the map to immediately recenter and place the boundary perimeter without needing to tap inside an existing zone circle.
- **Instantaneous Recenter Snap & Detached Control:**
  - Fast-path 0ms GPS snap via Android fused location cache (`getLastKnownPositionAsync`) and zero-lag camera snap (`jumpTo`), followed by background live lock.
  - Floating recenter FAB elevated with a clean 25px airspace above the bottom Continue button dock, eliminating overlap.
- **Smooth Zone Size Camera Transitions:**
  - Changing zone radius activates dynamic camera animations (`easeTo` 500ms) with auto-calculated altitude zoom (`getZoomForRadius`).
- **Compass & Logo Cleanup:**
  - Disabled default MapLibre compass and watermark logos across all game, area, replay, and result screens for a sleek, unobtrusive tactical UI.

### 3. Step 2 Rules: 2x2 Presets Grid & Dynamic Unhighlighting
- **2 x 2 Presets Grid Layout (`app/host/rules.tsx`):**
  - Transformed difficulty selector from a compressed single-row chip strip into an expansive 2x2 responsive card grid (Row 1: `CASUAL` | `STANDARD`; Row 2: `HARDCORE` | `BLACKOUT`).
- **Dynamic Preset Unhighlighting on Setting Modification:**
  - Adjusting any rule stepper (Head Start, Round Duration, Ping Cadence, Tag Radius, Boundary Excursion Penalty, or Mode Parameters) immediately unhighlights all presets and displays a tactical `CUSTOM` badge.
  - Verified with dedicated test suite `scripts/test-rules-presets.ts`.

### 4. Comprehensive Mission Lobby Overhaul (`app/lobby/[id].tsx`)
- **Full Visibility for Unassigned & All Operatives:**
  - Expanded ScrollView bottom clearance to `+ 190px` and slimmed the floating action dock down from ~210px to ~95px, completely eliminating any overlap so every operative card is 100% visible even at maximum scroll.
- **Dedicated Team Roster Cards:**
  - Replaced scattered text rows with cohesive cards for **Runners** (cyan/teal), **Hunters** (orange/coral), and **Unassigned Operatives**.
  - Integrated visual team count chips, `[YOUR SQUAD]` active indicators, and prominent `[JOIN RUNNERS]` / `[JOIN HUNTERS]` buttons.
- **Uncluttered Action Dock:**
  - Removed the cramped 3-button utility row that caused awkward line wrapping (`CANCEL MISSIO N`).
  - Moved **Rotate Roles** and **Shuffle Squads** into a clean **Host Roster Controls** card inside the Roster tab.
  - Floating dock is now dedicated strictly to `[READY UP] / [STAND DOWN]` and `[LAUNCH ROUND] / [TARGET SELECT]`.
- **Top Navigation Bar & Mission Access Card:**
  - Added a clean top navigation back button with native confirmation dialogs (cancelling mission for host, leaving lobby for operative).
  - Designed a high-contrast Mission Code card with side-by-side `[SHARE]` and `[QR CODE]` actions.
- **Compass Heading Lock in Live Rounds (`src/game-shell/MapView.tsx`):**
  - In standard and hardcore modes, the live map locks onto the operative's position and rotates smoothly with physical phone movement, preventing accidental manual map spins or panning during intense chases.
- **Lobby Advanced Host Controls (`app/lobby/[id].tsx`):**
  - Host configuration card now includes quick switches to enable/disable **Tactical Heading Lock** and **Radar Blackout** directly prior to launch.

### 5. Movable 4-Corner Headstart Mini-Map
- **Runner Headstart Contracting:**
  - During the runner headstart phase, the full-screen map contracts into a compact corner widget displaying live headstart countdown time.
  - Automatically transitions back to full-screen view once the headstart countdown expires.
- **Sticky 4-Corner Physics (`MovableCornerMiniMap.tsx`):**
  - Operatives can drag the mini-map during gameplay; it snaps strictly to the nearest of the 4 screen corners via spring physics, maintaining fixed non-resizable dimensions.
- **User Preference in Settings (`app/settings.tsx`):**
  - Toggle switch to enable or disable the headstart mini-map.
  - Corner selector to choose the default starting quadrant (`TOP-LEFT`, `TOP-RIGHT`, `BOTTOM-LEFT`, `BOTTOM-RIGHT`).

### 5. Privacy Protocol Alignment & Version Consistency
- **Privacy Header Alignment (`app/privacy.tsx`):**
  - Corrected privacy screen header from legacy "Version 3.0" label to `GhostRun v{APP_VERSION} · Updated 2026-11-15`.
- **Policy Changelog Bump (`src/lib/privacy.ts`):**
  - Documented Release v2.9.0 features including stealth telemetry and localized proximity blooms.
- **Unified Semantic Versioning:**
  - Synchronized `v2.9.0` (versionCode `15`) across `package.json`, `package-lock.json`, `app.json`, `android/app/build.gradle`, `diagnosticsCore.ts`, and test suites.

---

## Verification & Test Results
- **Blackout Radar & Bearing Engine:** 4/4 tests passed (`scripts/test-blackout-radar.ts`).
- **Mini-Map Corner Physics:** 3/3 tests passed (`scripts/test-minimap-corner.ts`).
- **Route Resolution & Shims:** 61/61 route checks passed.
- **Diagnostics & App Version:** 17/17 tests passed verifying `APP_VERSION === '2.9.0'`.
- **Community Rule Packs:** 4/4 tests passed.
- **TypeScript Typecheck:** Clean exit with 0 errors (`tsc --noEmit`).

---

## Verification Commands
```bash
npm run typecheck
npm run test:routes
npm run test:blackout
npm run test:minimap
npm run test:diagnostics
npm run test:rules
```
