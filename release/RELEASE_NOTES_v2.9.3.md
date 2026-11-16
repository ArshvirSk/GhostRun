# GhostRun v2.9.3 Release Notes — Dynamic Radar Wavefronts & Tactical Reticle Cards

**Release Date:** 2026-11-16  
**Version:** `2.9.3`  
**VersionCode:** `18`  
**Architecture:** `arm64-v8a`  

---

## Overview

GhostRun **v2.9.3** replaces static gradient approximations with a dynamic, authentic tactical radar architecture matching the live visual layout of PlayCulture and modern street-game radars. This release introduces curved directional sonar wavefront arcs, vertical targeting reticle cards with real-time numeric distance displays, status gauge bars, a distinct purple operative center with forward wave ripples, and a dashed tactical perimeter squircle.

---

## Key Highlights & Changes

### 1. Dynamic Directional Sonar Wavefront Arcs (`TacticalSonarArc.tsx`)
- **Forward Sonar Waves:**
  - The centered operative radiates continuous concentric teal sonar wavefront ripples (`#2DD4BF`) propagating in their forward direction.
- **Directional Threat & Contact Sectors:**
  - As contacts appear around the perimeter or approach the user, the radar renders dynamic curved wavefront arcs along their exact bearing angle:
    - **Hunters / Threats:** Curved Hunter Red (`#FF2A55`) wavefront arcs that thicken and intensify as distance closes.
    - **Runners / Allies:** Curved Tactical Teal (`#2DD4BF`) wavefront arcs.
  - Arc radii dynamically align with the physical distance of contacts on the radar grid.

### 2. Tactical Contact Reticle Cards (`TacticalContactCard.tsx`)
- **PlayCulture-Inspired Vertical Card Badges:**
  - Vertical rounded badges (`width: 32px`) rendered directly at contact positions:
    - **Reticle Targeting Corners:** 4 corner brackets `⌜ ⌝ ⌞ ⌟` framing the role icon (skull for hunters, heart for runners).
    - **Live Distance Readout:** Crisp, high-contrast numeric distance display (e.g. `45m`, `335`, `831`).
    - **Mini Status/Stamina Gauge:** Proportional gauge fill bar at the base of each card.
  - **Dynamic Danger Proximity Aura:**
    - When a contact enters close-range engagement ($\le 50\text{m}$), a circular danger halo aura automatically radiates beneath the card with active breathing scale.

### 3. Deep Aubergine Squircle Canvas & Purple Operative Center
- **Deep Tactical Canvas:**
  - Dark aubergine background (`#140818`) with dashed perimeter boundary styling (`borderColor: 'rgba(168, 85, 247, 0.45)'`, `borderStyle: 'dashed'`).
- **Centered Purple Operative Dot:**
  - Purple core dot (`#9333EA` / `#A855F7`) with a solid white eye and surrounding halo ring, accompanied by the `0m · YOU` badge.

---

## Verification & Test Results
- **TypeScript:** `npx tsc --noEmit` verified 0 errors.
- **Diagnostics & Versioning:** `scripts/test-diagnostics.ts` verified `APP_VERSION === '2.9.3'` (17/17 passed).
- **Rules Presets:** `scripts/test-rules-presets.ts` (7/7 passed).
- **Area Compatibility:** `scripts/test-area-compatibility.ts` (4/4 passed).
