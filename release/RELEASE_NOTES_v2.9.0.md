# GhostRun v2.9.0 Release Notes — Extreme Blackout Radar & Tactical Navigation

**Release Date:** 2026-11-15  
**Artifact:** `release/GhostRun-v2.9.0.apk`  
**Size:** 56,570,512 bytes (53.95 MB)  
**SHA-256 Checksum:** `1200F5D19209D6D4D538972A48E771DA8B2C8D00E00A6237DD5CAC0ACF376E1F`  
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
- **Database Boundary Penalty Validation:**
  - Applied migration `20261118029000_nf09_boundary_rules.sql` to live Supabase database, updating `games_boundary_penalty_check` to permit `'reveal_live'` and `'auto_tag'`. Completely resolves the `game settings invalid. check allowed ranges` error when creating Blackout missions.

### 2. Zone Creation & Area Setup Enhancements
- **Free Tap Repositioning (`app/host/area.tsx`):**
  - Operatives can tap anywhere on the map to immediately recenter and place the boundary perimeter without needing to tap inside an existing zone circle.
- **Eliminated USA Coordinates Fallback & Instant Opening:**
  - Removed legacy hardcoded Kansas, USA coordinates (`[-97, 38]`).
  - Added boot-time persistent storage hydration and Step 1 background GPS pre-fetching so the operative's true coordinates are ready before reaching the map screen.
  - Hooked MapLibre's `onDidFinishLoadingStyle` event to immediately snap the camera to the operative's position as soon as vector tiles finish rendering.
- **Instantaneous 0ms Recenter Snap & Detached Control:**
  - Implemented a rapid 4-tier GPS resolution cascade (OS Fused Location Cache `<5ms` -> Persistent Cache `<10ms` -> Fast network fix `<=1500ms` -> background satellite refinement). Eliminated hardware GPS lock hangs.
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
- **Side-by-Side 2-Column Squad Arena:**
  - Redesigned the squad section into equal side-by-side columns: **RUNNERS** on the left with lime accents, and **HUNTERS** on the right with coral-orange accents.
  - If unassigned or on opposing team, an immediate `[JOIN]` button is rendered in the column header.
  - Upon joining, the operative's card is highlighted inside their squad column with an inline `[↳ LEAVE]` button to freely step down to unassigned.
  - Cuts squad vertical footprint by ~50% and provides a crisp competitive "VS" atmosphere.
- **Compact Quick-Bar (Route Privacy & Diagnostics):**
  - Replaced the full-width privacy warning banner and sensor diagnostic strip with two 36px side-by-side quick-action pills directly beneath the tab bar:
    - `[🛡 Privacy: Keep Private ⌄]`: Tapping presents a native action modal to switch between "Keep Private" and "Share Trail".
    - `[✔ Diagnostics: Ready]`: Tapping opens the sensor and GPS health inspection modal.
- **Unassigned Operatives Card:**
  - Dedicated card below the squad arena showing unassigned players with avatar dot, host crown, ready badge, and quick-action `[JOIN RUNNERS]` / `[JOIN HUNTERS]` buttons for the operative.
  - Displays a clean `"No unassigned operatives"` status when all players have chosen squads.
- **Top Navigation Bar & Mission Access Card:**
  - Circular back button with confirmation dialog, purple `MISSION LOBBY` category tracker, bold mode title, and glowing `PREPARING ●` / `READY ●` status chip.
  - Access Code card featuring 4-letter code, side-by-side `[SHARE]` and `[QR]` buttons, and subtle alert notice when under 2 players.
- **Host Squad Controls:**
  - Card with `[ROTATE ROLES]` and `[SHUFFLE SQUADS]` buttons that activate cleanly when at least 2 players are present.
- **Fixed Bottom Action Dock:**
  - Compact ~85px height dock with `[READY UP]` (or `[STAND DOWN]`), `[SELECT TARGET]` / `[LAUNCH ROUND]`, and live status text (`1 operative awaiting ready • Requires 1 Runner & 1 Hunter`).
  - ScrollView padding cleared to `+ 210px` ensuring zero obstruction of roster or settings.
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
