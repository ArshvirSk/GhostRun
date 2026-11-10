# GhostRun v2.7.0 Release Notes — "Afterimage" UI Restructure & Redesign

**Release Date:** 2026-11-10  
**Artifact:** `release/GhostRun-v2.7.0.apk`  
**Size:** 173,844,736 bytes (165.79 MB)  
**SHA-256 Checksum:** `DDF82FD6AB1B1FADE5240AFBFA38B96912A069478AEFAA685EF5FCC7FC517DB4`  
**Keystore:** `android/app/debug.keystore` (preserves seamless in-place APK updates)  

---

## Highlights

### 1. Afterimage Design System (Light / Dark / System)
- Complete visual overhaul of GhostRun with WCAG AAA/AA compliant semantic tokens across all UI controls, HUD chrome, bottom sheets, and MapLibre maps.
- Dynamic `ThemeProvider` with system appearance detection, persistent user choice (`@ghostrun:theme_preference`), and zero hardcoded hex colors across `src/ui`, `src/motion`, and `src/game-shell`.
- Accessible typography with 11 named variants and touch target guarantees (sm: 40dp, md: 48dp, lg: 56dp).

### 2. Onboarding & Briefing Tour
- Modernized landing hero with radar sweep animation and instant access to login, registration, and tutorial.
- 4-step sign-up flow over existing Supabase auth methods with 60s resend cooldown.
- Offline-first 8-beat tactical Briefing tour (`app/(onboarding)/briefing.tsx` & `src/tour/`) with 0 network calls and 0 location requests.
- Mandatory 18+ policy confirmation gate (`PRIVACY_VERSION = 2`).

### 3. Home, Join & 5-Step Host Wizard
- Streamlined Play tab with live map canvas preview, room code entry launcher, and active match recovery.
- 4-character CodeBoxes join modal (`app/join.tsx`) with auto-advance, backspace navigation, wrong-code shake animation, and camera QR scanner.
- 5-step Host Wizard (`app/host/` — Mode, Rules, Extras, Area, Review) solving pan-gesture conflicts and achieving 100% snapshot parity against `create_game`.

### 4. 3-Segment Lobby & Private Role Briefing
- 3-segment Lobby (`ROSTER`, `RULES & INTEL`, `TACTICAL AREA`) with kicking management, remote operator toggles, and ready-up synchronization.
- Private `RoleBriefingCard` with mandatory briefing acknowledgement for high-complexity roles (VIP, Operator, Double Agent) while preserving secrecy.
- Modes Library (`app/(tabs)/modes.tsx`) with squad size and difficulty filters, enforcing the client deny list.
- Operative tab (`app/(tabs)/you.tsx`) with codename/palette customizer, case file stats, and match history.
- Settings and Privacy split with Metric/Imperial units calibration.

### 5. Post-Game & Tactical Replay Polish
- Result screen transformed into a 7-card horizontal swipeable carousel (`app/result/[id].tsx`) including shareable recap card slot and rematch integration.
- Replay screen (`app/replay/[id].tsx`) enhanced with dedicated **±15s** skip buttons and Ghost Echo trail visualization layer.

### 6. Backward Compatibility & Routing Safety
- Seamless redirect shims for legacy routes: `/home` -> `/play`, `/create` -> `/host/mode`, `/target/[id]` -> `/lobby/[id]`, `/auth` -> `/signin`, `/onboarding` -> `/welcome`.
- 100% test suite pass: 57 route & a11y assertions, 51 registry drift checks, 16 host wizard snapshots.
