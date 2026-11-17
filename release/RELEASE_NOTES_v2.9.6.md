# GhostRun v2.9.6 Release Notes — Map Centering, Tactical Rangefinder & Sliding Navbars

**Release Date:** 2026-11-17  
**Artifact:** `release/GhostRun-v2.9.6.apk`  
**Size:** 56,707,560 bytes (54.08 MB)  
**SHA-256 Checksum:** `C5BD3140FA4C9C909CD805DDA3230FC146AA62C34A8C269BE2B40A1A8CF76552`  
**Version:** `2.9.6`  
**VersionCode:** `21`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.6** delivers high-precision spatial and navigational refinements across core screens. This release introduces the new military-grade **Tactical Rangefinder Zone Selector** engineered with a native `PanResponder` and `Animated.spring` gesture engine that guarantees 100% dead-center auto-snapping, direct finger tracking, physical friction, haptic tick feedback, left/right edge gradients, and glitch-free camera zooming, silky-smooth sliding pills on both the main floating navbar and sub-tab bars, a horizontal swipe pager on Modes, Squads, and Schedule tabs, and streamlined card layouts.

---

## Key Highlights & Changes

### 1. PanResponder Spring Dial Zone Selector & 2km Hard Cap (`src/ui/TacticalRangeSelector.tsx`)
- **Native PanResponder Architecture**: Completely replaced native Android `ScrollView` with a `PanResponder` and `Animated.spring` gesture engine. Avoids Android's `disableIntervalMomentum` trap that caused intermediate drag freezing.
- **100% Dead-Center Auto-Snapping**: On finger release anywhere between two sizes, `targetIdx` calculates `Math.round((centerPadding - projectedOffset) / ITEM_WIDTH)` and animates directly to `(windowWidth - ITEM_WIDTH)/2 - clampedIdx * ITEM_WIDTH`. Impossible to get stuck midway between numbers.
- **Direct 1:1 Finger Tracking**: Dial tracks touch gestures with instant 120fps responsiveness and subtle over-scroll resistance at boundary limits (200m and 2000m).
- **Tap-to-Select & Stepper Buttons**: Tap any visible number directly on the dial tape or tap `[-]` and `[+]` buttons to step through 100m increments.
- **Haptic Tick Feedback**: Crisp haptic pulse (`triggerHaptic('buttonTap')`) fires on every single step transition as you swipe or tap.
- **Edge Fades**: Dual `<LinearGradient>` overlays smoothly fade numbers towards the `[-]` and `[+]` stepper buttons with `pointerEvents="none"`.
- **Centered Indicator Reticle**: Active selection is framed inside an accent-highlighted reticle pill.
- **Eliminated Presets Row**: Stripped the redundant row of preset buttons for a clean, focused UI.
- **2.0 km Hard Cap**: Strictly enforced a maximum 2000m (2.0 km) perimeter across all modes.

### 2. Glitch-Free Camera Zooming & Screen Real Estate (`app/host/area.tsx`)
- **Root Cause of Zoom Glitch & In-Out Jump Resolved**: In previous builds, the mount `useEffect` for GPS initialization included `applyCameraCenter` in its dependencies, which had `radius` in its dependency array. Every time the user adjusted the zone radius, the entire mount effect re-triggered from scratch, dispatching an immediate `jumpTo` camera command that collided with MapLibre's in-flight `easeTo` animation. Decoupling `initLocation` to run strictly once on mount and debouncing camera zoom transitions to 250ms completely eliminates all camera twitches, jitters, and in-and-out jumping.
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
