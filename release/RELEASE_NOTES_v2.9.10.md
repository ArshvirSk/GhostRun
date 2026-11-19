# GhostRun v2.9.10 Release Notes — Operative QR Beacon (Zero-Typing Friending), Live Squad Radar & Leaderboard Profile Modal

**Release Date:** 2026-11-19  
**Artifact:** `release/GhostRun-v2.9.10.apk`  
**Size:** 57,308,816 bytes (54.65 MB)  
**SHA-256 Checksum:** `7DF1C20660E2D7B36B1C7AB37785E95A20474C488DE47F5971C3EE393D0BE51D`  
**Version:** `2.9.10`  
**VersionCode:** `25`  
**Architecture:** `arm64-v8a`  
**Keystore:** `android/app/ghostrun.keystore`  

---

## Overview

GhostRun **v2.9.10** completes the social and tactical network overhaul by introducing in-person zero-typing Operative QR Beacons, a real-time Live Squad Radar for active game lobbies, and universal Operative Profile Dossier inspection across the Seasonal Leaderboard:

- **In-Person Zero-Typing "Operative QR Beacon" (`src/components/OperativeBeaconModal.tsx`, `src/components/OperativeBeaconScannerModal.tsx`, `app/friends.tsx`)**:
  - **Show My Operative Beacon**: Operatives can open a dedicated high-contrast QR Beacon displaying their unique profile link (`https://arshvirsk.github.io/GhostRun/invite?add=@handle` or user ID), operative codename, and live avatar with zero configuration.
  - **Scan Operative Beacon**: A tactical live camera scanner modal equipped with flashlight controls, neon corner reticle brackets, and an animated laser sweep line. Pointing the camera at another player's beacon automatically parses the operative identifier, sounds the acoustic confirmation chime (`scan_success`), triggers haptic feedback, and dispatches the ally request instantly.

- **Live Squad Radar (`app/friends.tsx`, `src/lib/friends.ts`)**:
  - Automatically queries active host presence (`getFriendsHosting()`) across your allied network.
  - When an ally is hosting a game lobby, a high-visibility, glowing **Live Squad Radar** card appears at the top of Tab 1 (Operatives list) displaying host codename, game mode, and current operative count.
  - Includes a one-tap **"Quick Join"** button that immediately navigates the operative into the host's match lobby without manual code entry.

- **Leaderboard Operative Profile Integration (`app/leaderboard.tsx`)**:
  - Tapping any competitor on the seasonal Echo leaderboard now directly launches the comprehensive **Operative Profile Dossier Modal** (`OperativeProfileModal`).
  - Automatically adheres to server-side privacy boundaries: friends view complete career stats, Season Echo tier, badges showcase, and bilateral Head-to-Head telemetry; non-friends view tactical overviews or classified dossiers according to user privacy preference.
