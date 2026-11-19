# GhostRun v2.9.9 Release Notes — Friends Standings & Head-to-Head Telemetry, Join Room Restyling, Live Camera QR Viewfinder, Friends Live Search & Clickable HTTPS Tactical Invites

**Release Date:** 2026-11-19  
**Artifact:** `release/GhostRun-v2.9.9.apk`  
**Size:** 57,272,968 bytes (54.62 MB)  
**SHA-256 Checksum:** `9083468EB950CF2D37F1022679FC8D2781FB34A57F4C75848B598C3FC8825AEC`  
**Version:** `2.9.9`  
**VersionCode:** `24`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.9** delivers critical improvements across the multiplayer onboarding flow, friends management system, friends-only leaderboard, live camera subsystem, and tactical share links:

- **Friends Standings & Echo Leaderboard (`app/friends.tsx`, `src/lib/friendsBoard.ts`)**:
  - Integrated a dedicated **STANDINGS** tab directly inside the Friends screen (Tab 0 of 5: Standings, Friends, Requests, Add, Privacy).
  - Operatives can now compare Season Echo scores, tier rankings, ghost survival rates, and hunter tag rates without leaving the Friends screen.
  - Features current/previous season toggling, rank badges (#1 Gold, #2 Silver, #3 Bronze), high-contrast "(YOU)" self-indicator, and pull-to-refresh.
  - Interactive **Head-to-Head Telemetry Modal**: Tap any connected friend's standing card to inspect bilateral match stats (Your Wins vs Their Wins, total shared deployments, times you ghosted them, and times they cashed you).
  - Tactical **Echo Guide Modal**: Built-in reference explaining the delayed ping competitive metric, Ghost rate calculations, and Cash rate scoring.
  - Privacy safeguards: Automatically respects the 60-minute match delay and the operative's "Share Season Echo" setting with a direct one-tap toggle if disabled.

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
