# GhostRun — Physical Device & Playtest Checklist

This document tracks all physical device, multi-device, GPS, sensor, and human verification checks deferred during the UI restructure and redesign.

**Status Legend:**
- `deferred`: Queued for execution on physical hardware / field playtest after agent milestones complete.
- `verified`: Tested on a physical device by the owner and confirmed passing.
- `failed`: Tested on a physical device and failed.

---

## UI-M0: Golden-Path Baseline Device Checklist

| ID | Milestone | Item to Check | How to Test | Expected Result | Status |
|---|---|---|---|---|---|
| P-001 | UI-M0 | App Launch & Splash Transition | Launch app cold on physical Android test device | Splash screen displays centered logo on `#0A0D10` / `#FFFFFF` and transitions smoothly to `/index` bootstrap router | deferred |
| P-002 | UI-M0 | Session Router Direct | Launch with no existing session on device | App checks `@ghostrun:onboarded` and routes immediately to `/onboarding` (first run) or `/auth` | deferred |
| P-003 | UI-M0 | Onboarding Carousel & Gestures | Swipe horizontally across 3 tutorial slides | Smooth 60fps horizontal paging, indicator dots track active slide, Skip navigates to `/auth` | deferred |
| P-004 | UI-M0 | Guest Authentication | Tap "Continue as Guest" on `/auth` | Supabase anonymous auth signs in (if enabled in project), profile checked, routes to `/welcome` or `/privacy?mode=gate` | deferred |
| P-005 | UI-M0 | Email Sign-Up & Cooldown | Enter valid email & password, tap "Create Account" | Cooldown timer begins at 60s, "Confirm your email" pending screen renders, resend button disabled until cooldown elapses | deferred |
| P-006 | UI-M0 | Password Reset Link | Tap "Forgot password", enter email, request reset; tap deep link on device | Deep link `ghost-run://reset-password` opens `/reset-password`, parses code/token, updates password | deferred |
| P-007 | UI-M0 | Welcome Profile & Color Picker | Enter codename, select 1 of 8 player colors, tap "Enter the Grid" | Upserts profile in `public.profiles`, routes to `/privacy?mode=gate` | deferred |
| P-008 | UI-M0 | Privacy Gate (18+ & Consents) | On `/privacy?mode=gate`, review 18+ policy, toggle consent checkboxes, submit | Writes policy ack to `public.consents`, unlocks app, routes to `/home` | deferred |
| P-009 | UI-M0 | Home Screen Map & Location Permission | On `/home`, prompt requests foreground location permission | MapLibre view initializes, centers on user's current GPS fix with blue location dot | deferred |
| P-010 | UI-M0 | Host Game Creation (Classic Chase) | Tap "Host Game", choose mode, drag bottom sheet, tap "Create Game" | Game created with 4-char join code, routes host to `/lobby/[id]` | deferred |
| P-011 | UI-M0 | 4-Character Join Screen | On second device, tap "Join", enter 4-char code | Code boxes auto-advance, uppercase conversion, successfully joins lobby | deferred |
| P-012 | UI-M0 | Lobby Team Assignment & Ready | Host assigns teams (Runner vs Hunter), players toggle ready | Realtime channel syncs roster immediately, ready indicators update | deferred |
| P-013 | UI-M0 | Route Consent Gate (C3) | Attempt ready-up in lobby | Sheet prompts route sharing choice (Yes/No); choice persists to `players.share_trail` | deferred |
| P-014 | UI-M0 | Secret Target Selection | Host starts game in Classic Chase, routes to `/target/[id]` | Map allows dragging target marker inside play boundary; saving target advances game to countdown | deferred |
| P-015 | UI-M0 | Active Game Live HUD | Observe countdown, head start, and live transition | Timer counts down synchronously, role card displays runner/hunter HUD | deferred |
| P-016 | UI-M0 | Background Location Service | Lock screen / background app during live round | Android foreground notification displays "GhostRun is sharing your position", GPS points submit continuously | deferred |
| P-017 | UI-M0 | Delayed Radar Ping Release | Wait for ping interval (e.g. 120s) | Hunter map displays delayed circular ping blip with expanding radar ripple; runner position hidden | deferred |
| P-018 | UI-M0 | GPS Proximity Tagging | Hunter moves within 20m of runner, taps "TAG" | Tag registers on server, runner marked tagged, transition to spectator | deferred |
| P-019 | UI-M0 | Result Screen Recap & Trails | Game ends, routes to `/result/[id]` | Match summary displays winner, end reason, stats, and GPS trails on MapLibre map | deferred |
| P-020 | UI-M0 | Replay Scrubber & Layer Toggles | Tap "Replay" from result screen | Timeline scrubber steps through match history (1x/10x), tags and pings appear at exact timestamps | deferred |
| P-021 | UI-M0 | Rematch Lobby Transition | Tap "Play Again" on result screen | `rematch_game` creates new lobby, all players automatically navigate to new lobby | deferred |
| P-022 | UI-M0 | Emergency SOS | Press SOS button during live game | Confirmation triggers, emits `emergency_sos`, initiates 112/911 dialer, auto-pauses match | deferred |
| P-023 | UI-M0 | Data Export & Deletion | In Settings, tap "Export my data", then confirm "Delete account" | JSON export shares via OS share sheet; account deletion purges profile and signs out | deferred |
