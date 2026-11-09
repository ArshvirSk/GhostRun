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

---

## UI-M3: Design System & Motion Device Checklist

| ID | Milestone | Item to Check | How to Test | Expected Result | Status |
|---|---|---|---|---|---|
| P-041 | UI-M3 | Visual Direction A Sunlight Contrast | Inspect UI primitives and HUD layouts outdoors under direct midday sunlight | Deep charcoal `#050709` background and `#3DFFA2` phosphor green text/accents exceed WCAG AAA (15.8:1) and remain crisply readable | deferred |
| P-042 | UI-M3 | Native Motor Haptic Feedback | Trigger haptic events in `/debug/hud-gallery` (ping arrival, tag confirmed, heat hot/cold, role reveal, button tap, error, SOS, noise) | Distinct tactile vibration cadence and intensity for each event on physical Android motor | deferred |
| P-043 | UI-M3 | 60fps Animation Concurrency | Run simultaneous RadarSweep ambient rotation, PingRipple expansion, and CountUp counter in `/debug/hud-gallery` | Smooth 60fps GPU-accelerated rendering (`useNativeDriver: true`) without frame stutter or main-thread locking | deferred |
| P-044 | UI-M3 | OS Reduced-Motion Setting Compliance | Enable "Remove animations" in Android OS Accessibility settings and observe `/debug/hud-gallery` | Radar sweep and ping ripple gracefully degrade to static dashed radar rings; role reveal skips radar scan and renders role card immediately | deferred |
| P-045 | UI-M3 | Interactive HUD Gallery Screen | Launch `/debug/hud-gallery` cold on physical test device | All design tokens, UI primitives (Button, Card, Chip, Sheet, Toast, CodeBoxes, SegmentBar, BriefingCard), motion components, and 5 role layouts render interactively | deferred |
| P-046 | UI-M3 | Tour Player Beat Progression | Play Briefing tour player in `/debug/hud-gallery` through all 8 canonical beats | Offline scripted beats advance smoothly with story segments, mock radar markers render on radar frame, and tour exits cleanly | deferred |

---

## UI-M4: Onboarding & Entry Flow Device Checklist

| ID | Milestone | Item to Check | How to Test | Expected Result | Status |
|---|---|---|---|---|---|
| P-047 | UI-M4 | First-Run Welcome Navigation | Clear app data / install fresh build, launch app | Cold launch routes directly to `/(onboarding)/welcome`; Night Radar ambient radar sweep renders smoothly | deferred |
| P-048 | UI-M4 | Live Radar Chip Preview & Palette | On `/signup/name`, type codename and tap colors | Callout chip updates uppercase codename in real time; player entity pin renders with selected color ring | deferred |
| P-049 | UI-M4 | Email Registration & Cooldown Timer | On `/signup/account`, register with email; observe `/signup/code` | Confirmation dispatch triggers 60s cooldown countdown; resend button disabled until timer hits 0s | deferred |
| P-050 | UI-M4 | Email Link Deep-Link Verification | Tap confirmation email link on device | Deep link brings app to foreground, restores session, and advances player | deferred |
| P-051 | UI-M4 | Mandatory Age Confirmation Gate | On `/signup/before-you-play`, attempt completion without checking age | Complete button strictly disabled; checking 18+ or guardian confirmation enables button | deferred |
| P-052 | UI-M4 | Native OS Sensor Permissions | On `/signup/before-you-play`, tap Allow on Location, Background, and Notifications | Native Android OS dialogs appear; granting updates status to "Granted ✓" with haptic tap | deferred |
| P-053 | UI-M4 | Offline Briefing Tour Playthrough | Complete setup or tap "Preview Briefing Tour" on `/welcome` | Offline scripted round plays through all 8 beats with story segment progress; Done routes to `/home` | deferred |
| P-054 | UI-M4 | Legacy Route Redirect Shims | Navigate to `/auth` and `/onboarding` manually via deep link | `/auth` redirects cleanly to `/signin`; `/onboarding` redirects cleanly to `/welcome` | deferred |

---

## UI-M5: Home, Join & Host Wizard Device Checklist

| ID | Milestone | Item to Check | How to Test | Expected Result | Status |
|---|---|---|---|---|---|
| P-055 | UI-M5 | Play Tab Ambient Sweep & Codename Greeting | Launch `/play` on device | Radar sweep renders at 60fps in background; codename header and quick actions display cleanly | deferred |
| P-056 | UI-M5 | Active Game Resume Pill | Join a game, press back to Home, view `/play` | Pulsing accent resume card appears with room code and status; tapping returns to match | deferred |
| P-057 | UI-M5 | Join Code Boxes Touch Interaction | On `/join`, type 4-character room code on mobile keyboard | Inputs auto-advance, backspace retreats, paste fills 4 boxes, button activates when 4 chars filled | deferred |
| P-058 | UI-M5 | Join Error Shake & Haptic Feedback | On `/join`, submit an invalid or non-existent 4-character code | Code boxes shake horizontally, error haptic triggers, red alert card displays error message | deferred |
| P-059 | UI-M5 | Deep Link Join Code Prefill | Open deep link `ghost-run://join?code=TEST` in mobile browser | App opens `/join` with code boxes pre-populated with "TEST" | deferred |
| P-060 | UI-M5 | Host Wizard Draft Preservation | Navigate through `/host/mode` -> `rules` -> `extras` -> `area`, press back arrow | All selections (mode, preset, params, roles, modifiers, radius) are preserved without data loss | deferred |
| P-061 | UI-M5 | Map Boundary & Placements Gesture Conflict | On `/host/area`, pan and pinch-zoom the map across boundaries | Map moves smoothly with zero pan gesture conflict (no sheet overlay); tapping map sets placement pin | deferred |
| P-062 | UI-M5 | Legacy Route Redirect Shims | Navigate to `/home`, `/create`, `/target/:id` | `/home` routes to `/play`; `/create` routes to `/host/mode`; `/target/:id` routes to `/lobby/:id` | deferred |

---

## UI-M6: Lobby, Tabs & You Device Checklist

| ID | Milestone | Item to Check | How to Test | Expected Result | Status |
|---|---|---|---|---|---|
| P-063 | UI-M6 | Segmented Lobby Tab Switching | In active lobby, tap Roster, Rules & Intel, and Tactical Map | Seamless instant switching between segments without state resets or flickering | deferred |
| P-064 | UI-M6 | Private Role Briefing Card | Open Rules & Intel in lobby with assigned role | Shows personal directives and objectives; never exposes opponent secrets; high-complexity role requires acknowledgement | deferred |
| P-065 | UI-M6 | C3 Replay Sharing Modal Choice | Join lobby as fresh player | Prominent modal/card prompts for route sharing choice; ready button stays locked until choice selected | deferred |
| P-066 | UI-M6 | Modes Library Filter Chips | On `/modes`, toggle Squad Size (Solo, Squad, Massive) and Complexity (Casual, Tactical, Hardcore) | Mode cards filter dynamically with smooth transitions; empty state provides reset button | deferred |
| P-067 | UI-M6 | Mode Detail Screen & Host Routing | On `/modes/[id]`, review full rules dossier and tap "Host this Mode" | Navigates to `/host/rules` with target mode and compatible rules pre-selected | deferred |
| P-068 | UI-M6 | You Tab Operative Profile Editor | On `/you`, tap Edit, change codename and radar color, tap Save Profile | Updates profile locally and remotely; header immediately reflects new callout chip | deferred |
| P-069 | UI-M6 | Stats Grid & Match History | Play or load games in `/you` | Operational stats (rounds, won, win rate, best escape, farthest) render accurately in case file style | deferred |
| P-070 | UI-M6 | Unit Calibration System Toggle | In `/settings`, switch between Metric (km/m) and Imperial (mi/ft) | Distances across lobby, boundary area, stats grid, and speed alerts convert instantaneously | deferred |
| P-071 | UI-M6 | Audio, Haptics & Map Style Preferences | Toggle Night Radar style, audio cues, and haptic feedback in `/settings` | Preferences persist across app cold starts via AsyncStorage | deferred |

---

## UI-M7: Result, Replay & Gallery Device Checklist

| ID | Milestone | Item to Check | How to Test | Expected Result | Status |
|---|---|---|---|---|---|
| P-072 | UI-M7 | Result Swipeable Cards Carousel | Finish match, swipe horizontally across dossier cards | Smooth 60fps card transitions; pagination dots track active card 1 through 7 | deferred |
| P-073 | UI-M7 | Ghost Echo Glow Layer on Result Map | Inspect runner trails on post-game map | Glowing purple underlay line renders beneath runner trail; closest call marker visible | deferred |
| P-074 | UI-M7 | Replay ±15s Skip Controls | In `/replay/[id]`, tap -15s and +15s buttons | Scrubber jumps exactly 15 seconds backward/forward; map entities and playhead update synchronously | deferred |
| P-075 | UI-M7 | Tactical Layer Toggles | In replay, toggle Trails, Pings, Heat, Sectors, Drops chips | Map layers toggle visibility dynamically without re-querying Supabase | deferred |
| P-076 | UI-M7 | Shareable Recap Card Slot | On Result Card 6, tap "Share Mission Recap" | Displays branded recap card preview with Phase D image generation slot notice | deferred |
| P-077 | UI-M7 | Rematch Flow | On Result Card 7, tap "Play Again" | Calls `rematch_game`, creates rematch lobby, preserves crew and sides, and redirects all players | deferred |

---

## UI-M8: Release-Candidate Verification & Field-Test Sheet

| ID | Milestone | Item to Check | How to Test | Expected Result | Status |
|---|---|---|---|---|---|
| P-078 | UI-M8 | Production Cold Launch & Deep Linking | Install release APK, open `ghost-run://join?code=TEST` | App cold launches in <2s, directly opens `/join` with "TEST" pre-filled | deferred |
| P-079 | UI-M8 | Direct Sunlight High-Contrast Legibility | Test Night Radar visual system outdoors under bright sunlight | Display, HUD metrics, timer, and action buttons clearly legible (WCAG AA compliant) | deferred |
| P-080 | UI-M8 | Rapid Navigation Stress & Memory Stability | Rapidly cycle between Play, Modes, You, Wizard, and Replay | UI thread maintains 60fps; no memory leaks, unmounted component warnings, or crashes | deferred |
| P-081 | UI-M8 | Full Live Field Match (Runners vs Hunters) | 2+ physical Android devices outdoors in public park | Scheduled radar pings release every interval; GPS fixes record; 15m tag registers cleanly | deferred |
| P-082 | UI-M8 | Emergency SOS Physical Activation | During live match, tap SOS in top HUD | Location immediately broadcasts to all players; emergency dial triggers; game auto-pauses | deferred |
| P-083 | UI-M8 | Vehicle Speed Warning Guard | Travel at >28.8 km/h (8 m/s) in car/transit for 10 seconds | Vehicle advisory warning banner appears; speed logged honestly without false unfair verdicts | deferred |





