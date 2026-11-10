# GhostRun Visual Audit: Before vs After Comparison (UI-R1)

This document maps each of the 14 reference baseline screenshots from `docs/screenshots/` to their verified Afterimage Dark and Light implementation captures in `docs/screenshots/after_dark/` and `docs/screenshots/after_light/`.

---

## 1. Summary of Cases

| # | Screen / State | Baseline "Before" Screenshot | Defect Identified in Baseline | Afterimage "After" Dark | Afterimage "After" Light | Status |
|---|---|---|---|---|---|---|
| 1 | Tour Beat 1: The Ground | `Screenshot_20261109_181823_GhostRun.jpg` | Baseline capture | `after_dark/Screenshot_20261109_181823_GhostRun.png` | `after_light/Screenshot_20261109_181823_GhostRun.png` | Verified |
| 2 | Tour Beat 2: Head Start | `Screenshot_20261109_181826_GhostRun.jpg` | Label wrapped mid-word: `HUNT / ER (HE / LD)` | `after_dark/Screenshot_20261109_181826_GhostRun.png` | `after_light/Screenshot_20261109_181826_GhostRun.png` | Resolved |
| 3 | Tour Beat 3: Dark | `Screenshot_20261109_181827_GhostRun.jpg` | Baseline dark hunter stealth view | `after_dark/Screenshot_20261109_181827_GhostRun.png` | `after_light/Screenshot_20261109_181827_GhostRun.png` | Verified |
| 4 | Tour Beat 4: The Ping | `Screenshot_20261109_181830_GhostRun.jpg` | Baseline radar ping snapshots | `after_dark/Screenshot_20261109_181830_GhostRun.png` | `after_light/Screenshot_20261109_181830_GhostRun.png` | Verified |
| 5 | Tour Beat 5: Echo | `Screenshot_20261109_181832_GhostRun.jpg` | `YOU (CURRENT)` overlapping `LAST PING` | `after_dark/Screenshot_20261109_181832_GhostRun.png` | `after_light/Screenshot_20261109_181832_GhostRun.png` | Resolved |
| 6 | Tour Beat 7: Tag & Heat | `Screenshot_20261109_181840_GhostRun.jpg` | `TARGE / T` wrap and collision with hunter dot | `after_dark/Screenshot_20261109_181840_GhostRun.png` | `after_light/Screenshot_20261109_181840_GhostRun.png` | Resolved |
| 7 | Play Tab Home | `Screenshot_20261109_181844_GhostRun.jpg` | Bottom links crowded by floating tab bar | `after_dark/Screenshot_20261109_181844_GhostRun.png` | `after_light/Screenshot_20261109_181844_GhostRun.png` | Resolved |
| 8 | Modes Library | `Screenshot_20261109_181847_GhostRun.jpg` | Horizontal chips `MASS...` / `HA...` clipped; bottom cards covered by floating tab bar | `after_dark/Screenshot_20261109_181847_GhostRun.png` | `after_light/Screenshot_20261109_181847_GhostRun.png` | Resolved |
| 9 | You / Case File | `Screenshot_20261109_181851_GhostRun.jpg` | `FARTHES / T` wrapped mid-word; bottom tactical tools obscured by tab bar | `after_dark/Screenshot_20261109_181851_GhostRun.png` | `after_light/Screenshot_20261109_181851_GhostRun.png` | Resolved |
| 10 | Host Wizard Step 1: Mode | `Screenshot_20261109_181909_GhostRun.jpg` | Subtitle wrapped: `4-12 PLAYERS • / STANDARD`; last card covered by CTA dock | `after_dark/Screenshot_20261109_181909_GhostRun.png` | `after_light/Screenshot_20261109_181909_GhostRun.png` | Resolved |
| 11 | Host Wizard Step 2: Rules | `Screenshot_20261109_181918_GhostRun.jpg` | Preset chips wrapped mid-word: `STANDAR / D`, `HARDCOR / E`; bottom parameters covered by CTA dock | `after_dark/Screenshot_20261109_181918_GhostRun.png` | `after_light/Screenshot_20261109_181918_GhostRun.png` | Resolved |
| 12 | Host Wizard Step 4: Area Map | `Screenshot_20261109_181930_GhostRun.jpg` | Blinding white daylight map style under dark theme | `after_dark/Screenshot_20261109_181930_GhostRun.png` | `after_light/Screenshot_20261109_181930_GhostRun.png` | Resolved |
| 13 | Host Wizard Step 5: Review | `Screenshot_20261109_181958_GhostRun.jpg` | Metric labels collided: `DURATIONRADAR PINGTAG RADIUSBOUND`; checklist covered by dock | `after_dark/Screenshot_20261109_181958_GhostRun.png` | `after_light/Screenshot_20261109_181958_GhostRun.png` | Resolved |
| 14 | Lobby Screen | `Screenshot_20261109_182003_GhostRun.jpg` | Title squeezed `PREPARING` badge off-screen; `LEAVE LOBBY` button cut off at screen bottom | `after_dark/Screenshot_20261109_182003_GhostRun.png` | `after_light/Screenshot_20261109_182003_GhostRun.png` | Resolved |

---

## 2. Key Defect Fixes & Code Evidence

### A. Mid-Word Label Wrapping in Tour Markers & Chips
- **Root Cause**: `TourPlayer.tsx` nested `markerLabelContainer` inside the fixed-width 24px `markerDot` container without width boundaries or `numberOfLines={1}`. `Chip.tsx` had excessive horizontal padding (16px per side = 32px total).
- **Fix**:
  - `src/tour/TourPlayer.tsx`: Separated dot and label into a zero-dimension centered `markerAnchor`, wrapped label with `numberOfLines={1}`, and set `labelPosition?: 'top' | 'bottom'`.
  - `src/tour/scripts/core.ts`: Beat 5 sets `r1_now` to `top` and `r1_echo` to `bottom`. Beat 7 sets `h1` to `top` and `r1` to `bottom`.
  - `src/ui/Chip.tsx`: Added `numberOfLines={1}` and `textAlign: 'center'` to `<Text variant="label">`. Adjusted padding to `size === 'sm' ? 8 : 10`.

### B. Floating Tab Bar & Sticky CTA Dock Scroll Coverage
- **Root Cause**: In `app/(tabs)/modes.tsx`, `app/(tabs)/play.tsx`, `app/(tabs)/you.tsx`, and `app/host/*.tsx`, `<ScrollView contentContainerStyle={[styles.content, { padding: spacing.lg }]}>` placed `{ padding: spacing.lg }` second in the style array, overwriting `paddingBottom: 110` with `24`.
- **Fix**: Replaced with `{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 120 }` across all tab screens and host wizard steps.

### C. Review Screen Metric Grid Collision
- **Root Cause**: `metricGrid` used `space-between` without `flex: 1` on columns or gutters.
- **Fix**: Set `metricItem` to `{ flex: 1, alignItems: 'center', justifyContent: 'center' }` with `gap: 6` and `numberOfLines={1}` on all labels.

### D. Map Theme & Sunlight/Stealth Contrast
- **Root Cause**: `app/host/area.tsx` and `src/game-shell/MapView.tsx` hardcoded map tile URL to `liberty` (daylight).
- **Fix**: Integrated `isDark` from `useTheme()`. Injects OpenFreeMap `dark` tiles (`https://tiles.openfreemap.org/styles/dark`) when `isDark` is true, and `liberty` when in Light theme.

### E. System / Light / Dark Theme Persistence
- **Root Cause**: User interface lacked an explicit Theme Switcher in `app/settings.tsx`.
- **Fix**: Added Interface Theme 3-way toggle (`SYSTEM`, `LIGHT`, `DARK`) in `app/settings.tsx`. Persists immediately to `@ghostrun:theme_preference`. Verified with automated test suite `npm run test:theme`.
