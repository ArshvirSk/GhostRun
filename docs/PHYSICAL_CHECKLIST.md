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

---

## UI-M1: Foundations Device Checklist

| ID | Milestone | Item to Check | How to Test | Expected Result | Status |
|---|---|---|---|---|---|
| P-024 | UI-M1 | Dev Preview Screen Rendering | Navigate to `/dev-preview` on physical test device | All shipping base modes, modifiers, and roles render in selectable chip list; RulesCard and interactive ParamField (steppers, switches, pills) display with today's token colors and typography | deferred |

---

## UI-M2: Game Shell & Widgets Device Checklist

| ID | Milestone | Item to Check | How to Test | Expected Result | Status |
|---|---|---|---|---|---|
| P-025 | UI-M2 | GameShell Screen Mounting | Launch game round from `/lobby/[id]` | Routes to `/game/[id]`, delegates cleanly to `<GameShell />`, loads initial state snapshot without crash | deferred |
| P-026 | UI-M2 | Role Layout — Runner | Play as runner in live round | Top HUD displays remaining runners, isolated clock, and mode chips; actions slot enforces max 3 buttons; MapView displays team members | deferred |
| P-027 | UI-M2 | Role Layout — Hunter | Play as hunter in live round | Hunter HUD displays tag-radius ring (20m), TAG button enabled when runner is in proximity, delayed ping blips render | deferred |
| P-028 | UI-M2 | Role Layout — Operator Console | Join as remote operator | GPS upload remains completely bypassed; remote console view enables tactical marker placement (max 3) and sector scan | deferred |
| P-029 | UI-M2 | Role Layout — Spectator | Get tagged or join as spectator | Camera switches to spectator mode; teammate dots visible; opponent live locations strictly hidden | deferred |
| P-030 | UI-M2 | Sprint Mode HUD Layout | Toggle "Sprint Mode" in in-game HUD header | Layout switches to high-contrast oversized typography, showing only compass direction, timer, primary tag/action, and SOS | deferred |
| P-031 | UI-M2 | Timer Isolation & Smooth Map | Observe map during live round for 60s | Clock counts down every 500ms smoothly; map tile renderer maintains steady 60fps with zero stutter or map rebuilds | deferred |
| P-032 | UI-M2 | Classic Chase Widget | Play Classic Chase round | Secret extraction target ring renders on runner map; distance to target updates; arrival banner triggers inside target radius | deferred |
| P-033 | UI-M2 | Tag Hunt Widget | Play Tag Hunt round | Primary TAG button and active runner counter display in hunter HUD; eliminated runners transition cleanly | deferred |
| P-034 | UI-M2 | Jailbreak Widget | Play Jailbreak round with jail | Jail zone circle renders on map; runner within 10m holds rescue button to trigger release; auto-release timer counts down | deferred |
| P-035 | UI-M2 | Assassin Ring Widget | Play 3-player Assassin Ring round | Safe zones render with dashed rings; prey banner displays assigned target; proximity alerts sound when hunter approaches | deferred |
| P-036 | UI-M2 | Relay Heist Widget | Play Relay Heist round | Package blip renders when dropped; carrier holds handoff to pass to nearby teammate; hunters attempt 20s secure hold | deferred |
| P-037 | UI-M2 | Territory Pulse Widget | Play Territory Pulse round | 7 radial sector zones render with team ownership fills; pulse countdown timer syncs; contest alert displays on contested sector | deferred |
| P-038 | UI-M2 | Solo Ghost Duel Widget | Play Solo Ghost Duel round | Ghost NPC path and halo blip render dynamically; target distance chips display; mirror chase TAG GHOST action triggers | deferred |
| P-039 | UI-M2 | Modifier Widgets | Play with Hot/Cold, AI GM, Shrinking Zone | Heat probe action emits hot/cold wash; AI GM dispatch banner displays broadcast narration + fog overlay; boundary shrinks | deferred |
| P-040 | UI-M2 | Role Add-on Widgets | Play with VIP Escort / Double Agent | Bodyguard swap request triggers prompt; Double Agent whisper reveals quadrant and scramble targets runner | deferred |


