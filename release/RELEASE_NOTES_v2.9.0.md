# GhostRun v2.9.0 Release Notes — Extreme Blackout Radar & Tactical Navigation

**Release Date:** 2026-11-15  
**Artifact:** `release/GhostRun-v2.9.0.apk`  
**Size:** 56,591,024 bytes (53.97 MB)  
**SHA-256 Checksum:** `63631B71316E9B0A95C624B3244218ADCBE47082C6A4569A863054BA1FC924D5`  
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

### 4. Mission Lobby 3-Tab UI & Layout Optimization (`app/lobby/[id].tsx`)
- **Bare Bold Room Code Bar:**
  - Removed the pill box border and background from around the room code (`CODE: {code}`) for clean, open presentation.
  - Rendered with bold `Archivo-Bold` display typography (26px, letter spacing 2.5) while preserving the adjacent Share `[ ⇪ ]` and QR `[ ☵ ]` square icon button containers.
- **Horizontal Thumb-Swipable Tab Pager:**
  - Integrated a native horizontal paging pager (`ScrollView horizontal pagingEnabled`) allowing operatives to seamlessly swipe left and right with their thumb between **ROSTER**, **RULES**, and **AREA**.
  - Synchronized with header tab navigation: swiping updates the active purple underline indicator, while tapping any tab header smoothly animates the pager to that section.
  - Preserved directional scroll locking with independent vertical scrolling inside each tab and dedicated padding above the bottom action dock.
  - Disabled gesture panning on the Tactical Area map preview (`dragPan={false}`) so horizontal thumb swipes work across the entire area screen without map interference.
- **Custom Cyber-Tactical Popups:**
  - Completely replaced generic Android system `Alert.alert` dialogs with bespoke tactical modals:
    - **Mission Exit & Disband Modal (`LobbyExitConfirmModal.tsx`):** Displays amber/red tactical protocol badges (`HOST DISBAND PROTOCOL` or `OPERATIVE DEPARTURE`), bold header, explanatory body, and high-visibility destructive actions.
    - **Post-Match Route Privacy Modal (`LobbyPrivacyModal.tsx`):** Features interactive choice cards with custom icons and active radio dots for `Keep Private (Default)` and `Share with Crew`.
- **Fixed Tab Header Overlap & Display Typography:**
  - Streamlined tab titles strictly to `ROSTER (N)`, `RULES`, and `AREA`.
  - Configured with `Archivo-Bold` display font and tuned letter spacing (`1.2`), preventing text wrapping and tab label collisions on narrow Android screens.
- **Roster Tab & Side-by-Side Squad Arena:**
  - Centered minimal quick status row: `🔒 Privacy: Keep Private • 📡 GPS Ready`.
  - Equal side-by-side columns: **RUNNERS** (lime green border & dot) vs **HUNTERS** (coral red border & dot), with individual operative cards, ready badges, and `[ Leave ]` / `[ JOIN ]` actions.
  - Automatically collapses the `UNASSIGNED OPERATIVES` card when all players are assigned.
  - Minimal `HOST CONTROLS` card with `[ ROTATE ROLES ]` and `[ SHUFFLE SQUADS ]`.
- **Unassigned Operatives Two-Tier Responsive Card:**
  - Separated operative identity and actions across two balanced rows.
  - Row 1: Player dot + display name (with host crown) + ready status chip.
  - Row 2: Full-width equal-sized `[ JOIN RUNNERS ]` and `[ JOIN HUNTERS ]` buttons, completely resolving previous button text clipping and horizontal overflow.
- **Rules Tab:**
  - Dedicated `GAME MODE` card with mode icon, title, and descriptive tactical mission briefing.
  - `TACTICAL RULES` card with structured icon rows for Game Duration, Head Start, Radar Pings, and Victory Conditions.
  - Amber/Coral `⚠ SAFETY & FAIR PLAY` warning card.
- **Tactical Area Tab:**
  - Embedded interactive MapLibre map preview card (~280px) displaying purple boundary geofence circle (`PLAY AREA (500m)`), zoom `+`/`-` controls, and a floating `[ 🔍 RE-CENTER ]` pill button.
  - Removed fixed `YOU` marker overlay badge and floating `EXTRACTION TARGET` label for an uncluttered, pure GeoJSON tactical map.
  - Area Details card with Pin icon, Area Radius, extraction status, out-of-bounds penalty grace period, and `[ 📍 CHANGE AREA ]` action.
- **Streamlined Single Action Dock:**
  - Unified bottom action dock into a single responsive full-width action button: `READY UP` ➔ `STAND DOWN` ➔ `LAUNCH MISSION` (with rocket icon for host when all players are ready).
  - Removed redundant `[ SELECT TARGET ]` button.
  - Removed duplicate `• ⚠ Requires 1 Runner & 1 Hunter` text from bottom line; displays clean operative ready counter.

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

### 7. Core Performance: Instant Loading & Zero-Delay Caching
- **Instant User Profile & Identity (`src/stores/userStore.ts`):**
  - Created a dedicated in-memory profile store that eagerly hydrates from `@ghostrun:profile` on boot.
  - Eliminated the initial hardcoded "Alphaop" fallback and loading spinners across Play and Profile tabs.
  - Profile details (`id`, `display_name`, `color`, `email`) are saved immediately on sign-in and sign-up so the very first render of Home or You tabs is instantaneous with zero pop-in.
- **Instant QR Code Generation with Zero Canvas Dependencies (`src/lib/qrCache.ts`):**
  - Implemented high-performance pure-JS 24-bit uncompressed BMP encoder (`generateQrBmpDataUrl`) executing in ~1.5ms.
  - Eliminates DOM `document.createElement('canvas')` failures on React Native Android Hermes.
  - Synchronous in-memory retrieval (`getOrCreateQrUri`) ensures the invite QR code renders with 0ms delay immediately upon opening the modal.
- **0ms GPS Relocation & Pre-Warming (`src/lib/locationCache.ts`):**
  - Pre-warms GPS via continuous low-power subscription as soon as permissions exist.
  - `handleRecenterGps` immediately snaps the camera to cached coordinates (0ms) without locking the FAB with an `ActivityIndicator`.
  - Live GPS refinement runs silently in the background and smoothly eases the camera only if satellite drift exceeds 15m.
- **Cold Boot Optimization (`app/index.tsx`):**
  - Removed artificial 350ms splash display delay.
  - Parallelized session verification, local onboarding check, and profile/consents retrieval.

---

## Verification & Test Results
- **Instant Preloading & Caching:** 3/3 tests passed (`scripts/test-instant-loading.ts`).
- **Blackout Radar & Bearing Engine:** 4/4 tests passed (`scripts/test-blackout-radar.ts`).
- **Host Rules Preset Activation:** 7/7 tests passed (`scripts/test-rules-presets.ts`).
- **Mini-Map Corner Physics:** 3/3 tests passed (`scripts/test-minimap-corner.ts`).
- **Route Resolution & Shims:** 61/61 route checks passed.
- **Diagnostics & App Version:** 17/17 tests passed verifying `APP_VERSION === '2.9.0'`.
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
