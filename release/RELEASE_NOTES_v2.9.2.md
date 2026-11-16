# GhostRun v2.9.2 Release Notes — Two-Color Radiant Proximity Blooms

**Release Date:** 2026-11-16  
**Version:** `2.9.2`  
**VersionCode:** `17`  
**Architecture:** `arm64-v8a`  

---

## Overview

GhostRun **v2.9.2** brings the tactical visual language closer to premier outdoor urban stealth games like PlayCulture and SCRAM. This release introduces high-resolution **Two-Color Radiant Proximity Blooms** that dynamically swell and pulse based on physical distance, without ever blending into muddy GIS rainbow heatmaps.

---

## Key Highlights & Changes

### 1. Two-Color Radiant Proximity Gradient System (`assets/map/fx/`)
- **Silky Radial Drop-off Gradient:**
  - Created 256x256 100% transparent RGBA radial bloom textures with cosine-quadratic falloff curves:
    - `assets/map/fx/radial-bloom-hunter.png`: Radiant Hunter Red (`#FF2A55`) with luminous coral core.
    - `assets/map/fx/radial-bloom-runner.png`: Radiant Tactical Cyan / Blue (`#00F0FF` / `#38BDF8`) with bright electric core.
- **Strict Color Isolation (No Rainbow Merging):**
  - Unlike standard multi-color density maps that blend adjacent contacts into green/yellow blobs, each contact retains its own discrete, clean identity (Red for Hunters/Zombies, Blue for Runners/Normals).

### 2. `ProximityRadialBloom` Component (`src/components/map/ProximityRadialBloom.tsx`)
- **Dynamic Distance-Based Sizing & Intensity:**
  - Automatically calculates physical proximity to the user:
    - **Danger Zone ($\le 25\text{m}$):** Expands to maximum bloom size (up to 120px) with 92% opacity and an active 600ms breathing pulse.
    - **Medium Proximity ($25\text{m} - 150\text{m}$):** Smoothly scales down from 120px to 36px with proportional opacity decay.
    - **Far Peripheral ($>150\text{m}$):** Remains a subtle 34px ambient beacon at 28% opacity.
- **Hardware-Accelerated & Reduced-Motion Aware:**
  - Renders via native image transformations without JS thread overhead.
  - Automatically suspends breathing scale pulses when `useReducedMotion()` is active.

### 3. Integrated Across Both Centered Navigation Modes:
- **Extreme / Blackout Radar (`TacticalRadarCanvas.tsx`):**
  - Replaced the flat translucent contact circles with `ProximityRadialBloom` underlay behind the core blip and distance badge.
- **Centered Street Map Mode (`MapView.tsx`):**
  - Embedded `ProximityRadialBloom` under teammates and radar pings directly onto the vector street tiles, following real-time map pan, zoom, and compass rotation.

---

## Verification & Test Results
- **TypeScript:** `npx tsc --noEmit` verified 0 errors.
- **Diagnostics & Versioning:** `scripts/test-diagnostics.ts` verified `APP_VERSION === '2.9.2'` (17/17 passed).
- **Rules Presets:** `scripts/test-rules-presets.ts` (7/7 passed).
- **Area Compatibility:** `scripts/test-area-compatibility.ts` (4/4 passed).
