# GhostRun v2.7.4 Release Notes — Binary Optimization, Battery Safeguards & Tactical Modes Release

**Release Date:** 2026-11-10  
**Artifact:** `release/GhostRun-v2.7.4.apk`  
**Size:** 56,087,948 bytes (53.48 MB)  
**Size Reduction:** Slashed by **121 MB (68.3% reduction)** from v2.7.3 (168.87 MB)  
**SHA-256 Checksum:** `1DBB6CF4163A58ECB839064CEDC2322BE76998D1F45DD4B2E934040263AED67B`  
**Keystore:** `android/app/debug.keystore` (preserves seamless in-place APK updates)  

---

## Overview

GhostRun v2.7.4 delivers an architectural binary optimization that cuts APK download size by over **68%** (from 170 MB down to 53.48 MB), implements background CPU/battery preservation safeguards for outdoor GPS matches, refines the onboarding and registration sequence, introduces a top two-tab navigation system for Modes and Modifiers, and resolves all layout overflow and animation crashes on the mission details screen.

---

## Key Highlights

### 1. 68% Binary Size Reduction (ABI Split & Resource Shrinking)
- **Targeted `arm64-v8a` Only:** Stripped ~104 MB of unused 32-bit (`armeabi-v7a`, `x86`) and emulator (`x86_64`) native binaries in `android/gradle.properties`, targeting the 64-bit ARM architecture used by modern Android devices.
- **R8 Resource Shrinking (`shrinkResources true`):** Enabled resource optimization in release builds to eliminate unused Android XML layouts, dead drawables, and unused classes from third-party libraries.
- **Installed Footprint:** On-device installed storage footprint drops from **~232 MB down to ~105 MB**.

### 2. Battery & Runtime Efficiency Safeguards
- **Background UI Render Freeze:** Suspended the 500ms visual clock interval in `GameShell.tsx` whenever the app is backgrounded or the screen is locked in a player's pocket. Resyncs instantly upon returning to the foreground.
- **Marker State Throttling During Screen-Off:** Suppressed high-frequency UI marker re-renders while backgrounded, allowing the dedicated Android Foreground Service task (`LOCATION_TASK`) to manage the 5-second / 5-meter GPS uploads at minimal battery drain.

### 3. Onboarding & Registration Flow Polish
- **"Host a Game" Direct Flow:** Tapping **"Host a game"** on the final briefing beat now routes directly to the Login/Register screen (`/signin`).
- **Codename & 16-Color Palette:** From `/signin`, tapping Register takes players to `/signup/name` where the tactical color palette has been doubled from 8 to **16 distinct colors** (adding Blaze Orange, Crimson Flare, Emerald, Electric Teal, Indigo, Mint Pulse, Magenta, and Tactical Slate) in a responsive grid.
- **Native Phone Navigation:** Removed the top `← BRIEFING TOUR` button from `signin.tsx`, allowing players to navigate back cleanly using standard Android hardware/gesture navigation.
- **Permissions Screen Recovery:** Fixed the missing `before-you-play.tsx` step and added auto-prompting for location and notification permissions before round start.

### 4. Game Modes & Modifiers Top Two-Tab System
- **Top SegmentBar Switcher (`app/(tabs)/modes.tsx`):** Replaced the bottom accordion with a top segmented tab bar:
  - **`MODES (7)` Tab:** Features Squad Size and Complexity filter chips followed by interactive game mode cards ("Details" and "Host Mode").
  - **`MODIFIERS (8)` Tab:** Divided into two distinct tactical sections:
    1. **GLOBAL MODIFIERS (5):** Noise Meter, Dead Drops, Hot & Cold, Shrinking Zone, and AI Game Master.
    2. **PLAYER MODIFIERS & SPECIAL ROLES (3):** Double Agent, VIP Escort, and Tactical Operator.
- **Host Wizard Extras Polish (`app/host/extras.tsx`):** Reduced text overload with 2-line descriptions, hides incompatible modifiers by default, and collapses them into an "Available in: ..." section.

### 5. Mode Detail Page & Tactical Simulation
- **Modifiers Collapsible Accordion (`app/modes/[id].tsx`):** Encapsulated compatible modifiers and roles inside a sleek collapsible accordion header, keeping the briefing screen clean and compact.
- **Native-Driven Simulation Animations:** Replaced non-native layout animations with 100% hardware-accelerated transforms (`transform: [{ translateX }, { translateY }]`, `useNativeDriver: true`) in `ModeSimulationView.tsx`, resolving the Android native driver crash.
- **Contained Play/Pause Control:** Moved the simulation Play/Pause toggle inside the top-right corner of the map canvas box (`overflow: 'hidden'`), eliminating layout bleed outside the card.
- **Resilience Wrapper:** Wrapped the simulation canvas in a `SimulationErrorBoundary` to ensure fail-safe rendering.

### 6. Host Flow & Settings Polish
- **Host Rules Overflow Fix (`app/host/rules.tsx`):** Fixed layout overflow in the "Advanced Timing & Boundaries" section with proper flex constraints.
- **Auto-Center Real GPS (`app/host/area.tsx`):** Automatically requests location permissions on mount to center the map on the host's actual coordinates.
- **Settings Units Control (`app/settings.tsx`):** Redesigned the Metric/Imperial segmented control with 44dp touch targets and active radio indicators.

---

## Automated Verification Suite
- `npm run typecheck` — **0 errors**
- `npm run test:routes` — **57/57 tests passing**
- `npm run test:theme` — **15/15 tests passing**
- `npm run test:wizard` — **16/16 tests passing**
- `node --import tsx scripts/test-tour-engine.ts` — **8/8 beats verified**
- Gradle Android Release Build (`assembleRelease`) — **BUILD SUCCESSFUL (53.48 MB)**
