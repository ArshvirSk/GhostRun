# GhostRun v2.9.9 Release Notes — Join Room Restyling, Live Camera QR Viewfinder, Friends Live Search & Clickable HTTPS Tactical Invites

**Release Date:** 2026-11-18  
**Artifact:** `release/GhostRun-v2.9.9.apk`  
**Size:** 57,261,032 bytes (54.61 MB)  
**SHA-256 Checksum:** `939B446B8DAAF7FD62405CD482820C4612274AA0DD49121DD1041FC941F6F739`  
**Version:** `2.9.9`  
**VersionCode:** `24`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.9** delivers critical improvements across the multiplayer onboarding flow, friends management system, live camera subsystem, and tactical share links:

- **Clickable HTTPS Tactical Invites (`app/friends.tsx`, `docs/invite/index.html`)**:
  - Replaced non-linkified custom scheme URIs (`ghost-run://`) with a universally clickable, secure HTTPS web URL: `https://arshvirsk.github.io/GhostRun/invite?add=<identifier>`.
  - Recognized and linkified automatically across WhatsApp, Discord, Telegram, SMS, Instagram, and Messenger.
  - Hosted directly via GitHub Pages on the repository, featuring an auto-launch intent script that immediately opens the GhostRun app to the Add Operative tab.
  - Includes tactical landing card showing operative codename, avatar, and one-tap fallback to download the release APK.

- **Friends Network Live Search & Matching (`app/friends.tsx`, `src/lib/friends.ts`)**:
  - Resolved operative lookup failures where searching by codename or unhandled profile returned "Player not found".
  - Deployed `search_operatives(p_query text)` RPC on Supabase PostgreSQL supporting live, case-insensitive substring and exact matches against both `display_name` and `handle` (with optional `@`).
  - Added debounced live search in Tab 3 ("ADD") displaying match cards with initial avatar, operative name, `@handle`, and real-time relationship badges ("Connected", "Sent", "Accept", or "Add").
  - Updated `send_friend_request` RPC on the backend to match operatives by either `display_name` or `handle`.
  - Added a search filter bar to Tab 1 ("FRIENDS") to swiftly search through connected allies.

- **Live Camera QR Viewfinder (`app/join.tsx`)**:
  - Replaced the previous static placeholder block with a fully operational, real-time `CameraView` powered by `expo-camera`.
  - Tactical HUD overlay with 4 neon mint corner brackets, a live scanning status badge, and an animated laser sweep line.
  - Built-in torch (flashlight) toggle for scanning host QR codes in dark outdoor or park environments.
  - Automatic parsing of web invite links, deep links (`ghost-run://join?code=ABCD`), and direct 4-character codes with acoustic confirmation chime (`scan_success`), tactical vibration, and automatic lobby connection.
  - Graceful camera permission handling with a dedicated tactical authorization card and one-tap access grant.

- **Join Room Restyling & GhostRun Branding (`app/join.tsx`)**:
  - Integrated official GhostRun brand mark, styled `GHOST`**`RUN`** logotype, top-aligned layout, and dynamic monochrome theme adaptation.
  - Polished Obsidian dark theme styling with high-contrast inputs and tactical feedback.

- **Android CodeBoxes Backspace & Focus Fix (`src/ui/CodeBoxes.tsx`)**:
  - Resolved an Android keyboard bug where deleting a character left the focus trapped in the empty box. Focus now shifts backward automatically when a character is cleared.
  - Switched keyboard type to `default` with `autoCapitalize="characters"` on Android to eliminate password masking and eye-icon artifacts.

- **Roadmap & Mode Specification Updates**:
  - Documented the upcoming **PINPOINT** mode (IRL OpenGuessr Scavenger Hunt with up to 750m zone, 3 photo sourcing methods, progressive clue engine, and 5,000-point scoring matrix) in `docs/specs/PINPOINT_MODE_SPEC.md`, `docs/V3_BRAINSTORMING.md`, and `docs/MODES.md`.
