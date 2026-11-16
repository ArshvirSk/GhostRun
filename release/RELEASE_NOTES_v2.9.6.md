# GhostRun v2.9.6 Release Notes — Map Centering, Tactical Rangefinder & Sliding Navbars

**Release Date:** 2026-11-17  
**Artifact:** `release/GhostRun-v2.9.6.apk`  
**Size:** 56,707,360 bytes (54.08 MB)  
**SHA-256 Checksum:** `E34FB31F44CA21B888F6598687A833D967915709BC794DF23066242637B479FA`  
**Version:** `2.9.6`  
**VersionCode:** `21`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.6** delivers high-precision spatial and navigational refinements across core screens. This release introduces the new military-grade **Tactical Rangefinder Zone Selector** with physical stepped friction, auto-snapping to the closest option, haptic tick feedback, left/right edge gradients, and glitch-free camera zooming, silky-smooth sliding pills on both the main floating navbar and sub-tab bars, a horizontal swipe pager on Modes, Squads, and Schedule tabs, and streamlined card layouts.

---

## Key Highlights & Changes

### 1. Auto-Snapping Stepped Dial Zone Selector & 2km Hard Cap (`src/ui/TacticalRangeSelector.tsx`)
- **Zero-Lag Architecture**: Decoupled active drag scrolling from parent state re-renders so the dial tracks your finger with silky 120fps responsiveness without freezing or lagging.
- **Auto-Snap to Closest Option**: When released anywhere between two sizes, `snapToClosest` computes the exact nearest step by distance (`Math.round(offsetX / ITEM_WIDTH)`) and snaps the dial directly into the reticle. Never gets stuck between numbers.
- **Discrete Snap Offsets**: Configured `snapToOffsets` array mapping every 100m interval with `decelerationRate="fast"` and `disableIntervalMomentum={true}` for solid physical weight and friction.
- **Haptic Tick Feedback**: Crisp haptic pulse (`triggerHaptic('buttonTap')`) fires on every single step transition as you swipe or tap.
- **Edge Fades**: Dual `<LinearGradient>` overlays smoothly fade numbers towards the `[-]` and `[+]` stepper buttons.
- **Centered Indicator Reticle**: Active selection is framed inside an accent-highlighted reticle pill.
- **Eliminated Presets Row**: Stripped the redundant row of preset buttons for a clean, focused UI.
- **2.0 km Hard Cap**: Strictly enforced a maximum 2000m (2.0 km) perimeter across all modes.

### 2. Glitch-Free Camera Zooming & Screen Real Estate (`app/host/area.tsx`)
- **Root Cause of Zoom Glitch Resolved**: MapLibre Android's native render engine would twitch when rapid intermediate step changes dispatched conflicting camera animations while GeoJSON layers updated simultaneously. By debouncing camera framing to 280ms, the boundary ring resizes instantly at 120fps while you swipe or tap, and the camera executes a single, buttery-smooth transition once you settle on a size.
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

### 6. Correct Navbar Mapping & Zero-Opacity Ripple (`app/(tabs)/_layout.tsx`)
- **Accurate Tab Mapping**: Fixed the route-to-tab index mapping so the sliding pill accurately aligns with the active route (`play` $\to 0$, `modes` $\to 1$, `you` $\to 2$) without relying on internal navigation state ordering that inverted Modes and You tabs.
- **Removed Dark Tap Ripple**: Replaced `PlatformPressable` in `tabBarButton` with a clean `Pressable` with `{ color: 'transparent' }` android ripple, completely eliminating the low-opacity black tap effect.
- **Icon-Centered Indicator Pill**: Polished the indicator pill to a 56×32 rounded capsule positioned cleanly behind only the active tab's icon with zero label clipping.

### 7. Swipeable Squads & Schedule Pagers (`app/squads.tsx` & `app/schedule.tsx`)
- **Horizontal Swipe Pager on Squads**: Full-screen horizontal swipe paging (`ScrollView horizontal pagingEnabled`) across **Squads**, **Form Squad**, and **Join Squad** tabs with synchronized animated slider and haptic feedback.
- **Fixed Tab Overflow & Layout**: Replaced cramped custom tab buttons with standard `SegmentBar`, fixing text cutoff on small displays and eliminating icon collisions. Refined squad card layouts and empty states.
- **Horizontal Swipe Pager on Schedule**: Full-screen horizontal swipe paging across **Upcoming** and **Schedule New** tabs. Refined card spacing, RSVP buttons, and bottom inset clearance.
