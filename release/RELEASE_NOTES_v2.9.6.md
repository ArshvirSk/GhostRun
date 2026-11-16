# GhostRun v2.9.6 Release Notes — Map Centering, Swipeable Modes Pager & Sliding Navbar Pill

**Release Date:** 2026-11-17  
**Artifact:** `release/GhostRun-v2.9.6.apk`  
**Size:** 56,698,708 bytes (54.07 MB)  
**SHA-256 Checksum:** `1F61B5354EDB9569E5CF9D53EC490D1BF956FDC996E0DEB8D5F1C4F1A590849C`  
**Version:** `2.9.6`  
**VersionCode:** `21`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.6** delivers high-precision spatial and navigational refinements across core screens. This release addresses user feedback on visual clutter, screen overflow, map centering, and animated transitions, introducing silky-smooth sliding pills on both the main floating navbar and sub-tab bars, a horizontal swipe pager on the Modes tab, and calibrated map camera viewport padding.

---

## Key Highlights & Changes

### 1. Viewport-Calibrated Map Centering (`app/host/area.tsx`)
- **Compensated Camera Viewport**: Previously, MapLibre centered coordinates at the absolute screen midpoint, causing the zone circle to appear cut off under the top floating step card (~220px) and bottom button dock (~85px).
- **Explicit Camera Padding**: Configured `AREA_MAP_PADDING = { top: 220, bottom: 85, left: 16, right: 16 }` across camera initialization, GPS recentering, map clicks, and animated radius adjustments.
- **Tuned Zoom Levels**: Refined `getZoomForRadius` (300m $\to$ 14.8, 600m $\to$ 13.8, 1000m $\to$ 13.0, 1500m $\to$ 12.3) so the boundary zone is framed dead-center in the visible canvas on any phone.

### 2. Swipeable Modes Pager & Animated Slider (`app/(tabs)/modes.tsx` & `src/ui/SegmentBar.tsx`)
- **Horizontal Swipe Pager**: Wrapped game modes and field mutators in a full-screen horizontal paging container (`ScrollView horizontal pagingEnabled`). Users can now swipe left/right naturally to switch between **Modes** and **Modifiers**.
- **Spring-Animated Slider Pill**: Upgraded `SegmentBar` with an `Animated.spring` sliding pill that glides smoothly under the active tab label. Tapping a tab smoothly scrolls the horizontal pager, and swiping the pager springs the slider into position.
- **Removed Redundant Header Text**: Cleaned up the top header by removing the subtitle beneath "GAME MODES & MUTATORS".

### 3. De-cluttering & Elimination of Card Overflow
- **Compact Mode Cards**: Replaced oversized 3-block vertical metric boxes (`[4-20 OPS]`, `[★☆☆ CASUAL]`, `[BASE LAYER]`) with compact, horizontal `Chip` badges. Reduced card height from >280px to ~140px, allowing 2–3 cards to fit cleanly on screen without infinite scrolling.
- **Zero Right-Side Card Overflow**: In the Play tab (`app/(tabs)/play.tsx`), replaced the overflowing `[ 🏆 OG | ORIGINAL ]` block with an inline, boundary-safe `[ OG ]` badge.
- **Reduced Visual Clutter**: Removed heavy bracket dividers (`⌜ CAREER TELEMETRY // METRICS ⌟`, `⌜ OPERATIVE ACCOLADES // BADGES ⌟`, `FILTERS & CALIBRATION`, `TACTICAL SIMULATIONS`) across Play, Modes, and You tabs where clean section headers already speak for themselves.

### 4. Sliding Pill Animation on Main Navbar (`app/(tabs)/_layout.tsx`)
- **Silky Smooth Sliding Pill**: Replaced static icon background wrappers with a single animated pill (`Animated.spring`, `friction: 8, tension: 75`) that glides across the floating navbar capsule when switching between **Play**, **Modes**, and **You**.
- **Zero Flashbangs**: Retained dark-backed canvas pinning on all tab roots to prevent white flashes or layout shifts during screen transitions.
