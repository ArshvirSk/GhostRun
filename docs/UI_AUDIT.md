# GhostRun — UI Audit and Baseline Report (UI-M0)

**Date:** 2026-11-09  
**Branch:** `ui/m0`  
**Base Commit:** `8f1e813` (`fix(db): apply and reconcile all held migrations 156-164 and achieve 100% test suite pass`)  
**Package Version:** `2.5.0` (`package.json`, `app.json`)  
**Status:** `verified` (read-only audit, zero production code changes)

---

## 1. Route and Screen Catalog

GhostRun currently comprises **15 screens** and **1 root layout** under `app/`:

| Route | File Path | Line Count | Primary Purpose & UX Responsibility | Hooks Used | Shared / Custom Components Imported | Stores & Persistence |
|---|---|---|---|---|---|---|
| `/` | `app/index.tsx` | 240 | Session router & splash bootstrap. Checks onboarding state and auth session, routing to `/onboarding`, `/welcome`, `/privacy?mode=gate`, or `/home`. | `useRouter`, `useCallback`, `useEffect`, `useState`, `useNativeDriver` | `StatusBar` | `AsyncStorage` (`@ghostrun:onboarded`), Supabase Auth session |
| `/welcome` | `app/welcome.tsx` | 309 | First-run codename entry & 8-color picker ("Enter the Grid"). Safety tips, upserts profile to `public.profiles`. | `useRouter`, `useState` | `Ionicons` | Writes to `public.profiles` |
| `/auth` | `app/auth.tsx` | 502 | Authentication screen supporting email/password sign-in, email sign-up, password reset requests, guest sign-in, and resend cooldown. | `useRouter`, `useEffect`, `useState` | `KeyboardAvoidingView`, `ScrollView`, `TextInput` | `AsyncStorage` via `resendCooldown`, Supabase Auth |
| `/reset-password` | `app/reset-password.tsx` | 312 | Password reset deep link handler (`ghost-run://reset-password`). Parses PKCE (`?code=`) and implicit (`#access_token=`) tokens. | `useRouter`, `useEffect`, `useRef`, `useState`, `useURL` | `ActivityIndicator`, `TextInput`, `Pressable` | Supabase Auth session recovery |
| `/onboarding` | `app/onboarding.tsx` | 452 | 3-slide tutorial carousel introducing Real-World Manhunt, Live Radar Pursuit, and Outdoor Rush. Sets `@ghostrun:onboarded`. | `useRouter`, `useRef`, `useState`, `useWindowDimensions` | `LinearGradient`, `Ionicons`, `ScrollView`, `Image` | `AsyncStorage` (`@ghostrun:onboarded`) |
| `/home` | `app/home.tsx` | 346 | Primary landing map canvas: shows codename greeting, Host Game, Join Game, How to Play, Privacy, and Settings buttons. Requests foreground GPS permission on mount. | `useRouter`, `useEffect`, `useState` | `Map`, `Camera`, `UserLocation` (from `src/lib/map`), `Ionicons` | `AsyncStorage` (`@ghostrun:last_location_coords`) |
| `/create` | `app/create.tsx` | 1,009 | Game creation screen with draggable bottom sheet over MapLibre view. Mode selector, radius slider, duration picker, ping interval, roles, and modifiers. | `useRouter`, `useCallback`, `useEffect`, `useRef`, `useState`, `useWindowDimensions`, `useNativeDriver` | `MapLibreMap`, `Camera`, `Layer`, `GeoJSONSource`, `Ionicons` | Local state, calls `create_game` RPC |
| `/join` | `app/join.tsx` | 113 | 4-character join code entry modal with auto-capitalization and QR scan entry point. | `useRouter`, `useState` | `ActivityIndicator`, `TextInput`, `Pressable` | Calls `join_game` RPC |
| `/lobby/[id]` | `app/lobby/[id].tsx` | 1,362 | Pre-game staging: player roster, team selection (Runners vs Hunters), host controls, ready-up toggle, C3 route-sharing modal sheet, jail placement, safe zone controls, rematch redirect listener. | `useLocalSearchParams`, `useRouter`, `useCallback`, `useEffect`, `useMemo`, `useRef`, `useState` | `Ionicons`, `MaterialCommunityIcons`, `ScrollView`, `Modal` | Supabase Realtime channel subscription |
| `/target/[id]` | `app/target/[id].tsx` | 499 | Secret target placement map screen for Classic Chase. Host drags marker inside boundary to set extraction target. | `useLocalSearchParams`, `useRouter`, `useCallback`, `useEffect`, `useMemo`, `useState` | `MapLibreMap`, `Camera`, `Layer`, `GeoJSONSource`, `Ionicons` | Calls `set_target` RPC |
| `/game/[id]` | `app/game/[id].tsx` | 5,221 | Active live gameplay screen: MapLibre canvas, live GPS tracking uploader, delayed radar pings, tag radar ring, tag button, SOS sheet, pause/curfew banner, vehicle speed warning, mode-specific HUDs (Jailbreak, Assassin Ring, Relay Heist, Territory Pulse, Ghost Duel, VIP Escort, Operator Console, AI GM Dock). | `useLocalSearchParams`, `useRouter`, `useCallback`, `useEffect`, `useMemo`, `useRef`, `useState`, `useWindowDimensions`, `useModifierState`, `useNativeDriver` | `MapLibreMap`, `Camera`, `Layer`, `GeoJSONSource`, `HunterQrScanner`, `RunnerQrCard`, `Ionicons`, `MaterialCommunityIcons` | `AsyncStorage` (`ghostrun:muted`), Supabase Realtime channel, local notifications |
| `/result/[id]` | `app/result/[id].tsx` | 1,609 | Post-game debrief: winner banner, end reason, match highlights stats grid, closest call, personal trail preview, C4 ghost contribution prompt, mode recap cards, Play Again rematch button. | `useLocalSearchParams`, `useRouter`, `useCallback`, `useEffect`, `useMemo`, `useRef`, `useState` | `MapLibreMap`, `Camera`, `Layer`, `GeoJSONSource`, `Ionicons`, `MaterialCommunityIcons` | Calls `get_game_state`, `get_game_trails`, `get_game_stats`, `rematch_game` |
| `/replay/[id]` | `app/replay/[id].tsx` | 1,485 | Tactical match scrubber: interactive timeline playhead (1x/10x), route trails, tag markers, radar pings, heat marks, territory zones, and layer visibility toggles. | `useLocalSearchParams`, `useRouter`, `useCallback`, `useEffect`, `useMemo`, `useRef`, `useState` | `MapLibreMap`, `Camera`, `Layer`, `GeoJSONSource`, `Ionicons` | Calls `get_game_replay`, `get_game_trails` |
| `/settings` | `app/settings.tsx` | 295 | Privacy link, GDPR/CCPA personal data JSON export (`export_my_data`), contact email link, account deletion confirmation dialog (`delete_my_data`). | `useRouter`, `useState` | `Ionicons`, `ActivityIndicator`, `TextInput`, `ScrollView` | Calls `export_my_data`, `delete_my_data`, clears `AsyncStorage` (except `@ghostrun:onboarded`) |
| `/privacy` | `app/privacy.tsx` | 510 | Full privacy policy, first-run consent gate (`?mode=gate`), 18+ policy confirmation, consent matrix toggles (C1–C7), ghost contribution opt-out, data export and deletion entry points. | `useLocalSearchParams`, `useRouter`, `useCallback`, `useEffect`, `useState` | `Ionicons`, `ScrollView`, `Switch`, `Pressable` | Calls `get_my_consents`, `set_consent` |
| `_layout` | `app/_layout.tsx` | 32 | Root Expo Router stack layout configuration: disables headers, enables slide animations, dark background container. | None | `Stack` | None |

---

## 2. Addendum A Verification & Corrections

Every item from Addendum A was forensically verified against the codebase:

1. **15 Screens:**
   - **Confirmed:** Exactly 15 screen files exist under `app/` plus 1 root `_layout.tsx`.
   - Line counts confirmed: `game/[id].tsx` is 5,221 lines; `create.tsx` is 1,009 lines; `lobby/[id].tsx` is 1,362 lines; `result/[id].tsx` is 1,609 lines; `replay/[id].tsx` is 1,485 lines.

2. **Auth Today:**
   - **Confirmed & Corrected:** Auth is **not** only email and password. `app/auth.tsx` supports:
     - Email and password sign-in (`signInWithPassword`).
     - Email and password sign-up (`signUp`) with email confirmation cooldown (60s).
     - Password reset request (`resetPasswordForEmail`) with deep link redirect to `/reset-password`.
     - Guest sign-in (`signInAnonymously`).
     - Deep-link password recovery handler (`app/reset-password.tsx`) parsing PKCE `?code=` and implicit `#access_token=`.

3. **Server Catalogue Functions:**
   - **Confirmed:** PostgreSQL catalogue functions exist and are authoritative:
     - `public.mode_catalogue()`: returns active base modes (`classic_chase`, `tag_hunt`, `jailbreak`, `assassin_ring`, `relay_heist`, `territory_pulse`, `ghost_duel`).
     - `public.modifier_catalogue()`: returns modifiers (`noise_meter`, `dead_drops`, `hot_cold`, `shrinking_zone`, `ai_gm`).
     - `public.role_catalogue()`: returns roles (`vip`, `operator`, `double_agent`).

4. **Location Permission Request Location:**
   - **Discrepancy Settled:** Location permissions are **never requested in `app/onboarding.tsx`**.
   - Location permissions are requested in:
     - `app/home.tsx`: requests foreground permission on mount via `Location.requestForegroundPermissionsAsync()`.
     - `app/create.tsx`: requests foreground permission on mount to center the map bounding box.
     - `src/lib/location.ts`: during active games, requests foreground permission and background permission (`Location.requestBackgroundPermissionsAsync()`).

5. **Settings Screen Contents (Critical Correction):**
   - **Corrected:** Addendum A suggested `/settings` already contains audio, haptics, metric/imperial units, and battery advice.
   - **Actual State:** `app/settings.tsx` currently only contains Privacy navigation, Data Export (`export_my_data`), and Account Deletion (`delete_my_data`). It does **not** have audio toggles, haptic toggles, metric/imperial unit switching, or battery optimization advice. Metric/imperial unit toggles do not exist anywhere in the app (all distances are hard-coded in meters `m` or kilometers `km`). Audio mute toggle exists in `app/game/[id].tsx` (`ghostrun:muted`).

6. **Handles & Welcome Picker:**
   - **Confirmed:** Sign-up collects display name and an 8-color picker in `app/welcome.tsx`. No handle (`@username`) step exists in the client or database schema. Solo Ghost Duel leaderboards display display names (masked to "Anonymous Runner" if consent C5 is withheld).

---

## 3. Deep Links, Notifications, QR Links, and Persisted Keys

### Deep Links & Schemes
- **Custom URL Scheme:** `ghost-run://` (configured in `app.json` line 7).
- **Password Reset:** `ghost-run://reset-password` handled by `app/reset-password.tsx` via `parseRecoveryUrl` (`src/lib/authLink.ts`), supporting PKCE `?code=` and implicit hash `#access_token=`.
- **Join Code:** Modal `/join` accepts `?code=` query parameters.
- **Privacy Gate:** `/privacy?mode=gate` acts as first-run policy gate.

### Notification Tap Targets & Background Services
- **Foreground Location Notification:** Configured in `src/lib/location.ts` with title `"GhostRun is sharing your position"`, body `"Your team can see you while the round is live."`, and color `"#1D4ED8"`.
- **In-Game Local Notifications:** `app/game/[id].tsx` requests notification permissions and schedules alerts via `Notifications.scheduleNotificationAsync` for game events (pings, tags, phase transitions) when sound is unmuted.

### QR Code Scanning & Generation
- **Dynamic QR Generation:** `src/components/RunnerQrCard.tsx` calls `supabase.rpc('qr_token', { game_id })` to generate a rotating HMAC token with a 20-second TTL and renders it via `qrcode` SVG canvas.
- **Hunter QR Scanner:** `src/components/HunterQrScanner.tsx` uses `expo-camera` (`CameraView`) to scan runner QR tags and submits them to `supabase.rpc('tag_by_qr', { token })`.
- **Join Screen QR Toggle:** `/join` provides a QR scan toggle to read game lobby join links.

### Persisted AsyncStorage Keys
| Storage Key | Location Used | Purpose |
|---|---|---|
| `@ghostrun:onboarded` | `app/index.tsx`, `app/onboarding.tsx`, `app/settings.tsx` | Boolean flag (`'true'`) indicating tutorial carousel completion. Preserved during account deletion. |
| `@ghostrun:last_location_coords` | `app/home.tsx` | Cached `{ latitude, longitude }` to instantly center home map before GPS lock. |
| `ghostrun:muted` | `app/game/[id].tsx` | Audio mute toggle preference (`'true'` / `'false'`). |
| In-Memory Resend Cooldown | `src/lib/resendCooldownCore.ts` | 60-second auth email resend cooldown tracker. |

---

## 4. Modes, Modifiers, and Roles Inventory

Comparison against `docs/MODE_STATUS.md` and `UI_RESTRUCTURE.md` §9.4:

| Category | Identifier | Present in Code | Server Catalogue Flag | Status / Deny List State |
|---|---|---|---|---|
| **Base Mode** | `classic_chase` | Yes (`app/create.tsx`, `game/[id].tsx`, etc.) | `feature.mode.classic_chase = true` | **Shipping** |
| **Base Mode** | `tag_hunt` | Yes (`app/create.tsx`, `game/[id].tsx`, etc.) | `feature.mode.tag_hunt = true` | **Shipping** |
| **Base Mode** | `jailbreak` | Yes (`app/create.tsx`, `game/[id].tsx`, etc.) | `feature.mode.jailbreak = true` | **Shipping** |
| **Base Mode** | `assassin_ring` | Yes (`app/create.tsx`, `game/[id].tsx`, etc.) | `feature.mode.assassin_ring = true` | **Shipping** |
| **Base Mode** | `relay_heist` | Yes (`app/create.tsx`, `game/[id].tsx`, etc.) | `feature.mode.relay_heist = true` | **Shipping** |
| **Base Mode** | `territory_pulse`| Yes (`app/create.tsx`, `game/[id].tsx`, etc.) | `feature.mode.territory_pulse = true` | **Shipping** |
| **Base Mode** | `ghost_duel` | Yes (`app/create.tsx`, `game/[id].tsx`, etc.) | `feature.mode.ghost_duel = true` | **Shipping** (Public leaderboard hidden pending moderation) |
| **Base Mode** | `haunted_map` | Stubs only in `game/[id].tsx` | `feature.mode.haunted_map = false` | **HIDDEN (Deny List):** Server-simulated NPC patrol mode. Excluded from UI. |
| **Base Mode** | `horde` | None (Deferred to future scope) | Not in DB | **HIDDEN (Deny List):** Server NPC swarm mode. Excluded from UI. |
| **Base Mode** | `manhunt` | Marketing badge in `app/onboarding.tsx` | Not in DB | **HIDDEN (Deny List):** Concept pitch copy only; no programmatic mode exists. |
| **Modifier** | `noise_meter` | Yes (`src/components/GameModifiers.tsx`) | `feature.modifier.noise_meter = true` | **Shipping** |
| **Modifier** | `dead_drops` | Yes (`src/components/GameModifiers.tsx`) | `feature.modifier.dead_drops = true` | **Shipping** |
| **Modifier** | `hot_cold` | Yes (`src/components/GameModifiers.tsx`) | `feature.modifier.hot_cold = true` | **Shipping** |
| **Modifier** | `shrinking_zone`| Yes (`src/components/GameModifiers.tsx`) | `feature.modifier.shrinking_zone = true` | **Shipping** |
| **Modifier** | `ai_gm` | Yes (`app/game/[id].tsx`, `result/[id].tsx`) | `feature.modifier.ai_gm = true` | **Shipping** |
| **Modifier** | `qr_tagging` | Yes (`HunterQrScanner.tsx`, `RunnerQrCard.tsx`) | `feature.modifier.qr_tagging = false` | **HIDDEN (Deny List):** Off by default until physical daylight camera verification. |
| **Role Add-on** | `double_agent` | Yes (`app/lobby/[id].tsx`, `game/[id].tsx`) | `feature.role.double_agent = true` | **Shipping** |
| **Role Add-on** | `vip` | Yes (`app/lobby/[id].tsx`, `game/[id].tsx`) | `feature.role.vip = true` | **Shipping** |
| **Role Add-on** | `operator` | Yes (`app/lobby/[id].tsx`, `game/[id].tsx`) | `feature.role.operator = true` | **Shipping** |

---

## 5. Hard-Coded Literal Inventory

Static analysis of literal values across screens:

| File Path | Total Lines | Hex Color Literals | FontSize Literals | Spacing Literals (`margin`/`padding`/`gap`) |
|---|---|---|---|---|
| `app/index.tsx` | 240 | 11 | 6 | 8 |
| `app/welcome.tsx` | 309 | 42 | 16 | 25 |
| `app/auth.tsx` | 502 | 24 | 12 | 17 |
| `app/reset-password.tsx` | 312 | 19 | 9 | 13 |
| `app/onboarding.tsx` | 452 | 18 | 6 | 17 |
| `app/home.tsx` | 346 | 28 | 14 | 19 |
| `app/create.tsx` | 1,009 | 49 | 17 | 31 |
| `app/join.tsx` | 113 | 13 | 7 | 7 |
| `app/lobby/[id].tsx` | 1,362 | 105 | 45 | 62 |
| `app/target/[id].tsx` | 499 | 38 | 17 | 19 |
| `app/game/[id].tsx` | 5,221 | 357 | 83 | 165 |
| `app/result/[id].tsx` | 1,609 | 93 | 45 | 65 |
| `app/replay/[id].tsx` | 1,485 | 85 | 21 | 36 |
| `app/settings.tsx` | 295 | 30 | 14 | 24 |
| `app/privacy.tsx` | 510 | 47 | 21 | 30 |
| `src/components/GameModifiers.tsx` | 1,334 | 82 | 38 | 74 |
| `src/components/HunterQrScanner.tsx` | 424 | 22 | 11 | 18 |
| `src/components/RunnerQrCard.tsx` | 254 | 16 | 8 | 12 |
| **Totals** | **16,285** | **1,051** | **381** | **643** |

---

## 6. Mode-Specific Logic Distribution

Mode-specific logic is currently scattered across 5 core screen files and 1 component file:

1. **`app/game/[id].tsx` (5,221 lines):**
   - *Jailbreak:* Jail entity rendering, prisoner state banner, rescue hold progress button (`start_rescue`, `complete_rescue`).
   - *Assassin Ring:* Safe zones circular overlays, prey assignment HUD contract, sensory proximity pulses (`near`, `close`).
   - *Relay Heist:* Package carrier badge, package drop beacon, 5m handoff confirmation, 20s extraction hold button.
   - *Territory Pulse:* 7 circular sector zones rendering, pulse countdown banner, score tally dock, contest tag suppression.
   - *Solo Ghost Duel:* Time trial target arrival, evade 20m proximity check, mirror chase ghost stepping blips, `tag_ghost` button.
   - *VIP Escort:* VIP crown and Bodyguard shield badges, physical role swap modal sheet, 60s freeze countdown timer.
   - *Operator Console:* Remote operator map mode, 3 tactical markers placement, runner scan sweep (150m envelope), hunter census.
   - *AI Game Master:* Radio dispatch dock, narration banner, fog overlay canvas (`fogOverlay`).

2. **`app/create.tsx` (1,009 lines):**
   - Mode parameter sliders, jail location placement toggle, extraction point placement, territory pulse duration, ghost duel variant selector, modifier toggles.

3. **`app/lobby/[id].tsx` (1,362 lines):**
   - Mode rules text, operator toggle switch, double agent readiness, jail placement map sheet, safe zone radius adjustment.

4. **`app/result/[id].tsx` (1,609 lines):**
   - Mode debrief cards (Jailbreak prisoner rescues, Assassin Ring elimination sequence, Relay Heist package handoffs, Territory Pulse dominance score summary, Ghost Duel personal debrief card, VIP bodyguard defense highlights, AI GM event log).

5. **`app/replay/[id].tsx` (1,485 lines):**
   - GeoJSON vector sources for territory sectors, heat probe marks, dead drops, and recorded ghost lines with interactive toggle chips.

---

## 7. Dependencies Relevant to Motion, Fonts, Maps, and Auth

| Category | Package Name | Installed Version | Notes & Gaps |
|---|---|---|---|
| **Maps** | `@maplibre/maplibre-react-native` | `^11.5.0` | Production vector tile rendering with MapLibre Native. Dark style configured via `EXPO_PUBLIC_MAP_STYLE_URL`. |
| **State** | `zustand` | `^5.0.8` | Installed in `package.json`, ready for split stores (`session`, `draft`, `game`, `ui`). |
| **Storage** | `@react-native-async-storage/async-storage` | `2.2.0` | Official Expo SDK 58 version. |
| **Backend & Auth** | `@supabase/supabase-js` | `^2.118.0` | Supabase JS client. |
| **URL Polyfill** | `react-native-url-polyfill` | `^3.0.0` | Required for Supabase auth URL parsing in React Native. |
| **Linking** | `expo-linking` | `~58.0.15` | Deep linking handler for PKCE and password resets. |
| **Hardware** | `expo-camera` | `~58.0.14` | Barcode scanning for QR tagging. |
| **Audio** | `expo-audio` | `~58.0.11` | Custom sound player. |
| **Location** | `expo-location` | `~58.0.20` | Background & foreground GPS tracking. |
| **Motion** | Built-in React Native `Animated` | N/A | `react-native-reanimated` is **not installed**. `Animated.timing` with `useNativeDriver` is used. |
| **Fonts** | `@expo/vector-icons` | `^15.0.2` | `expo-font` is not explicitly declared as a top-level dependency in `package.json`. |
| **Third-Party Auth**| None | N/A | No Google Sign-In SDK is installed. |

---

## 8. Baseline Test Suite Verification Outputs

All five mandatory verification suites were executed on branch `ui/m0` against commit `8f1e813` and passed with **zero errors**:

### 1. `npm run typecheck`
```
> ghostrun@2.5.0 typecheck
> tsc --noEmit
```
*(Clean exit code 0; 0 errors)*

### 2. `npm run lint`
```
> ghostrun@2.5.0 lint
> expo lint

env: load .env
env: export EXPO_PUBLIC_MAP_STYLE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_SUPABASE_URL SUPABASE_DB_PASSWORD
```
*(Clean exit code 0; 0 warnings, 0 errors)*

### 3. `npm run test:cooldown`
```
> ghostrun@2.5.0 test:cooldown
> node --env-file=.env --import tsx scripts/test-resend-cooldown.ts

PASS empty storage allows a resend
PASS future deadlines are returned
PASS emails are normalized when stored
PASS deadlines are isolated per email
PASS a second email keeps the first deadline
PASS expired deadlines allow a resend
PASS expired entries are pruned on write
PASS active entries survive a write
PASS the new deadline is written
PASS bad JSON is treated as empty
PASS bad JSON is replaced on write
PASS write failures are swallowed
PASS write failures leave no usable deadline

All cooldown checks passed.
```

### 4. `npm run rls`
```
> ghostrun@2.5.0 rls
> node --env-file=.env --import tsx scripts/rls-check.ts

Anonymous sign-ins are disabled; using email/password test users instead.
PASS created email/password test user for Host (rls-host-1794173331845-100859@ghostrun.test)
PASS created email/password test user for Hunter (rls-hunter-1794173333701-315627@ghostrun.test)
PASS created email/password test user for Outsider (rls-outsider-1794173334228-449662@ghostrun.test)
...
[All 120+ RLS & RPC authorization checks passed]
...
--- summary ---
All access checks passed.
```

### 5. `npm run sim`
```
> ghostrun@2.5.0 sim
> node --env-file=.env --import tsx scripts/sim/index.ts

--- mode framework ---
PASS an incompatible role and mode are rejected
PASS an unknown modifier is rejected
PASS a duplicate modifier is rejected
PASS a valid but disabled modifier is rejected until its flag is on
PASS a default game can be created
PASS the registry exposes enabled base modes
PASS the implemented modifiers are enabled in the registry
PASS unimplemented modifiers stay disabled
PASS set_game_modes rejects a disabled modifier
PASS set_game_modes saves an empty configuration
PASS a non-host cannot change the mode setup
...
[All 15 gameplay scenarios passed]
...
--- summary ---
All simulator checks passed.
```

---

## 9. Recommendations and Trade-offs for Decisions U-D1 to U-D13 & Addendum C

### Decisions U-D1 to U-D13
- **U-D1 (Tabs):**
  - *Recommendation:* Adopt **Three tabs: Play · Modes · You** with a floating pill tab bar.
  - *Trade-off:* Defer Ranks until global leaderboards ship in NF-14. Keeps the navigation clean and immediate for physical gameplay.
- **U-D2 (Host Flow):**
  - *Recommendation:* Replace monolithic `create.tsx` bottom sheet with a **5-step wizard** (Mode, Rules, Roles & Modifiers, Area & Placements, Review).
  - *Trade-off:* Multi-step navigation requires a draft store (`zustand`), but completely eliminates the pan-gesture conflict between the bottom sheet and the map canvas.
- **U-D3 (Room Code Format):**
  - *Recommendation:* Maintain **4-character uppercase alphanumeric code** (`char(4)`), matching server DB schema. Adapt UI code boxes to accept 4 characters.
  - *Trade-off:* 4 characters allows $36^4 \approx 1.68\text{M}$ combinations. Server rate-limits brute force. Changing length would require an outward DB schema migration.
- **U-D4 (`manhunt`):**
  - *Recommendation:* Retain `manhunt` on the client deny list (hidden).
  - *Trade-off:* `manhunt` exists only as pitch copy in slide 1 of onboarding. No programmatic mode exists or is needed.
- **U-D5 (Gated Modes in Modes Library):**
  - *Recommendation:* Show only modes enabled in server catalogues that have passing RLS and simulator tests (`classic_chase`, `tag_hunt`, `jailbreak`, `assassin_ring`, `relay_heist`, `territory_pulse`, `ghost_duel`).
  - *Trade-off:* Keeps players from attempting to launch unverified or flagged-off experiences.
- **U-D6 (History Placement):**
  - *Recommendation:* Place match history inside the **You** tab case file.
  - *Trade-off:* Keeps the Play tab focused strictly on starting or joining an active game.
- **U-D7 (Visual Direction):**
  - *Recommendation:* Adopt **Direction A: Night Radar** (Deep ink `#0A0D10`, phosphor green `#3DFFA2`, hunter amber `#FFB020`, thermal red `#FF4D3D` and cold blue `#3D8BFF`).
  - *Trade-off:* Perfect for nighttime stealth play and high-contrast sunlight visibility; completely original and distinct from competing apps.
- **U-D8 (Auth Approach):**
  - *Recommendation:* Build the 5-step onboarding flow **over existing auth methods** (email/password, emailed verification code, and guest sign-in). Keep Google Sign-In and account linking optional/deferred.
  - *Trade-off:* Zero user lockout; avoids blocking UI restructure on third-party Google Cloud Console setup and SHA-1 keystore fingerprints.
- **U-D9 (Fonts):**
  - *Recommendation:* Use open-licensed fonts: **Space Grotesk** (Display/Headlines, OFL), **Inter** or System Sans (Body, OFL), and **JetBrains Mono** (Labels/Timers, OFL).
  - *Trade-off:* Distinctive technical feel without licensing fees or legal risk.
- **U-D10 (Tour Map):**
  - *Recommendation:* Render the Briefing tour using the **real MapLibre view with custom dark style** and mock scripted state.
  - *Trade-off:* Reuses the production map renderer while remaining 100% offline and requiring zero location permissions.
- **U-D11 (Satellite Map):**
  - *Recommendation:* **Skip satellite map** for now; support Standard Dark and Standard High-Contrast vector maps only.
  - *Trade-off:* Free satellite tile services either have restrictive non-commercial terms or require credit-card-backed API quotas. Vector tiles keep the app license-clean.
- **U-D12 (Light Theme):**
  - *Recommendation:* **Dark theme only** for v2.6.0; prepare token architecture so Light theme can be added via token swap later.
  - *Trade-off:* Halves visual asset surface area while prioritizing the core nighttime stealth aesthetic.
- **U-D13 (Age Policy):**
  - *Recommendation:* Maintain the established policy: **"18 or older, or playing under a guardian's supervision"** (`PRIVACY_VERSION = 2`).
  - *Trade-off:* Avoids COPPA compliance barriers while supporting family and supervised youth play.

### Addendum C Items
- **Addendum C Item 1 (Registry Source of Truth):**
  - *Recommendation:* Adopt **Option (b)**: Maintain a typed client registry (`src/modes/`) paired with an automated drift test (`scripts/registry-drift.ts`) that asserts client metadata matches `mode_catalogue()`, `modifier_catalogue()`, and `role_catalogue()` on every test run.
  - *Trade-off:* Gives the client offline presentation data (rich copy, icons, widgets, tour beats) while guaranteeing zero drift from database rules.
- **Addendum C Item 8 (Welcome Color Choice):**
  - *Recommendation:* Retain color selection in **Step 1 of the sign-up flow**, and make it editable at any time in the **You** tab profile view.
  - *Trade-off:* Gives immediate tactical identity to new runners while preserving flexibility.
- **Addendum C Item 9 (Handles):**
  - *Recommendation:* **Ship sign-up with display name and color only** (no handle step).
  - *Trade-off:* Adding handles requires server-side uniqueness constraints, an availability check RPC, and reserve word lists. Defer until an approved handle spec is ready.
- **Addendum C Item 5 (Google Sign-In):**
  - *Recommendation:* **Defer Google Sign-In** until human configuration prerequisites (GCP OAuth Client ID, Android keystore SHA-1, and Supabase Auth dashboard provider configuration) are provided.
  - *Trade-off:* Preserves existing reliable email and guest auth methods without introducing build-blocking credentials.
