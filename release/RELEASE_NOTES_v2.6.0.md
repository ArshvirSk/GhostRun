# GhostRun v2.6.0 — Tactical UI Restructure & Redesign 🏃‍♂️💨👻

Welcome to **v2.6.0** of **GhostRun**!

GhostRun v2.6.0 delivers a complete, ground-up overhaul of the application architecture, user onboarding, navigation, and visual identity under **Revision 2** of `docs/UI_RESTRUCTURE.md`. Built directly in the bespoke **"Night Radar"** design system, this release pairs tactical stealth gameplay with high-contrast OLED visuals, glanceable HUD layouts, and rock-solid modular foundations.

---

## 🚀 What's New in v2.6.0

### 1. 🎨 "Night Radar" Visual Identity & Design System
* **OLED Stealth Palette:** True-black canvas (`#07090C`), tactical surface elevations (`#0E1318`, `#151C24`), phosphor green runner accents (`#3DFFA2`), and high-visibility hunter amber (`#FF5C00`).
* **Accessible Contrast:** Exceeds WCAG AA standards with >17:1 contrast for canvas typography and >11:1 on primary interactive controls.
* **Component Primitives:** Purpose-built, strict token primitives (`Button`, `Card`, `Chip`, `Sheet`, `Toast`, `CodeBoxes`, `SegmentBar`, `BriefingCard`) with 100% token coverage and 0 hardcoded hex colors.
* **Tactical Motion Engine:** Dynamic radar sweeps, scanline overlays, ghost ripples, and spectral role reveals with first-class `prefers-reduced-motion` accessibility support.

---

### 2. 📱 Floating 3-Tab Bar Navigation
Replaces crowded single-screen layouts with a lightweight, floating pill navigation dock:
* **Play (`/play`):** Full-screen tactical map canvas, active match status card, quick-host launcher, and 4-character join modal.
* **Modes (`/modes`):** Interactive tactical modes library detailing base modes (Classic, Tag Hunt, Jailbreak, Assassin Ring, Relay Heist, Ghost Duel, Territory Pulse), stackable modifiers, and specialized roles.
* **You (`/you`):** Operative dossier with personal career stats, match history, metric/imperial unit toggle, and granular privacy controls.

---

### 3. 🧙‍♂️ 5-Step Host Match Wizard (`/create/wizard`)
Eliminates pan-gesture conflicts and single-scroll overload with a structured 5-step match generator:
1. **Mode Selection:** Select base game mode with live compatibility rules and descriptions.
2. **Tactical Rules:** Set round duration, boundaries, and ping intervals.
3. **Modifiers & Extras:** Stack optional match modifiers (Shrinking Zone, Noise Bar, Contraband Drops, QR Tags, AI Game Master).
4. **Area Setup:** Interactive full-screen map with boundary radius and center plot.
5. **Review & Launch:** Comprehensive pre-flight overview before lobby initialization.

---

### 4. 🚪 3-Segment Tactical Lobby (`/lobby/[id]`)
Streamlined lobby interface divided into three focused segments:
* **Roster:** Player grid with team assignment and host management.
* **Rules & Role Briefing:** Match configuration rules card plus a **private role briefing card** revealing secret tactical objectives (VIP, Bodyguard, Double Agent, Operator) before match start.
* **Readiness:** One-tap ready toggle with required route-sharing privacy choice (`Share route` vs `Keep route private`).

---

### 5. 🛡️ Modular Game Shell & Specialized Role Layouts
* **Isolated Clock Ticks:** Game shell separates the MapLibre canvas and background GPS tracking from UI overlay state, reducing re-renders by 70% and preventing clock-tick cascades into the map engine.
* **Role-Specific HUDs:**
  * **Runner HUD:** Evasion radar, distance to nearest ping, noise bar, and emergency SOS.
  * **Hunter HUD:** Radar sweep ring, proximity ping indicators, heat probe triggers, and tag confirmation.
  * **Operator Console:** Full tactical overwatch with remote sweep triggers, sector censuses, and waypoint broadcasts.
  * **Sprint Mode HUD:** High-speed layout featuring oversized typography, cardinal direction arrows, and minimal distractions for high-velocity chases.

---

### 6. 🏁 Post-Match Debrief Carousel & Tactical Replay
* **Swipeable Result Carousel (`/result/[id]`):** 7 swipeable cards summarizing match outcome, team standings, MVP highlights, specialized role debriefs, and a slot for shareable recap cards.
* **Interactive Replay Scrubber (`/replay/[id]`):** ±15s jump controls, playback speed toggles, ghost echo trail glowing underlays, and vector layer toggles (`🏃 Trails`, `📡 Pings`, `🔥 Heat`, `🗺️ Sectors`, `👻 Ghost`, `📦 Drops`).

---

### 7. 🚀 Onboarding & Entry Experience
* **Hero Welcome:** Cinematic dark hero entry screen.
* **4-Step Sign-Up:** Streamlined name, account credential, verification code, and 18+ policy gate built directly over existing Supabase authentication.
* **8-Beat Briefing Tour:** Interactive, offline-capable guided tour teaching radar mechanics, delayed pings, stealth movement, and tagging using actual in-game HUD components.

---

## 🛠️ Verification & Test Suite

All 10 verification test suites pass cleanly:
1. **TypeScript Compilation:** 0 errors (`npm run typecheck`).
2. **ESLint Static Analysis:** 0 warnings, 0 errors (`npm run lint`).
3. **Route & Deep Link Resolution:** 57 assertions passed (`npm run test:routes`).
4. **Host Wizard Payloads:** 16 assertions passed (`npm run test:wizard`).
5. **Mode Registry Drift:** 45 assertions passed (`npm run test:registry`).
6. **Briefing Tour Engine:** 8 beats verified (`npm run test:tour`).
7. **Hunter Cooldown:** 13 assertions passed (`npm run test:cooldown`).
8. **Game Shell Render Benchmark:** 70% re-render reduction verified (`npm run profile:hud`).
9. **Row Level Security (RLS):** 116+ security assertions passed (`npm run rls`).
10. **Multi-Player Simulation:** 14 full-game scenarios passed (`npm run sim`).

---

## 📦 Release Artifact
* **Artifact:** `release/GhostRun-v2.6.0.apk`
* **File Size:** `173,840,696 bytes` (165.79 MB)
* **Version Name:** `2.6.0`
* **Version Code:** `6`
* **Package Name:** `com.ghostrun.app`
* **Signing Keystore:** `android/app/debug.keystore` (preserves seamless update-in-place compatibility)
* **SHA-256 Checksum:**
  ```text
  E54233679174F6763701A80234B496E0B3EA009B8228E8C89CE4CC57CA8A9DDC
  ```
