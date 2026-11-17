# GhostRun v2.9.7 Release Notes — Single-Line Breadcrumbs, Filter Touch Conflict Resolution & Breathing Room

**Release Date:** 2026-11-17  
**Artifact:** `release/GhostRun-v2.9.7.apk`  
**Size:** 56,714,348 bytes (54.09 MB)  
**SHA-256 Checksum:** `0841DBD97870A8EA5178CB092CA980FBE74F762C92D3D24D9F89BBD161080A73`  
**Version:** `2.9.7`  
**VersionCode:** `22`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.7** resolves touch gesture collisions, eliminates awkward chip wrapping, and dramatically improves visual breathing room on the Game Modes screen:

- **Filter Touch Conflict Resolution (`app/(tabs)/modes.tsx`)**: Replaced horizontal scroll containers for `SQUAD SIZE` and `COMPLEXITY` with full-width, non-overflowing 4-segment flex rows. All options (`ALL`, `SOLO (1)`, `SQUAD (2–4)`, `5+ MASSIVE` and `ALL`, `CASUAL ★`, `TACTICAL ★★`, `HARDCORE ★★★`) are now 100% visible on-screen at once. No scrolling is needed, completely eliminating the bug where swiping cut-off filters accidentally slid the user into Modifiers.
- **Single-Line Breadcrumbs (`app/(tabs)/modes.tsx`)**: Mode metadata chips (Player Count `[👥 6-20 PLAYERS]`, Complexity `[⚡ ★★ TACTICAL]`, and Layer `[🧭 BASE]`) are now strictly enforced on a single horizontal row (`flexWrap: 'nowrap'`, `flexShrink: 1`), removing awkward second-line wrapping across all cards.
- **Generous Visual Breathing Room (`app/(tabs)/modes.tsx`)**: Expanded header margins, segmented control spacing, filter margins, card padding, and increased bottom scroll padding to `140 + insets.bottom dp` so the last card scrolls cleanly above the floating bottom dock bar.
- **Theme Selector UI Bug Fix & Description Purge (`app/settings.tsx`)**: Resolved text wrapping bug in the theme picker with clean vertical tactical buttons; eliminated redundant descriptions across Settings and companion screens.
- **Version Migration**: Bumped version to `2.9.7` (Build `22`) across `app.json`, `package.json`, and diagnostic suites.
