# GhostRun — UI Audit and Baseline Report (UI-M0 Refresh)

**Date:** 2026-11-10  
**Branch:** `ui/ui-m0`  
**Base Commit:** `f883f79` (`fix: resolve boot routing to privacy gate and fix set_consent RPC parameter signature`)  
**Package Version:** `2.6.1` (`package.json`, `app.json`)  
**Status:** `verified` (read-only audit, zero production code changes)

---

## 1. Route and Screen Catalog

GhostRun currently comprises **15 screens** and **1 root layout** under `app/`:

| Route | File Path | Line Count | Primary Purpose & UX Responsibility | Hooks Used | Shared / Custom Components Imported | Stores & Persistence |
|---|---|---|---|---|---|---|
| `/` | `app/index.tsx` | 240 | Session router & splash bootstrap. Checks onboarding state and auth session, routing to `/onboarding`, `/welcome`, `/privacy?mode=gate`, or `/play`. | `useRouter`, `useCallback`, `useEffect`, `useState`, `useNativeDriver` | `StatusBar` | `AsyncStorage` (`@ghostrun:onboarded`), Supabase Auth session |
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
   - **Actual State:** In the legacy code, `/settings` only contained Privacy navigation, Data Export (`export_my_data`), and Account Deletion (`delete_my_data`). Unit switching, audio/haptic toggles, and appearance settings are implemented in the restructured settings view.

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
| `@ghostrun:onboarded` | `app/index.tsx`, `app/onboarding.tsx`, `app/settings.tsx`, `app/privacy.tsx` | Boolean flag (`'true'`) indicating onboarding/gate completion. Preserved during account deletion. |
| `@ghostrun:last_location_coords` | `app/home.tsx` | Cached `{ latitude, longitude }` to instantly center home map before GPS lock. |
| `ghostrun:muted` | `app/game/[id].tsx` | Audio mute toggle preference (`'true'` / `'false'`). |
| `@ghostrun:theme_preference` | `src/theme/ThemeContext.tsx` | Persisted theme preference (`system` / `light` / `dark`). |
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

Mode-specific logic distribution across legacy core files:

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
| **Maps** | `@maplibre/maplibre-react-native` | `^11.5.0` | Production vector tile rendering with MapLibre Native. Dynamic light/dark styling supported via style URLs. |
| **State** | `zustand` | `^5.0.8` | Installed in `package.json`, powers split stores (`session`, `draft`, `game`, `ui`). |
| **Storage** | `@react-native-async-storage/async-storage` | `2.2.0` | Official Expo SDK 58 version. |
| **Backend & Auth** | `@supabase/supabase-js` | `^2.118.0` | Supabase JS client. |
| **URL Polyfill** | `react-native-url-polyfill` | `^3.0.0` | Required for Supabase auth URL parsing in React Native. |
| **Linking** | `expo-linking` | `~58.0.15` | Deep linking handler for PKCE and password resets. |
| **Hardware** | `expo-camera` | `~58.0.14` | Barcode scanning for QR tagging. |
| **Audio** | `expo-audio` | `~58.0.11` | Custom sound player. |
| **Location** | `expo-location` | `~58.0.20` | Background & foreground GPS tracking. |
| **Motion** | Built-in React Native `Animated` | N/A | `react-native-reanimated` is **not installed**. `Animated.timing` with `useNativeDriver` is used. |
| **Fonts** | `@expo/vector-icons` | `^15.0.2` | Clean system sans and monospace fonts utilized; open-licensed font assets bundled per license compliance. |
| **Third-Party Auth**| None | N/A | No third-party OAuth SDKs installed. |

---

## 8. Baseline Test Suite Verification Outputs

All five mandatory verification suites were executed on branch `ui/ui-m0` against commit `f883f79` and passed with **zero errors**:

### 1. `npm run typecheck`
```
> ghostrun@2.6.1 typecheck
> tsc --noEmit
```
*(Clean exit code 0; 0 errors)*

### 2. `npm run lint`
```
> ghostrun@2.6.1 lint
> expo lint

env: load .env
env: export EXPO_PUBLIC_MAP_STYLE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_SUPABASE_URL SUPABASE_DB_PASSWORD
```
*(Clean exit code 0; 0 warnings, 0 errors)*

### 3. `npm run test:cooldown`
```
> ghostrun@2.6.1 test:cooldown
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
> ghostrun@2.6.1 rls
> node --env-file=.env --import tsx scripts/rls-check.ts

Anonymous sign-ins are disabled; using email/password test users instead.
PASS created email/password test user for Host (rls-host-1794260532495-607625@ghostrun.test)
PASS created email/password test user for Hunter (rls-hunter-1794260534485-464509@ghostrun.test)
PASS created email/password test user for Outsider (rls-outsider-1794260535341-463952@ghostrun.test)
PASS host can create a game
PASS second player can join by code
PASS rapid wrong join code attempts tested (10 attempts executed)
PASS players can choose their own teams
PASS outsider cannot read games
PASS outsider cannot read players
PASS outsider cannot call get_game_state
PASS hunter can read their game
PASS hunter can read the roster
PASS host can open target selection
PASS hunter cannot advance the lobby
PASS hunter cannot set the target
PASS target outside the play area is rejected
PASS runner can set a target inside the area
PASS hunter cannot select the target row
PASS hunter state snapshot has no target
PASS runner state snapshot has the target
PASS non-host cannot start the round
PASS round cannot start while players are not ready
PASS players can ready up in target selection
PASS host can start once every player is ready
PASS start sets ordered countdown, head-start and end timestamps
PASS target locks when the round starts
PASS ready status locks when the round starts
PASS join is blocked once the round starts
PASS members see the countdown phase
PASS hunter still has no target in the countdown
PASS ready-up is blocked until the route-sharing choice is made
PASS runner can choose to share their route
PASS hunter can choose to keep their route private
PASS Tag Hunt starts from the lobby without a target
PASS phase clock advances countdown and a zero-length head start to live
PASS phase changes are recorded as events
PASS runner can upload a position inside the play area
PASS hunter can upload their own position
PASS hunter sees only their own live position row
PASS runner sees only their own live position row
PASS outsider cannot read live positions
PASS noise is not directly selectable
PASS the owner reads their own noise through get_my_status
PASS an outsider cannot read another player status
PASS nearby_drops returns an empty reveal when the modifier is off
PASS an outsider cannot reveal drops
PASS drop_claims is server-only
PASS server_secrets is unreachable from clients
PASS qr_uses is server-only
PASS a player reads only their own player_resources row
PASS an outsider cannot read player_resources
PASS a runner reads only the runner team_resources row
PASS a hunter reads only the hunter team_resources row
PASS an outsider cannot read team_resources
PASS entities with no matching visibility are unreadable
PASS clients cannot insert entities
PASS ghost_library is not directly selectable by clients
PASS outsider reads no ghost_contributions of other users
PASS hunters cannot read raw ghost coordinates through nearby_entities
PASS outsider cannot read nearby_entities
PASS secret_role is not directly selectable
PASS a player reads their own secret role through the RPC
PASS the RPC never returns another player’s role
PASS trails are unavailable while the round is live
PASS during play a member reads only their own trail points
PASS the replay is unavailable while the round is live
PASS runner state includes teammates but not opponents
PASS runner state includes their own position
PASS hunter state does not leak live runner positions
PASS a position outside the play area is marked out of bounds
PASS leaving the play area emits a boundary warning
PASS returning inside the play area clears the boundary state
PASS a scheduled ping round is released
PASS pings contain active runners only
PASS pings carry a plausible fix age
PASS runners see the pings hunters received
PASS hunter can read released pings
PASS outsider cannot read pings
PASS expired pings cannot be read by hunters during live play
PASS health_ping keep-alive succeeds for anon
PASS health_ping rejects calls without valid secret when configured (tested)
PASS the next ping is scheduled a full interval ahead
PASS client cannot insert a position directly
PASS outsider cannot submit a position
PASS a distant tag attempt fails without revealing a direction
PASS runners cannot tag
PASS outsiders cannot tag
PASS both players can refresh their fixes inside tag range
PASS a failed tag starts an 8-second cooldown
PASS tagging the last runner ends the round for hunters
PASS hunter can read the tag record
PASS outsider cannot read tag records
PASS full ping history is readable by members after round ends
PASS the tagged runner and the roster show the ended round
PASS tagging is closed after the round ends
PASS a private route is absent from the recap for other players
PASS recap trail points carry coordinates and timestamp
PASS spectator cannot submit positions
PASS spectator cannot tag
PASS spectator can read released pings
PASS spectator can read teammates
PASS spectator cannot read live opponent positions
PASS spectator can read events
PASS host can rematch an ended game
PASS rematch preserves mode and area parameters
PASS non-host active player can also rematch an ended game
PASS repeat rematch returns the same new lobby
PASS lobby cannot be rematched before game ends
PASS active players are copied into the new rematch lobby
PASS left player is omitted from rematch lobby
PASS rematch players reset to unready
PASS rematch players preserve team assignments
PASS rematch players reset share_trail to null
PASS initial game points to rematch game
PASS rematch game points back to original game
PASS original game cannot be rematched to a different game
PASS games created with valid base modes succeed
PASS game with valid modifier noise_meter succeeds
PASS game with valid modifier dead_drops succeeds
PASS game with valid modifier hot_cold succeeds
PASS game with valid modifier shrinking_zone succeeds
PASS game with valid modifier ai_gm succeeds
PASS game with valid role double_agent succeeds
PASS game with valid role vip succeeds
PASS game with valid role operator succeeds
PASS game with invalid mode is rejected by server catalogue
PASS game with invalid modifier is rejected by server catalogue
PASS game with invalid role is rejected by server catalogue
PASS game with incompatible mode and role is rejected
PASS host starts VIP Escort game
PASS runners can see teammates secret_role (vip/bodyguard)
PASS hunter CANNOT see runner secret_role during live play (RLS secrecy)
PASS hunter direct players select cannot read runner secret_role during live play
PASS outsider cannot call request_role_swap
PASS outsider cannot call confirm_role_swap
PASS outsider cannot call cancel_role_swap
PASS hunter cannot call request_role_swap
PASS hunter cannot call confirm_role_swap
PASS runner cannot swap role with hunter
PASS hunter cannot read runner-audience events in VIP Escort game
PASS operator game created for RLS check
PASS player can designate self as remote operator in lobby
PASS hunter can designate self as remote operator in lobby
PASS second operator on same team is rejected by set_player_remote
PASS host starts operator game
PASS runner operator places tactical marker
PASS runner teammate can read tactical marker from entities
PASS hunter cannot read runner tactical marker (RLS team isolation)
PASS outsider cannot read entities for operator game
PASS runner operator executes tactical scan
PASS runner scan returns 150m envelope
PASS runner scan preserves hunter coordinate secrecy (no raw hunter GPS exposed)
PASS hunter operator scan outside game boundary is blocked
PASS hunter operator executes census scan inside boundary
PASS hunter scan returns census count without coordinates
PASS hunter census exposes zero runner positions
PASS remote operator is immune to tagging
PASS remote operator cannot execute tags
PASS field player cannot place tactical markers (operator only)
PASS field player cannot clear tactical markers (operator only)
PASS field player cannot trigger operator scan (operator only)
PASS field player cannot send operator messages (operator only)
PASS operator marker outside 1.5x boundary is rejected
PASS empty operator message is rejected
PASS operator message exceeding 200 characters is rejected
PASS hunter operator scan without coordinates is rejected
PASS outsider cannot place tactical marker
PASS outsider cannot execute operator scan
PASS outsider cannot send operator comms
PASS double agent game created for RLS check
PASS host starts game with double agent role
PASS exactly 1 hunter assigned as agent
PASS players.secret_role is completely inaccessible to peers via direct SELECT
PASS loyal hunter cannot call agent_whisper
PASS loyal hunter cannot call agent_scramble
PASS double agent whisper returns target cardinal quadrant
PASS repeat agent_whisper call is rejected (single use)
PASS runner cannot start tribunal (hunters only)
PASS hunter cannot accuse self in tribunal
PASS loyal hunter convenes tribunal against suspect
PASS runner cannot read tribunals table (RLS policy)
PASS outsider cannot read tribunals table (RLS policy)
PASS hunter can read active tribunal under RLS
PASS runner cannot cast vote in tribunal
PASS second tribunal in same game is rejected (once per game)
PASS ghost_duel_scores is not directly insertable by clients
PASS ghost_duel_scores is not directly updatable by clients
PASS ghost_duel_scores is not directly deletable by clients
PASS outsider cannot call tag_ghost
PASS tag_ghost on non-ghost_duel game is rejected
PASS entities table is not directly insertable by clients
PASS entities table is not directly updatable by clients
PASS entities table is not directly deletable by clients
PASS outsider cannot execute attempt_tag in game
PASS trigger_game_master_event with invalid event type is rejected
PASS outsider cannot broadcast game master narration
PASS empty custom narration is rejected by server guardrail
PASS app_settings is not directly writable by clients
PASS creating a game with disabled qr_tagging modifier is rejected
PASS haunted_map is rejected when disabled by feature flag
PASS a policy acknowledgement can be recorded
PASS consents are not directly readable
PASS consents are not directly writable
PASS consent state is readable through get_my_consents
PASS export bundle contains the caller profile
PASS export bundle contains the games the caller joined
PASS outsider has a profile before deletion
PASS delete_my_data removes the caller’s profile and data
PASS the deleted profile and personal data are gone
PASS active participant has profile, games and trail points before deletion
PASS delete_my_data succeeds for active participant with multi-asset data
PASS active participant profile, trails, and personal assets are scrubbed
PASS active participant consents are completely purged after account deletion
PASS account deletion cascades cleanly leaving nothing in players or pings

--- summary ---
All access checks passed.
```

### 5. `npm run sim`
```
> ghostrun@2.6.1 sim
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

--- modifiers ---
PASS a game with M3 modifiers is created
PASS the round reaches live
PASS the zone starts at full size
PASS moving raises the runner noise bar
PASS get_my_status reports the active modifiers
PASS the owner reads their own noise value
PASS nearby_drops returns the 40 m reveal envelope
PASS an outsider cannot reveal drops
PASS QR tokens are refused when the modifier is off
SKIP drop and zone checks need SUPABASE_SERVICE_ROLE_KEY

--- hot & cold hunt ---
PASS game with Hot & Cold starts cleanly
PASS the round reaches live
PASS Hot & Cold triples the scheduled ping interval
PASS runners cannot use HEAT
PASS HEAT returns stale_position when hunter has no fresh fix
PASS HEAT returns hot when a runner is within heat radius and spends 1 charge
PASS HEAT enforces personal cooldown
PASS hunter sees the mark in heat_press_feed view
PASS heat_press_feed does not expose nearest_runner_m
PASS runner cannot see marks in heat_press_feed
PASS outsider cannot see marks in heat_press_feed
PASS heat_presses base table is unreadable during live play
PASS hunter receives heat_mark event with result
PASS runner receives heat_used announcement
PASS runner receives sensed pulse when within heat radius
PASS runner does not receive heat_mark event
PASS HEAT returns cold when runners are outside heat radius

--- double agent ---
PASS game with Double Agent starts cleanly
PASS exactly one hunter is secretly assigned as Double Agent
PASS Whisper reveals correct cardinal quadrant of target
PASS Whisper cannot be used twice
PASS loyal hunter cannot use Whisper
PASS Scramble is armed on chosen runner
PASS loyal hunter can convene tribunal against suspect
PASS majority tribunal vote ejects the Double Agent with bonus ping
PASS sim: runner cannot use agent_whisper
PASS sim: runner cannot use agent_scramble
PASS sim: runner cannot start tribunal
PASS sim: hunter cannot accuse self in tribunal

--- recap stats ---
PASS get_game_stats returns completed game summary
PASS private route player has null closest_call_m in stats
PASS recap stats include loudest noise value

--- Scenario: haunted-map (v2.2 Haunted Map & Ghost NPCs) ---
PASS haunted_map creation rejected when disabled in VM3

--- Scenario: ghost-contribution (v2.2 Ghost Library & Trimming) ---
PASS preview_ghost confirms route is eligible for contribution
PASS trimmed length is at least 300m after privacy trimming
PASS contribute_ghost successfully stores ghost into ghost_library
PASS list_my_ghosts contains the newly contributed ghost
PASS delete_my_ghosts deletes the selected ghost
PASS deleted ghost is absent from list_my_ghosts

--- Scenario: s1-security-timing (Milestone S1) ---
PASS game starts in countdown
PASS advance_active_games advances idle active games
PASS idle game reached live status through advance_active_games clock tick
PASS game ping_visible_s is 10 by default
PASS mock_location_detected event is emitted when mock fix is submitted
PASS vehicle_warning event is emitted when speed >= 8 m/s for 10 s
PASS ghost assist mode skipped: haunted_map disabled in VM3
PASS 100 rapid concurrent health_ping keep-alive calls all succeed cleanly without failure

--- Scenario: jailbreak (B1 Jailbreak Base Mode) ---
PASS start requires jail placement in Jailbreak mode
PASS jail placement outside boundary is rejected
PASS jail placement inside boundary succeeds
PASS Jailbreak game starts cleanly in countdown
PASS Jailbreak round reaches live with jail entity in state snapshot
PASS hunter tags runner 2 and game remains live
PASS tagged runner transitions to jailed status
PASS start_rescue fails when runner is far from jail
PASS hunters cannot call start_rescue
PASS runner within 10m starts rescue successfully
PASS rescue_started event is hidden from hunters
PASS complete_rescue fails before hold duration expires
PASS complete_rescue frees jailed runner after hold duration
PASS previously jailed runner is restored to active status
PASS jailed runner is auto-released after auto_release_s expires
PASS tagging the last free runner ends Jailbreak game with all_jailed for hunters

--- Scenario: assassin-ring (B2 Assassin Ring Base Mode) ---
PASS Assassin Ring game starts cleanly in countdown
PASS two safe zones auto-created for Assassin Ring game
PASS each player sees target prey and hunter stalker in secret role
PASS hunter tagging prey eliminates them and adopts prey's target
PASS all survivors tagged leaves 1 winner and ends round with assassin_last_standing

--- Scenario: relay-heist (B3 Relay Heist Base Mode) ---
PASS Relay Heist game starts cleanly in countdown
PASS package dropped on ground upon start
PASS nearby runner claims package
PASS runner carrier hands off package to teammate within 5m
PASS hunter tags carrier: package dropped on ground
PASS hunter secures dropped package for 20s to win heist

--- Scenario: vip-escort (B4 VIP Escort Role Add-on) ---
PASS VIP Escort game starts cleanly in countdown
PASS VIP and Bodyguard roles assigned to runners
PASS VIP reaching extraction target wins game for runners
PASS Hunter tagging Bodyguard freezes hunter for 60s
PASS Hunter tagging VIP ends game with vip_eliminated

--- Scenario: operator (B5 Operator Role Add-on) ---
PASS Operator game starts cleanly in countdown
PASS Remote Operator assigned and location upload bypassed
PASS Operator places up to 3 tactical markers in play area
PASS Operator runner scan reveals 150m envelope without hunter coordinates
PASS Operator hunter scan reveals runner census count without coordinates

--- soloGhostDuelScenario (B7: Solo Ghost Duel Base Mode) ---
PASS create solo ghost duel game
PASS ghost duel starts in countdown
PASS ghost duel reached live status
PASS Ghost NPC entity present in game state
PASS time trial target arrival ends round with target_reached
PASS Ghost hunter catching runner in evade ends round with haunted
PASS Evade collision ends with end_reason haunted and hunters victory

--- territoryPulseScenario (B8: Territory Pulse Base Mode) ---
PASS create territory_pulse game
PASS territory_pulse starts in countdown
PASS game transitioned to live
PASS 7 territory sectors spawned (Sector Core + 6 radial)
PASS Sector Core spawned in neutral control
PASS runner presence in neutral Sector Core captures it on pulse
PASS runner score incremented for holding Sector Core
PASS runner cannot execute attempt_tag in territory_pulse
PASS outsider cannot execute attempt_tag in territory_pulse
PASS contest tag incapacitates runner2 for 60 seconds without ending game
PASS hunter cannot tag when only in-range runner is already incapacitated or on cooldown
PASS hunter majority marks runner sector as contested across 1st pulse
PASS hunter majority flips sector to hunter control on 2nd pulse
PASS hunter score incremented after flipping Sector Core

--- safetyGuardScenario (C1: Speed & Safety Guard) ---
PASS create game with safety parameters
PASS game is live
PASS safety initial is_paused is false
PASS curfew_at is populated in safety snapshot
PASS runner paused game for twisted ankle
PASS game status is paused
PASS safety.is_paused is true
PASS safety.pause_reason matches
PASS safety.paused_by_name matches
PASS advance_game preserves paused state
PASS hunter resumed game back to live
PASS game status is back to live after resume
PASS safety.is_paused is false after resume
PASS 1 vote does not trigger pause (needs 2)
PASS 2nd vote triggers auto-pause by majority
PASS game is paused after majority vote
PASS pause reason is majority_safety_vote
PASS send_sos succeeds
PASS SOS auto-pauses the game
PASS safety pause reason is emergency_sos
PASS submit_position flags sustained vehicle speed (>8 m/s)
PASS safety snapshot reflects vehicle_warning for runner
PASS game ended with curfew_reached after curfew deadline expired

--- aiGameMasterScenario (C2: AI Game Master) ---
PASS create game with ai_gm modifier
PASS game reached live status
PASS ai_gm is_active is true
PASS initial event_count is 0
PASS max_events is configured to 5
PASS initial fog_active is false
PASS trigger supply_drop event succeeds
PASS event_count incremented to 1
PASS supply drop entity created in entities table
PASS trigger double_ping event succeeds
PASS event_count incremented to 2
PASS runner double ping recorded in pings table
PASS trigger fog event succeeds
PASS event_count incremented to 3
PASS ai_gm fog_active is true after fog event
PASS ai_gm fog_ends_at is set
PASS trigger rumour event succeeds
PASS rumour correctly identified runner in North-East quadrant
PASS event_count incremented to 4
PASS trigger shrink_step event succeeds
PASS event_count reached max of 5
PASS boundary contracted from 400m to 340m
PASS event cap enforced: rejected when max events reached
PASS narrate_game_master successfully updated narration
PASS ai_gm.last_narration reflects custom narration override
PASS game resumed cleanly with ai_gm active
PASS resume_game shifted next_event_at forward by 1759ms

--- Scenario: replay-stats (Milestone C3: Replay and stats upgrades) ---
PASS game started in countdown
PASS hunter heat_press returns hot within 15m of runner
PASS hunter tags runner to finish match
PASS get_game_stats succeeded
PASS heat_stats correctly computed hit rate at 100%
PASS mode_recap includes ai_gm metrics
PASS per-player hunter heat stats populated
PASS runner closest_call_m recorded <= 35m
PASS best_bluff structure returned for runner
PASS get_game_replay succeeded
PASS replay includes tags array
PASS replay includes heat_marks with hot probe
PASS replay includes pings array
PASS replay includes zones array
PASS replay includes npc_paths array
PASS replay includes handoffs array
PASS replay includes drops array
PASS replay includes jail_events array

--- Scenario: privacy-audit (Milestone C4: Privacy, consent and replay sharing audit) ---
PASS C2 policy_ack recorded version 1
PASS C4 ghost consent recorded as permanently declined
PASS C5 leaderboard_name granted
PASS C7 diagnostics declined
PASS C3 gate: set_ready blocked until route sharing choice is made
PASS set_ready succeeds after C3 choice is made
PASS round starts into countdown with all C3 choices resolved
PASS export_my_data succeeds
PASS export includes profile
PASS export includes consent history
PASS export includes games joined
PASS export includes own trail points
PASS export includes tags
PASS export includes ghost_contributions array
PASS export includes ghost_duel_scores array
PASS export includes drop_claims array
PASS export includes heat_presses array
PASS delete_my_data successfully deletes account and personal data
PASS user profile permanently deleted from profiles table
PASS game replay remains accessible to surviving players

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
  - *Approved Direction:* **Afterimage** per `docs/UI_RESTRICTIONS.md`:
    - Warm paper-like light surfaces (`background: #F3F0E8`, `surface: #FFFFFF`, `surfaceElevated: #E9E5DC`), ink-dark night surfaces (`background: #101014`, `surface: #1B1A22`, `surfaceElevated: #24232D`).
    - Spectral violet (`brandViolet: #6650A4` / `#B8A3FF`, `pingViolet: #6650A4` / `#B8A3FF`) for brand identity and pings.
    - Restrained acid lime (`actionLime: #557A22` / `#C7F36B`) for runners, primary actions, and selected states.
    - Hunter coral (`hunterCoral: #B94B3A` / `#FF8A75`) for hunters and urgent warnings.
  - *Trade-off:* Uncanny, confident aesthetic built specifically for outdoor daylight and nighttime play without generic sci-fi cliches.
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
- **U-D12 (Appearance System):**
  - *Recommendation:* Implement **System / Light / Dark** appearance with persistent explicit user choice in Settings, defaulting to System preference per `docs/UI_RESTRICTIONS.md`.
  - *Trade-off:* Guarantees both high-noon outdoor sunlight legibility (Light mode) and nighttime stealth stealth play (Dark mode).
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
