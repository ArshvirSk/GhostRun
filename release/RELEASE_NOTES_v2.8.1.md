# GhostRun v2.8.1 Release Notes — Dedicated Screens & Settings Overhaul

**Release Date:** 2026-11-15  
**Artifact:** `release/GhostRun-v2.8.1.apk`  
**Size:** 56,522,892 bytes (53.90 MB)  
**SHA-256 Checksum:** `23724DBC58C9BA49C09C1F97E9C9C09FE77763E7C9F0DCE50FF787C6829163BD`  
**Version:** `2.8.1`  
**VersionCode:** `14`  
**Architecture:** `arm64-v8a`  
**Privacy Protocol:** `Version 4.0` (Granular operative settings, sensory telemetry, high-contrast deletion safeguards)  
**Keystore:** `android/app/ghostrun.keystore` (SHA-1: `9A:D1:6B:4E:A1:D5:F2:0B:99:D8:01:30:CB:FE:2F:00:E0:E3:C9:A0`)  

---

## Overview

GhostRun **v2.8.1** delivers major UI and UX improvements, dedicated full-screen experiences for persistent squad management and mission scheduling, a complete Settings page overhaul with comprehensive functional switches for notifications and telemetry, and fixes for dark mode contrast and theme selection.

---

## Key Highlights & Changes

### 1. Dedicated Full Screens for Schedule & Squads
- **Standalone Schedule Screen (`app/schedule.tsx`):**
  - Replaced the modal popup with a dedicated, responsive full screen accessible from the Play dashboard.
  - **Upcoming Missions:** Displays all upcoming operations, rendezvous locations, and operational notes.
  - **Interactive RSVPs:** Submit RSVP status directly (Attending, Tentative, Declined) with live server sync.
  - **Calendar Sync (.ICS):** One-tap export and OS sharing for iCalendar / Google Calendar reminders.
  - **Mission Scheduler:** Form with preset rendezvous options (In 2 Hours, Tonight, Tomorrow, Saturday), mode selector, location tags, and mission notes.
- **Standalone Squads Screen (`app/squads.tsx`):**
  - Replaced the crew modal with a dedicated full screen for persistent squad management.
  - **My Squads:** View active squads, leader badges, operative headcount, and invite codes.
  - **Recruitment & Sharing:** Native OS sharing of tactical squad invite codes.
  - **Squad Actions:** Clean leave squad confirmation dialogs with auto-refresh.
  - **Form Squad:** Create persistent squads with custom 4–8 character alphanumeric tactical codes.
  - **Join with Code:** Direct squad entry by inputting shared codes.
  - **Redirect Shim (`app/crews.tsx`):** Ensures backward compatibility for older links and bookmarks.

### 2. Interface Theme Box Overhaul
- **Full-Width Horizontal Segmented Bar:**
  - Redesigned the Interface Theme selector in Settings from a vertically squeezed right-side chip stack into an expansive horizontal segmented 3-button bar (`SYSTEM | LIGHT | DARK`).
  - Equal flex distribution with clear tactical icons, active accent borders, and tactile haptic response.
  - Eliminates vertical text cutting and horizontal overflow across all mobile viewports.

### 3. Dark Mode Delete UI & Danger Text Contrast Fix
- **Theme Token Color Contrast Calibration:**
  - Resolved an accessibility issue where `dangerText` in dark theme was set to `#1F0B00` (nearly pitch black), causing text on dark cards and danger surfaces to be illegible.
  - Updated `darkColors.dangerText` to `#FF8A75` (high-contrast tactical coral) and introduced `dangerButtonText: '#101014'`.
  - Updated `lightColors.dangerText` to `#B94B3A` and `dangerButtonText: '#FFFFFF'`.
  - Updated `src/ui/Button.tsx` to use appropriate button text colors across both solid danger buttons and surface text.
  - Fixed error banners and text readability across Sign-In, Sign-Up, Reset Password, Safety, and Lobby screens.
- **Danger Zone Redesign (`app/settings.tsx`):**
  - High-visibility danger card with warning icon and coral header.
  - Clean `DELETE` confirmation workflow with high-contrast input field and dedicated Purge / Cancel actions.

### 4. Fully Functional System Settings & Telemetry
- **Audio & Telemetry:**
  - **Tactical Audio Cues:** Synchronized with master SFX audio engine (`src/lib/audio.ts`) and persisted.
  - **AI Voice Narration (TTS):** Granular toggle for spoken telemetry callouts during rounds.
  - **Haptic Sensory Feedback:** Synchronized with hardware vibration engine (`src/motion/haptics.ts`).
- **Tactical Notifications & Alerts:**
  - **Remote Push Notifications:** Toggle with automatic permission check and server token synchronization (`syncPushTokenWithServer`).
  - **Tactical Silent Alerts:** Configures Android silent notification channels (`initTacticalNotificationChannels`).
  - **Radar Proximity Warnings:** Controls sensory and audible proximity alerts.
  - **Field Safety Check-Ins:** Toggles periodic field safety verification prompts.
- **Privacy & Consents:**
  - **Squad Lobby Presence (Consent C8):** Real-time server sync via `set_consent('show_presence')`.
  - **Echo Rating Broadcast (Consent C9):** Real-time server sync via `set_consent('share_echo')`.
  - **Anonymous Diagnostics (Consent C7):** Real-time server sync via `set_consent('diagnostics')`.
  - **Operative Data Export:** One-tap export and OS share sheet for complete JSON profile, route, and consent archives.

### 5. Privacy Policy Version 4.0
- Bumped `PRIVACY_VERSION = 4` with updated changelog covering granular notification controls, sensory telemetry settings, and high-contrast deletion safeguards.

---

## Verification & Test Results
- **Route Resolution & Shims:** 61/61 route checks passed (`app/schedule`, `app/squads`, `app/crews` redirect).
- **Theme Persistence & Contrast:** 15/15 tests passed with WCAG AA compliance across both Light and Dark themes.
- **Diagnostics & URLs:** 17/17 tests passed verifying `APP_VERSION === '2.8.1'`.
- **Google Sign-In:** 5/5 tests passed.
- **Scheduled Games & Crews:** 13/13 tests passed.
- **Notifications & Channels:** 26/26 push and silent channel tests passed.
- **TypeScript Typecheck:** Clean exit with 0 errors (`tsc --noEmit`).

---

## Verification Commands
```bash
npm run typecheck
npm run test:routes
npm run test:theme
npm run test:diagnostics
npm run test:schedule
npm run test:crews
npm run test:google
```
