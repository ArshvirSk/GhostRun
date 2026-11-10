# GhostRun v2.7.2 Release Notes — Tactical Navigation & Layout Release

**Release Date:** 2026-11-10  
**Artifact:** `release/GhostRun-v2.7.2.apk`  
**Size:** 173,872,364 bytes (165.82 MB)  
**SHA-256 Checksum:** `07F28BCF0A175B3F736239432B10D232B347DEEF0EBEBA4FC588B00BE2EF69D1`  
**Keystore:** `android/app/debug.keystore` (preserves seamless in-place APK updates)  

---

## Overview

GhostRun v2.7.2 delivers tactical navigation and layout polish across the mobile client. This release resolves edge-to-edge container clipping on the Modes Library, introduces floating physics and elevated drop shadows for the bottom capsule navbar, unboxes the brand logo into clean vector silhouettes, and rolls out a redesigned Operative Case File profile dashboard.

---

## Key Highlights

### 1. Floating Capsule Navbar Physics & Ergonomics
- **Screen Margin Insets:** Increased horizontal margins from the screen edges (`left: 28, right: 28`) and added `paddingHorizontal: 16`, ensuring the floating capsule is clearly distinct from the phone bezels.
- **Elevation & Drop Shadows:** Raised vertical float position to `bottom: Math.max(insets.bottom, 16) + 10`, applied Android Material `elevation: 24`, a deep diffused shadow (`shadowColor: '#000000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.65, shadowRadius: 20`), an elevated graphite fill (`#1C1D24`), and a 1.5px luminous border (`rgba(255, 255, 255, 0.16)`).
- **Smooth Active Tab Pill:** Replaced container-level rectangular highlights with a smooth 50×28 `TabIconWrapper` pill badge (`borderRadius: 14`) directly around the active icon, eliminating rectangular clipping.
- **Crash Prevention:** Hardened `<Button>` against raw string icon names, resolving unhandled runtime exceptions when navigating to Modes.

### 2. Full-Bleed Filter Chips on Modes Library
- Removed the 48px clipping wall on `app/(tabs)/modes.tsx`.
- Applied negative horizontal margins (`marginHorizontal: -18`) with `paddingHorizontal: 18` so the **Squad Size** and **Complexity** filter chips scroll edge-to-edge across the screen without being truncated before the display boundary.

### 3. Unboxed Top Logo & High-Contrast Play Screen
- Replaced the raster squircle-boxed logo with clean, transparent vector ghost silhouette marks:
  - `assets/ghostrun-mark-mint.png` for Dark mode (Neon Mint `#C7F36B`)
  - `assets/ghostrun-mark-olive.png` for Light mode (Field Olive `#557A22`)
- Refactored hero typography to 56px high-contrast layout with an operational status indicator (`GRID LIVE`).

### 4. Operative Case File / Profile Redesign
- Redesigned `app/(tabs)/you.tsx` with a 72×72 circular avatar displaying live radar status and agent initial in their chosen signature color.
- Added `#GR-XXXX` operative callsign badge and expandable drawer with 6 radar signature color swatches.
- Implemented Operational Telemetry dashboard featuring a 40px Win Rate showcase card, visual two-tone progress gauge, and a 2×2 metrics grid (*Rounds*, *Evaded*, *Best Evade*, *Max Distance*).
- Formatted Field Telemetry Log with mode badges and VICTORY / DEFEAT status pills.

### 5. Onboarding & Boot Routing Alignment
- Enforced strict launch sequence for cold starts: Onboarding Briefing Tour (`/briefing`) ➔ Account Options (Beat 8) ➔ Sign In/Up ➔ Home (`/play`).

---

## Automated Verification Suite
- `npm run typecheck` — **0 errors**
- `npm run lint` — **0 errors, 0 warnings**
- `npm run test:routes` — **57/57 tests passing**
- `npm run test:theme` — **15/15 tests passing**
- `npm run test:wizard` — **16/16 tests passing**
- `npm run test:registry` — **passed**
- Gradle Android Release Build (`assembleRelease`) — **BUILD SUCCESSFUL**
