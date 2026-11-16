# GhostRun v2.9.6 Release Notes — Map Centering, Tactical Rangefinder & Sliding Navbars

**Release Date:** 2026-11-17  
**Artifact:** `release/GhostRun-v2.9.6.apk`  
**Size:** 56,705,700 bytes (54.08 MB)  
**SHA-256 Checksum:** `7498FA34D5AFCF37B8FF8F496BC012CE1847731527456D4D82168A0722B43B53`  
**Version:** `2.9.6`  
**VersionCode:** `21`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.6** delivers high-precision spatial and navigational refinements across core screens. This release introduces the new military-grade **Tactical Rangefinder Zone Selector** with physical stepped friction, haptic tick feedback, left/right edge gradients, and glitch-free camera zooming, silky-smooth sliding pills on both the main floating navbar and sub-tab bars, a horizontal swipe pager on Modes, Squads, and Schedule tabs, and streamlined card layouts.

---

## Key Highlights & Changes

### 1. Weighted Stepped Dial Zone Selector & 2km Hard Cap (`src/ui/TacticalRangeSelector.tsx`)
- **Weighted Physical Friction**: Implemented `snapToInterval`, `snapToAlignment="start"`, `decelerationRate="fast"`, and `disableIntervalMomentum={true}` so the dial stops with tactile weight and friction on each 100m step instead of spinning loosely.
- **Haptic Tick Feedback**: Crisp haptic pulse (`triggerHaptic('buttonTap')`) fires on every single step transition as you swipe or tap.
- **Edge Fades**: Dual `<LinearGradient>` overlays smoothly fade numbers towards the `[-]` and `[+]` stepper buttons.
- **Centered Indicator Reticle**: Active selection is framed inside an accent-highlighted reticle pill.
- **Eliminated Presets Row**: Stripped the redundant row of preset buttons for a clean, focused UI.
- **2.0 km Hard Cap**: Strictly enforced a maximum 2000m (2.0 km) perimeter across all modes.

### 2. Glitch-Free Camera Zooming & Screen Real Estate (`app/host/area.tsx`)
- **Zero Coordinate Twitch or Jumps**: Replaced `easeTo` (which re-calculated padded coordinates and triggered double-padding shifts in MapLibre Android) with `cameraRef.current.zoomTo(...)` with 80ms debounce. Zoom transitions now glide smoothly without momentary zoom-out/in or coordinate glitching.
- **Removed Compatibility Badge**: Removed the `✓ ARENA & DURATION COMPATIBLE` badge, freeing up screen space so the map canvas and boundary ring have maximum breathing room.
- **Calibrated Viewport Padding**: Adjusted `AREA_MAP_PADDING = { top: 160, bottom: 85, left: 16, right: 16 }` for dead-center boundary framing.

### 4. Swipeable Modes Pager & Animated Slider (`app/(tabs)/modes.tsx` & `src/ui/SegmentBar.tsx`)
- **Horizontal Swipe Pager**: Wrapped game modes and field mutators in a full-screen horizontal paging container (`ScrollView horizontal pagingEnabled`). Users can now swipe left/right naturally to switch between **Modes** and **Modifiers**.
- **Spring-Animated Slider Pill**: Upgraded `SegmentBar` with an `Animated.spring` sliding pill that glides smoothly under the active tab label.
- **Cleaned Header**: Removed redundant descriptive subtitle beneath "GAME MODES & MUTATORS".

### 5. De-cluttering & Elimination of Card Overflow
- **Compact Mode Cards**: Replaced oversized 3-block vertical metric boxes (`[4-20 OPS]`, `[★☆☆ CASUAL]`, `[BASE LAYER]`) with compact, horizontal `Chip` badges. Reduced card height from >280px to ~140px, allowing 2–3 cards to fit comfortably on screen at once.
- **Zero Card Overflow**: Fixed the `[ OG ]` badge on the Featured Mode card so it never bleeds past card borders.
- **Reduced Visual Clutter**: Stripped heavy bracket dividers across Play, Modes, and You tabs where clean section headers already speak for themselves.

### 6. Sliding Pill Animation & Polished Navbar Pill (`app/(tabs)/_layout.tsx`)
- **Silky Smooth Sliding Pill**: Native `tabBarBackground` implementation with spring-animated sliding pill (`friction: 8, tension: 75`) that glides across the floating navbar capsule when switching between **Play**, **Modes**, and **You** with 0 crashes.
- **Icon-Centered Indicator Pill**: Polished the indicator pill to a 56×32 rounded capsule positioned cleanly behind only the active tab's icon (following modern Material 3 / iOS design). The text label sits unobtrusively below the pill with zero clipping or crowding.

### 7. Swipeable Squads & Schedule Pagers (`app/squads.tsx` & `app/schedule.tsx`)
- **Horizontal Swipe Pager on Squads**: Full-screen horizontal swipe paging (`ScrollView horizontal pagingEnabled`) across **Squads**, **Form Squad**, and **Join Squad** tabs with synchronized animated slider and haptic feedback.
- **Fixed Tab Overflow & Layout**: Replaced cramped custom tab buttons with standard `SegmentBar`, fixing text cutoff on small displays and eliminating icon collisions. Refined squad card layouts and empty states.
- **Horizontal Swipe Pager on Schedule**: Full-screen horizontal swipe paging across **Upcoming** and **Schedule New** tabs. Refined card spacing, RSVP buttons, and bottom inset clearance.
