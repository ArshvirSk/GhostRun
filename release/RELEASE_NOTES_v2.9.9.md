# GhostRun v2.9.9 Release Notes — Join Room Restyling, Live Camera QR Viewfinder & Tactical Branding

**Release Date:** 2026-11-18  
**Artifact:** `release/GhostRun-v2.9.9.apk`  
**Size:** 57,253,696 bytes (54.60 MB)  
**SHA-256 Checksum:** `84665A5FEDBAE383868A1C6EBE49DDBB128CBA8964B79325E9B81335E52CE34F`  
**Version:** `2.9.9`  
**VersionCode:** `24`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.9** delivers a major upgrade to the multiplayer onboarding and lobby entry experience:

- **Live Camera QR Viewfinder (`app/join.tsx`)**:
  - Replaced the previous static placeholder block with a fully operational, real-time `CameraView` powered by `expo-camera`.
  - Tactical HUD overlay with 4 neon mint corner brackets, a live scanning status badge, and an animated laser sweep line.
  - Built-in torch (flashlight) toggle for scanning host QR codes in dark outdoor or park environments.
  - Automatic parsing of web invite links (`https://ghostrun.app/join/ABCD`), deep links (`ghost-run://join?code=ABCD`), and direct 4-character codes with acoustic confirmation chime (`scan_success`), tactical vibration, and automatic lobby connection.
  - Graceful camera permission handling with a dedicated tactical authorization card and one-tap access grant.

- **Join Room Restyling & GhostRun Branding (`app/join.tsx`)**:
  - Integrated official GhostRun brand mark (`ghostrun-mark-mint.png` / `ghostrun-mark-olive.png`), styled `GHOST`**`RUN`** logotype, and `v2.9.9` version pill in the top navigation bar.
  - Added a tactical `SQUAD INFILTRATION` badge with a pulsing indicator.
  - Implemented a dedicated "Clear code" action for quick code corrections.
  - Polished Obsidian dark theme styling with high-contrast inputs and tactile feedback.

- **Android CodeBoxes Backspace & Focus Fix (`src/ui/CodeBoxes.tsx`)**:
  - Resolved an Android keyboard bug where deleting a character left the focus trapped in the empty box, preventing smooth backspacing across code digits. Focus now shifts backward automatically when a character is cleared.
  - Switched keyboard type to `default` with `autoCapitalize="characters"` on Android to eliminate password masking and eye-icon artifacts.

- **Roadmap & Mode Specification Updates**:
  - Documented the upcoming **PINPOINT** mode (IRL OpenGuessr Scavenger Hunt with up to 750m zone, 3 photo sourcing methods, progressive clue engine, and 5,000-point scoring matrix) in `docs/specs/PINPOINT_MODE_SPEC.md`, `docs/V3_BRAINSTORMING.md`, and `docs/MODES.md`.
