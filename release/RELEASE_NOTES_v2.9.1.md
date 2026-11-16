# GhostRun v2.9.1 Release Notes — Tactical Map Asset System & Pacing Validator

**Release Date:** 2026-11-16  
**Version:** `2.9.1`  
**VersionCode:** `16`  
**Architecture:** `arm64-v8a`  

---

## Overview

GhostRun **v2.9.1** delivers a major visual and tactile upgrade across the in-game HUD and lobby experience. Inspired by field-tested urban street games like PlayCulture and SCRAM, this release introduces high-precision Afterimage tactical map markers, GPU-accelerated animated pointer dynamics, an intuitive 3-segment match duration timeline formula, a pedestrian traversal compatibility validator, and glanceable `0m · YOU` radar telemetry.

---

## Key Highlights & Changes

### 1. High-Precision Tactical Map Asset Library (`assets/map/`)
- **Afterimage Design System Adherence (`docs/UI_RESTRICTIONS.md`):**
  - Generated 5 high-precision, 4x supersampled, 100% transparent RGBA vector-rasterized tactical map sprites:
    - `assets/map/pointers/runner-pointer.png`: Acid Lime (`#C7F36B`) tactical delta chevron with a forward vision cone arc.
    - `assets/map/pointers/hunter-pointer.png`: Hunter Coral (`#FF8A75`) aggressive interceptor chevron with predatory faceted spine and crosshair notch.
    - `assets/map/pointers/teammate-marker.png`: Tactical Cyan (`#38BDF8`) circular operative pin with directional heading notch and pulse ring.
    - `assets/map/markers/extraction-target.png`: Acid Lime (`#C7F36B`) concentric extraction zone bullseye with 4-axis crosshair ticks.
    - `assets/map/markers/radar-ghost-ping.png`: Spectral Violet (`#B8A3FF`) afterimage ripple with centered diamond core.
  - All sprites feature outer dark strokes (`#101014`) for 100% readability across both dark satellite maps and direct sunlight light maps.

### 2. GPU-Accelerated Animated Map Components (`src/components/map/`)
- **`AnimatedPlayerPointer`:** Smooth 60 FPS rotation driven by gyro/compass heading changes with a subtle breathing forward vision cone.
- **`AnimatedExtractionTarget`:** Continuous breathing pulse aura scaling outward with a slowly rotating reticle ring for immediate objective recognition.
- **`AnimatedRadarPing`:** Dual out-of-phase expanding shockwave rings (`scale: 0.6 -> 2.0`, `opacity: 0.7 -> 0`) that dissipate over 1800ms.
- **`AnimatedTeammateMarker`:** Gentle pulsing beacon aura to keep friendly operatives visually distinct from enemy radar pings.
- **Respects Accessibility Preferences:** Automatically falls back to stationary crisp sprites when `useReducedMotion()` is active.

### 3. 3-Segment Match Duration Timeline Formula (`MatchDurationTimeline.tsx`)
- Replaces ambiguous time limit numbers with a clear 3-phase match breakdown:
  - **[ START / HEAD START ]** (e.g. 90s scatter grace period)
  - **[ ACTIVE PLAY / CHASE ]** (e.g. 15m main stealth survival & pursuit)
  - **[ REGROUP / DEBRIEF ]** (e.g. 2m post-match rally and scoring)
- Integrated directly into the **Lobby Rules** tab and the **Host Session Review** screen.

### 4. Arena & Duration Compatibility Engine (`areaCompatibility.ts` & `AreaCompatibilityBadge.tsx`)
- Automatically calculates pedestrian traversal feasibility ($\text{Speed} = \frac{2R}{T}$) to prevent unplayable mission configurations:
  - Warns if the zone is too large for the allotted time ($>13.7\text{ km/h}$, which would require sprinting or vehicular movement).
  - Warns if the arena is too cramped for long matches ($<150\text{m}$ radius for $>20\text{m}$ duration).
  - Displays a crisp **✓ ARENA & DURATION COMPATIBLE** badge when pacing is balanced.
  - Embedded into **Host Area Creation**, **Host Session Review**, and **Lobby Area Tab**.

### 5. Glanceable Radar `0m · YOU` Center Marker (`TacticalRadarCanvas.tsx`)
- Added a high-contrast `0m · YOU` badge anchored directly below the centered operative heading chevron on the radar canvas, providing immediate orientation and distance reference during high-speed chases.

---

## Verification & Test Results
- **TypeScript:** `npx tsc --noEmit` verified 0 errors.
- **Diagnostics & Versioning:** `scripts/test-diagnostics.ts` verified `APP_VERSION === '2.9.1'` (17/17 passed).
- **Rules Presets:** `scripts/test-rules-presets.ts` (7/7 passed).
- **Event Mode:** `scripts/test-event-mode.ts` (3/3 passed).
- **Host Wizard Payloads:** `scripts/test-wizard-payload.ts` (16/16 passed).
- **Area Compatibility:** `scripts/test-area-compatibility.ts` (4/4 passed).
