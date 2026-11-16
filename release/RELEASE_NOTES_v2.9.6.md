# GhostRun v2.9.6 Release Notes — Map Centering, Tactical Rangefinder & Sliding Navbars

**Release Date:** 2026-11-17  
**Artifact:** `release/GhostRun-v2.9.6.apk`  
**Size:** 56,704,104 bytes (54.08 MB)  
**SHA-256 Checksum:** `D0CB0BD95106D1A94AC78015D066DB34E43428A413D15213DED634BA499DA3ED`  
**Version:** `2.9.6`  
**VersionCode:** `21`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.6** delivers high-precision spatial and navigational refinements across core screens. This release introduces the new military-grade **Tactical Rangefinder Zone Selector** with a 2.0 km hard cap and continuous glitch-free camera zooming, silky-smooth sliding pills on both the main floating navbar and sub-tab bars, a horizontal swipe pager on the Modes tab, and calibrated map camera viewport padding.

---

## Key Highlights & Changes

### 1. Tactical Rangefinder Zone Selector & 2km Hard Cap (`src/ui/TacticalRangeSelector.tsx`)
- **New UI Form Inspired by PlayCulture**: Replaced the static chips with a compact tactical rangefinder selector:
  - **Live Readout Header**: Displays current radius (`600M`) and total diameter (`Ø 1.2 KM`) in high-contrast accent typography.
  - **Tactile Steppers**: Squircle `[ - ]` and `[ + ]` buttons nudge the arena radius in 100m steps with crisp haptics (`triggerHaptic('buttonTap')`).
  - **Horizontal Range Dial**: Scrolling range track (`200m` to `2000m`) with auto-centering on active selection.
  - **Quick-Jump Snap Pills**: Direct one-tap jump buttons for standard perimeters (`[ 300M ]`, `[ 600M ]`, `[ 1.0KM ]`, `[ 1.5KM ]`, `[ 2.0KM MAX ]`).
- **2.0 km Hard Cap**: Strictly enforced a maximum 2000m (2.0 km) perimeter across all modes in both UI and `hostStore`.

### 2. Glitch-Free & Continuous Camera Zooming (`app/host/area.tsx`)
- **Eliminated Animation Conflict**: Resolved camera glitches caused by duplicate simultaneous `easeTo` calls from button `onPress` and `useEffect`.
- **Continuous Logarithmic Scaling**: Replaced discrete stair-step zoom thresholds with a smooth continuous curve ($z = 14.8 - \log_2(r / 300)$), ensuring consistent proportional framing across all radii (200m to 2000m).
- **Debounced Camera Controller**: Added a 40ms debounce to camera updates so rapid stepper nudges or dial adjustments glide smoothly to the target zoom without native cancellation twitching or "zoom out then in" artifacts.

### 3. Viewport-Calibrated Map Centering (`app/host/area.tsx`)
- **Compensated Camera Viewport**: Configured `AREA_MAP_PADDING = { top: 220, bottom: 85, left: 16, right: 16 }` across camera initialization, GPS recentering, map clicks, and animated radius adjustments.
- **Dead-Centered Arena**: The boundary zone is framed dead-center in the visible, uncovered canvas on any phone.

### 4. Swipeable Modes Pager & Animated Slider (`app/(tabs)/modes.tsx` & `src/ui/SegmentBar.tsx`)
- **Horizontal Swipe Pager**: Wrapped game modes and field mutators in a full-screen horizontal paging container (`ScrollView horizontal pagingEnabled`). Users can now swipe left/right naturally to switch between **Modes** and **Modifiers**.
- **Spring-Animated Slider Pill**: Upgraded `SegmentBar` with an `Animated.spring` sliding pill that glides smoothly under the active tab label.
- **Cleaned Header**: Removed redundant descriptive subtitle beneath "GAME MODES & MUTATORS".

### 5. De-cluttering & Elimination of Card Overflow
- **Compact Mode Cards**: Replaced oversized 3-block vertical metric boxes (`[4-20 OPS]`, `[★☆☆ CASUAL]`, `[BASE LAYER]`) with compact, horizontal `Chip` badges. Reduced card height from >280px to ~140px, allowing 2–3 cards to fit comfortably on screen at once.
- **Zero Card Overflow**: Fixed the `[ OG ]` badge on the Featured Mode card so it never bleeds past card borders.
- **Reduced Visual Clutter**: Stripped heavy bracket dividers across Play, Modes, and You tabs where clean section headers already speak for themselves.

### 6. Sliding Pill Animation on Main Navbar (`app/(tabs)/_layout.tsx`)
- **Silky Smooth Sliding Pill**: Native `tabBarBackground` implementation with spring-animated sliding pill (`friction: 8, tension: 75`) that glides across the floating navbar capsule when switching between **Play**, **Modes**, and **You** with 0 crashes.
