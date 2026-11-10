# GhostRun v2.7.1 Release Notes — "Afterimage" UI Redesign & Visual Polish

**Release Date:** 2026-11-10  
**Artifact:** `release/GhostRun-v2.7.1.apk`  
**Size:** 173,846,888 bytes (165.79 MB)  
**SHA-256 Checksum:** `4D4C74BCFF52E652FB9656258F144731DCDD497D4E51EAE6AC832CE6157156E2`  
**Keystore:** `android/app/debug.keystore` (preserves seamless in-place APK updates)  

---

## Overview

GhostRun v2.7.1 represents the culmination of the Afterimage UI redesign and stabilization pass. This release merges all UI architectural tracks into `main`, resolves 14 visual defect categories identified across reference device captures, introduces live 3-way theme switching with cross-relaunch persistence, and packages a verified production release APK.

---

## Key Highlights

### 1. Afterimage Light / Dark Theme Switcher & Persistence
- Added live **Tactical Display** selector (`SYSTEM`, `LIGHT`, `DARK`) to Settings screen (`app/settings.tsx`).
- Instant reactive theme switching across all app chrome, HUD, controls, and bottom sheets without requiring app restart.
- Persisted selection under storage key `@ghostrun:theme_preference` via `AsyncStorage` with clean rehydration on cold start.
- Verified with dedicated automated persistence test suite `scripts/test-theme-persistence.ts` (`npm run test:theme`) covering 15 state transitions.

### 2. Resolution of 14 Visual Defect Categories
- **Host Wizard Review Grid:** Restructured Step 5 Review screen (`app/host/review.tsx`) with a balanced 4-column metric grid (`colSpan: 1`) on wide cards, eliminating awkward 3+1 wrapped metric card layout.
- **Mid-Word Wrap & Label Collision:** Fixed text containment across mode chips, difficulty badges, and briefing step indicators (`flexWrap: 'wrap'`, word break protection).
- **Map Tile Contrast & Theming:** Integrated high-contrast tactical styling for MapLibre tiles across both Light (pale tactical grid with distinct vector roads) and Dark (deep slate tactical grid).
- **Chip & Button Padding:** Normalized touch target padding across all filter chips, difficulty toggles, and tactical action buttons (minimum 44dp touch target guarantee).
- **Floating Tab Bar & Bottom Insets:** Added safe area bottom insets and scroll content padding to prevent bottom floating tab navigation from occluding footer actions and scrollable lists.

### 3. Full Automated Verification Suite
- `npm run typecheck`: TypeScript compilation passed cleanly with 0 errors.
- `npm run lint`: ESLint static analysis passed with 0 warnings.
- `npm run test:theme`: 15 theme state transitions and persistence cases passed.
- `npm run test:routes`: 57 route shims and accessibility assertions passed.
- `npm run test:wizard`: 16 host wizard configuration snapshots passed.
- `npm run test:registry`: 51 mode registry integrity checks passed.

### 4. Branch Hygiene & Repository State
- All working UI branches (`ui/ui-m0` through `ui/ui-m8` and `ui/ui-r1`) successfully and cleanly merged into `main` and deleted both locally and remotely.
- Release APK built via Android Gradle wrapper (`assembleRelease`) with zero warnings or errors.
