# GhostRun v2.9.10 Release Notes — Operative QR Beacon (Zero-Typing Friending), Live Squad Radar & Leaderboard Profile Modal

**Release Date:** 2026-11-19  
**Artifact:** `release/GhostRun-v2.9.10.apk`  
**Size:** 57,300,624 bytes (54.65 MB)  
**SHA-256 Checksum:** `18F6BDDDFFF3E6584D443FDA7762B11DA6D72BA199F1E61F4AE23AE40FA83BF1`  
**Version:** `2.9.10`  
**VersionCode:** `25`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.10** completes the social and tactical network overhaul by introducing in-person zero-typing Operative QR Beacons, a real-time Live Squad Radar for active game lobbies, intuitive standard friend terminology, universal Operative Profile inspection across the Seasonal Leaderboard, and database RPC fixes:

- **Simplified & Standardized Friends UI**:
  - Replaced ambiguous militaristic terminology across modals, buttons, and alerts with direct, universal friend interactions: **"Add Friend"**, **"Remove Friend"**, **"Friends"**, **"Friend Request Sent"**, and **"Accept"**.
  - Search results explicitly indicate confirmed **"Friends"** and **"Request Sent"** statuses with distinctive color accents.

- **Operative Profile RPC Fix & Friendship State Guard**:
  - Resolved column reference in `get_operative_profile` RPC (`round_scores`, `player_badges`, `host_presence`, and `games.created_at`).
  - Corrected `player_status` enum handling (`tagged`).
  - Guaranteed confirmed friends reliably load their full stats and Head-to-Head records with a dedicated "Remove Friend" action instead of erroneously showing friend request buttons.

- **In-Person Zero-Typing "Operative QR Beacon" (`src/components/OperativeBeaconModal.tsx`, `src/components/OperativeBeaconScannerModal.tsx`, `app/friends.tsx`)**:
  - **Show My Operative Beacon**: Operatives can open a dedicated high-contrast QR Beacon displaying their unique profile link (`https://arshvirsk.github.io/GhostRun/invite?add=@handle` or user ID), operative codename, and live avatar with zero configuration.
  - **Scan Operative Beacon**: A tactical live camera scanner modal equipped with flashlight controls, neon corner reticle brackets, and an animated laser sweep line. Pointing the camera at another player's beacon automatically parses the operative identifier, sounds the acoustic confirmation chime (`scan_success`), triggers haptic feedback, and sends the friend request instantly.

- **Live Squad Radar (`app/friends.tsx`, `src/lib/friends.ts`)**:
  - Automatically queries active host presence (`getFriendsHosting()`) across your allied network.
  - When an ally is hosting a game lobby, a high-visibility, glowing **Live Squad Radar** card appears at the top of Tab 1 (Operatives list) displaying host codename, game mode, and current operative count.
  - Includes a one-tap **"Quick Join"** button that immediately navigates the operative into the host's match lobby without manual code entry.

- **Leaderboard Scope Toggle & Uncongested Social Layout (`app/leaderboard.tsx`, `app/friends.tsx`)**:
  - **Leaderboard Scope Selector**: Migrated the leaderboard view toggle directly to `app/leaderboard.tsx`, enabling seamless switching between **FRIENDS ONLY** (allies Echo rankings) and **GLOBAL GRID** (opt-in public seasonal rankings across the entire GhostRun network).
  - **Uncongested Friends Hub**: Streamlined the Friends screen to 4 spacious, clean tabs (`FRIENDS`, `REQUESTS`, `ADD`, `PRIVACY`), eliminating double-stacked nested segment bars.
  - Added a dedicated tactical shortcut banner linking from Friends to the Leaderboard.
  - Fixed mobile text wrapping and clipping on operative badges (preventing `YOU` from clipping to `YO`).

- **Leaderboard Operative Profile Integration (`app/leaderboard.tsx`)**:
  - Tapping any competitor on the seasonal Echo leaderboard now directly launches the comprehensive **Operative Profile Dossier Modal** (`OperativeProfileModal`).
  - Automatically adheres to server-side privacy boundaries: friends view complete career stats, Season Echo tier, badges showcase, and bilateral Head-to-Head telemetry; non-friends view tactical overviews or classified dossiers according to user privacy preference.
