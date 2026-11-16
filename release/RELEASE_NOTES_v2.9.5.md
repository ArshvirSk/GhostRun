# GhostRun v2.9.5 Release Notes — Dynamic Monochromatic Themes, Tactical Dividers & Squircle UI Polish

**Release Date:** 2026-11-17  
**Artifact:** `release/GhostRun-v2.9.5.apk`  
**Size:** 56,696,520 bytes (54.07 MB)  
**SHA-256 Checksum:** `C02AADBA86B3EB976FB0E91C255B36AFCC9C13B7581C47E647007DF3611C3B18`  
**Version:** `2.9.5`  
**VersionCode:** `20`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.5** delivers an extensive visual and spatial polish overhaul inspired by modern retro street games while remaining strictly loyal to GhostRun's high-stakes "Afterimage" black-ops identity. This release introduces a player-driven dynamic monochromatic theming engine, zero-flashbang anti-flicker transitions, authentic military-grade tactical dividers, and chunky squircle metric chips with built-in tactile haptics across all primary viewports.

---

## Key Highlights & Changes

### 1. Dynamic Player-Driven Monochromatic Theming (`src/theme/colorTint.ts`)
- **Mathematical Color Derivation**: Operative profile color choice dynamically computes a deeply saturated, eye-friendly monochromatic dark palette. Mixes 5–8% of the chosen color into deep obsidian bases (`#08080C`) to generate midnight tinted canvases (e.g. `#071216` for Electric Teal, `#130f0c` for Blaze Orange).
- **Luminous Cards & Elevated Surfaces**: Automatically shades card surfaces, elevated docks, and chip backgrounds with 11–16% color tint and radiant border highlights (`hexToRgba(accent, 0.26)`).
- **Live Quick Swatch Selector**: Added a horizontal squircle palette bar right under the operative callsign in the **You** tab and **Settings**. Selecting any color swatch instantly re-tints every screen, button, badge, radar, and tab live with zero reload.
- **Persistent Preference**: Operative theme tint is saved locally via `@ghostrun:theme_accent_color` and synchronized with Supabase profile data.

### 2. Zero-Flashbang Anti-Flicker Screen Transitions (`app/_layout.tsx`)
- **Root Canvas Pinning**: Wrapped root navigators in `<View style={{ flex: 1, backgroundColor: colors.background }}>` and pinned `contentStyle: { backgroundColor: colors.background }` directly on the native Stack.
- **Eliminated Android White Window Flash**: Completely resolved the 80–120ms white canvas exposure during route pushes/pops in dark mode.
- **Smooth Cross-Fade Animations**: Configured smooth cross-fades (`animation: 'fade'`, `animationDuration: 220`) for high refresh rate displays (60/120Hz).
- **Seamless Tab Switching**: Wrapped `(tabs)/_layout.tsx` in a dark-pinned container to prevent cutaway flickers when navigating between Play, Modes, and You.

### 3. Tactical Dividers & Chunky Squircle Metric Chips (`src/ui/`)
- **`TacticalDivider.tsx`**: Replaced generic divider lines and empty margins with authentic military-grade telemetry dividers featuring:
  - **Bracket Variant (`⌜ LABEL // SUBLABEL ⌟`)**: For high-stakes headers (e.g. `⌜ SQUAD ARENA // PVP REAL-WORLD ⌟`, `⌜ TACTICAL SIMULATIONS // 14 MODES ⌟`).
  - **Dashed Pip Variant (`+ - - - - - - - +`)**: Sleek dashed telemetry lines with corner crosshair pips.
- **`TacticalMetricChip.tsx`**: Chunky tactile squircle chips (`borderRadius: 10–16`, `borderWidth: 1.5`) pairing bold metrics with micro-labels (`[ 👥 4–20 | OPS ]`, `[ ⚡ TACTICAL ★★ ]`, `[ 🎯 OBJECTIVE | LAYER ]`).
- **Built-in Haptic Feedback**: Every chip tap fires crisp tactile feedback (`triggerHaptic('buttonTap')`) and micro spring scaling (`scale: 0.97`).

### 4. Screen-by-Screen Spatial & Breathing Room Polish
- **Modes Tab (`app/(tabs)/modes.tsx`)**:
  - Mode cards upgraded to chunky squircle cards (`borderRadius: 20`, `padding: 18`, `marginBottom: 16`).
  - Squad size and complexity filters separated with telemetry dividers.
  - Mutator and Operative Role cards upgraded to elevated squircle containers with breathing room.
- **Mission Lobby (`app/lobby/[id].tsx`)**:
  - Chunky Room Code Card with direct-action `[ 🔗 SHARE ]` and `[ 📷 QR ]` tactical chips.
  - Runners and Hunters squads upgraded to deep squircle columns (`borderRadius: 18`, `padding: 14`) with live squad counter chips (`[ 🏃 3 RUNNERS ]` / `[ 💀 2 HUNTERS ]`).
  - Operative readiness badges upgraded to chunky tactile squircle chips (`[ READY ]` in tactical green / `[ PREPARING ]` in muted carbon).
- **Play & You Tabs**:
  - Added tactical dividers between Direct Action, Field Intel, Career Telemetry, and Combat Archives.
  - Added `[ 🏆 OG | ORIGINAL ]` tactical badge on the Featured Mode card.

### 5. Tactical Sonar Wavefronts & Contact Cards (`v2.9.3`)
- **`TacticalSonarArc.tsx`**: Concentric forward-sweeping sonar wavefront ripples and radial threat arcs.
- **`TacticalContactCard.tsx`**: Vertical reticle contact cards with `⌜ ⌝` corner brackets, live numeric distance (`45m`), and mini status bars.
- **`TacticalRadarCanvas.tsx`**: Aubergine squircle canvas with dashed borders, purple operative center, and forward teal sonar ripples.

### 6. Real-World PvP Outbreak Mode Specification
- Complete architectural and game rules specification in `docs/specs/HORDE_OUTBREAK_MODE_SPEC.md` for 100% real-world physical human PvP Outbreak.
- Legacy AI bot horde completely removed from v3.0 roadmap and deferred to future backlog.
- Overhauled tactical audio to be designed specifically for phone loudspeaker to protect outdoor pedestrian safety (no mandatory earbuds).

---

## Verification & Test Results
- **TypeScript Compilation:** Clean exit with 0 errors (`npx tsc --noEmit`).
- **Diagnostic & Analytics Assertions:** 17/17 tests passed (`scripts/test-diagnostics.ts`).
- **Host Rules Presets & Unhighlighting:** 7/7 tests passed (`scripts/test-rules-presets.ts`).
- **Versioning:** Synchronized `2.9.5` (Android `versionCode: 20`) across all manifests and test harnesses.
