# GhostRun Release Notes — v2.9.11

**Release Date:** November 21, 2026  
**Build:** v2.9.11 (Version Code: 26)  
**Binary:** [GhostRun-v2.9.11.apk](./GhostRun-v2.9.11.apk)  

---

## Executive Summary

GhostRun **v2.9.11** completes the foundation wave of **v3.0 Pillar 3: Outbreak Horde Mode** ("Zombies / Infection Swarm") alongside a complete architectural overhaul of the Mission Lobby and Session Review screens, permanently eliminating text truncation, layout cramping, and operative display redundancies.

---

## Key Features & Architectural Changes

### 1. v3.0 Pillar 3 — Outbreak Horde Mode Foundation
- **Database & Feature Flag Migration:**
  - Extended PostgreSQL enum `game_mode` with `outbreak_horde`.
  - Updated `games_mode_id_check` constraint.
  - Activated feature flag `feature.mode.outbreak_horde` in `public.app_settings`.
  - Added full balance parameters to `public.mode_catalogue()`.
- **Core Engine & Simulation (`src/modes/outbreak_horde.ts`):**
  - Asymmetric infection swarm ratio (1 Patient Zero vs N-1 Survivors).
  - Ticking biological lifespan decay (1 HP/s) with automatic zombie conversion at 0 HP.
  - Health-as-currency abilities (Cloak 35s, Haste 25s).
  - Dynamic procedural Antidote drop zones with 2D drift physics and shrinking perimeter math.
  - 11/11 automated test suite passing with 100% test coverage (`npm run test:horde`).
- **Mode Registry & Prominent Placement:**
  - Featured Outbreak Horde at the top across Play, Modes, and Host wizard flows.

### 2. Mission Lobby Architecture & Typography Overhaul (`app/lobby/[id].tsx`)
- **Header Layout Split (Zero Truncation):**
  - **Row 1:** Full-width Mode Title `Outbreak Horde` (flex: 1, 18px Archivo-Bold) with back navigation and live status chip (`PREPARING` / `READY`).
  - **Row 2:** Dedicated Tactical Utility Strip combining all 4 access pills: Room Code (`CODE: XXXX ↗`), QR Invite (`☵ QR`), Route Privacy (`🔒 Private`), and Sensor Diagnostic (`📶 GPS`).
  - **Row 3:** Sliding SegmentBar tabs (`ROSTER`, `RULES & INTEL`, `ARENA MAP`).
- **Eliminated Duplicate Hero Dossier (Restoring True Game Lobby Space):**
  - Excised the redundant 180px `heroDossierCard`.
  - Operatives are displayed once within their squad (`RUNNERS SQUAD` or `HUNTERS SQUAD`), freeing up massive vertical real estate so both squads fit on screen simultaneously without scrolling.
  - Dynamic squad switching with 1-tap buttons directly on local player entry.
  - Prominent prompt when unassigned: `CHOOSE SQUAD TO DEPLOY: [ JOIN RUNNERS ] [ JOIN HUNTERS ]`.
- **Codename Line-Break Fix:**
  - Resolved `ALPHAOP (YOU)` wrapping by decoupling the codename (`numberOfLines={1}`, `flexShrink: 1`) and creating dedicated tactical pill badges: `[YOU]` (purple border chip) and `[👑 HOST]` (gold chip).
- **Clean Empty Squad Slots:**
  - Replaced awkward misaligned states with centered dashed action slots (`+ Tap to join Hunters Squad`).

### 3. Session Review Metric Grid (`app/host/review.tsx`)
- Replaced cramped single-line metric row with a 2x2 tactical grid (`DURATION`, `RADAR PING`, `TAG RADIUS`, `ARENA BOUNDARY`), eliminating all ellipsis truncation (`DURATI...`, `RADAR...`).
- Completely excised `AreaCompatibilityBadge` across the codebase.

---

## Verification
- `npm run test:horde`: 11/11 tests passing.
- `npx tsc --noEmit`: 0 TypeScript errors.
- `gradlew.bat assembleRelease`: Succeeded in 1m 56s.
