# GhostRun — Release-Candidate Verification Pack (Generic)

> **Document Version:** 1.0.0-rc1  
> **Target Build:** `v2.5.0-rc1` (Android Release APK — Hermes + R8 Minified)  
> **Status:** Pending Physical Execution — Unverified Release Candidate  
> **Official Contact:** `arshvirsk26@gmail.com`

---

> [!IMPORTANT]
> **R8 Minification & Hermes Runtime Notice:**  
> Development builds (`npx expo run:android` in debug mode) bypass ProGuard/R8 dead-code stripping, obfuscation, and Hermes Ahead-Of-Time (AOT) bytecode quirks.  
> Code that runs cleanly in debug mode can fail in a release APK due to:
> - Stripped reflection classes (e.g., Supabase PostgREST JSON model mapping)
> - Native bridge link failures in minified third-party libraries (`@maplibre/maplibre-react-native`, `expo-camera`, `expo-av`, `expo-haptics`)
> - JavaScript bytecode optimization differences under Hermes
> 
> Every test in this pack **must be executed exclusively on a physical Android hardware device running the compiled `app-release.apk`**.

---

# Part 1: Release-Build Physical Smoke Test Checklist

**Tester Instructions:** Install the standalone release candidate APK (`app-release.apk`) on a physical Android phone. Do not use an emulator. Work through each section sequentially and check off each item upon physical confirmation.

### 1. Installation & Cold Launch
- [ ] **Install Cleanliness:** APK installs cleanly over existing install without `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
- [ ] **Splash Screen Transition:** App cold launches to splash screen and transitions cleanly to Auth/Welcome within 3 seconds without white screen freeze or crash.
- [ ] **Hermes Initialization:** Hermes JavaScript engine initializes without missing symbol exceptions (`java.lang.UnsatisfiedLinkError`).

### 2. Authentication Methods & Deep Links
- [ ] **Email & Password Sign-Up:** Create a new test account with email + password. Verification notice renders properly.
- [ ] **Email & Password Sign-In:** Sign out and sign in using the test email and password. Session persists across app kill and relaunch.
- [ ] **Magic Link / OTP Sign-In:** Request magic link / email OTP. Deep link (`ghostrun://auth/callback` or email link) returns user into authenticated session.
- [ ] **Password Reset Deep Link:** Request password reset email. Opening deep link loads password change prompt in app.
- [ ] **Guest Authentication (Anonymous Sign-In):** Tap "Continue as Guest". App creates anonymous session and transitions to Welcome screen without crashing *(Note: Requires anonymous auth enabled in Supabase dashboard)*.
- [ ] **Sign Out:** Tap Sign Out from Home settings. Clears authentication credentials and redirects to Auth screen.

### 3. First-Run Privacy Gate & Age Confirmation
- [ ] **First-Run Modal Trigger:** Fresh install or version bump (`PRIVACY_VERSION = 2`) triggers the blocking Privacy Gate modal.
- [ ] **Age Confirmation Text:** Checkbox displays the exact approved text:  
  `"I have read this and I am 18 or older, or supervised by a guardian."`
- [ ] **Enforced Check:** "Continue" / "Accept" button remains disabled until the age confirmation checkbox is checked.
- [ ] **Consent Toggles:** Toggles for Diagnostics (C1) and Audio/Haptic (C2) can be toggled independently and save to `consents` table on the server.
- [ ] **Consent Persistence:** Relaunching the app does not re-prompt the Privacy Gate once accepted for version 2.

### 4. Profile & Welcome Setup
- [ ] **Display Name Entry:** Input display name; emoji and special characters handled without crashing.
- [ ] **Player Color Selection:** Select custom avatar color; swatch updates immediately.
- [ ] **Profile Upsert:** Completing welcome writes to `public.profiles` and redirects to Home screen.

### 5. Lobby Creation & Join Flow
- [ ] **Game Creation:** Tap "Host Game". Server returns a valid 4-character join code conforming to `[A-HJ-NP-Z2-9]{4}` (excluding ambiguous chars `0`, `O`, `1`, `I`).
- [ ] **Join via Code (Phone 2):** Second physical phone joins lobby using the 4-character code. Host and player roster syncs via Realtime within 1 second.
- [ ] **Team Selection:** Both players switch teams between Runner and Hunter. Sides update accurately on both screens.
- [ ] **Route Sharing Consent Gate (C3):** Tapping "Ready" prompts Route Sharing modal (`Share Route with Teammates` vs `Keep Private`). Ready state is blocked until selection is made.
- [ ] **Host Start Gate:** Host "Start Round" button activates only after all lobby members are ready and mode prerequisites are satisfied.

### 6. Background Location & Screen-Off Soak Test (20 Minutes)
- [ ] **Runtime Permission Dialog:** Android system location dialog prompts for "While using the app" followed by background upgrade prompt for "Allow all the time".
- [ ] **Foreground Service Sticky Notification:** Notification drawer renders a permanent foreground service notification ("GhostRun Active — Sharing match location") with running timer.
- [ ] **20-Minute Screen-Off Test:**
  - Phone is placed in pocket with screen locked and display off for **20 continuous minutes** while walking outdoors.
  - Phone does not get killed by Android Doze or OEM background task killer.
  - Server confirms continuous location fixes logged in `player_positions` and `trail_points` every 5–10 seconds.
- [ ] **Screen Wake & Re-sync:** Unlocking phone after 20 minutes immediately shows current map position without UI freeze, crash, or socket disconnect.

### 7. Vector Map Rendering & Offline Caching
- [ ] **MapLibre Engine Load:** Map canvas initializes without crashing or throwing GL surface texture errors.
- [ ] **Vector Tile Styling:** Map tiles render from OpenFreeMap Liberty style (`https://tiles.openfreemap.org/styles/liberty`) showing roads, paths, water, and building footprints.
- [ ] **Map HUD Elements:**
  - Play boundary circle rendered at accurate radius (e.g. 500m).
  - Secret target boundary rendered for runners (and hidden from hunters).
  - Hunter tag-radius ring rendered around hunter icon.
  - Radar ping ripple rings animate smoothly upon ping release.
- [ ] **Map Pan/Pinch/Rotate:** 60 FPS gesture responsiveness with zero touch stutter or tile flashing.

### 8. QR Scanner Camera Permission & Scan
- [ ] **Camera Runtime Permission:** Opening QR Scanner prompts Android camera permission dialog.
- [ ] **Camera Preview Rendering:** Camera preview displays without upside-down orientation or aspect ratio distortion.
- [ ] **Dead-Drop Token Scan:** Scan a printed or screen-displayed Dead Drop QR code token.
- [ ] **Scan Processing:** Decode triggers immediate audio/haptic chirp and completes claim via `claim_drop` RPC without app crash.

### 9. Audio Engine & Haptics
- [ ] **Audio Initialization:** Audio subsystem (`expo-av`) plays in both silent mode and normal ring mode without crashing.
- [ ] **Sound FX Triggers:**
  - Radar ping release plays sonar pulse sound.
  - Countdown timer plays countdown ticks and live start klaxon.
  - Tag event plays tag capture audio.
  - Boundary breach warning plays distinct alarm sound.
- [ ] **Haptic Feedback Patterns:** Heavy impact haptic triggers on tag; double notch haptic triggers on radar ping arrival.

### 10. In-Game Notifications & Boundary Alarms
- [ ] **Heads-Up Notifications:** Background radar pings trigger high-priority heads-up banner on hunter phone.
- [ ] **Boundary Warning:** Walking outside the designated play radius emits immediate visual red banner, audio warning, and persistent vibration alarm.
- [ ] **Boundary Recovery:** Re-entering the play area clears the boundary warning state cleanly.

### 11. SOS Emergency Override
- [ ] **SOS Button Accessibility:** Persistent red SOS emergency button is visible on the HUD at all times during active gameplay.
- [ ] **SOS Activation:** Pressing and confirming SOS immediately overrides all stealth rules and broadcasts caller's exact GPS coordinates to all players in the match.
- [ ] **SOS Cancellation:** Tapping "Cancel SOS" restores normal gameplay state and emits cancellation event.

### 12. Ghost NPC Route Contribution & Preview (C4)
- [ ] **Post-Match Prompt:** Completing a match renders the Ghost Contribution prompt (if route $\ge 600\text{ m}$).
- [ ] **Privacy Trimming Preview:** Interactive preview map displays the route with exactly 150 meters trimmed from start and 150 meters trimmed from end.
- [ ] **Ghost Library Contribution:** Tapping "Contribute to Library" inserts sanitized route into `public.ghost_library`.
- [ ] **Permanent Decline:** Tapping "Never ask again" sets `ghost` consent to `false` and permanently suppresses future prompts.

### 13. Data Export & Self-Service Account Deletion
- [ ] **Export My Data:** Navigate to Settings → Privacy → "Export My Data". App generates and downloads valid JSON archive containing user profile, games, trail points, tags, and consent history.
- [ ] **Account Deletion Modal:** Tapping "Delete Account" displays double-confirmation warning explaining permanent data loss.
- [ ] **Cascade Deletion Execution:** Confirming deletion calls `delete_my_data()`, completely scrubs user profile and personal assets from database, signs user out, and returns to Welcome screen.

---

# Part 2: Generic Field-Test Protocol & Log Sheet (6+ Players)

### Session Metadata
- **Date & Scheduled Time:** `____________________`
- **Location / Venue:** `____________________` *(Public park, open campus, or sports field; no active vehicular roads)*
- **Weather / Temperature:** `____________________`
- **Session Coordinator:** `____________________`

### 1. Roster & Hardware Inventory (6+ Human Players)

| # | Player Call-Sign | Physical Phone Model | Android OS Version | Battery % (Start) | Battery % (End) | Net Battery Drain |
|---|---|---|---|---|---|---|
| 1 | Host / Runner 1 | | | | | |
| 2 | Runner 2 | | | | | |
| 3 | Runner 3 | | | | | |
| 4 | Hunter 1 (Lead) | | | | | |
| 5 | Hunter 2 | | | | | |
| 6 | Hunter 3 | | | | | |
| 7 | *(Optional)* | | | | | |
| 8 | *(Optional)* | | | | | |

---

### 2. Match Execution Log

| Match # | Mode | Duration (min) | Start Time | End Time | Winner | End Reason |
|---|---|---|---|---|---|---|
| 1 | Classic Chase | 15:00 | | | | |
| 2 | Tag Hunt | 10:00 | | | | |
| 3 | Rematch | 10:00 | | | | |

---

### 3. Empirical Gameplay & Telemetry Observations

#### A. GPS Drift & Accuracy
- **Open Sky Accuracy:** `±____ meters`
- **Tree Canopy / Structure Accuracy:** `±____ meters`
- **Stationary Jitter:** `____ meters` while standing completely motionless for 60 seconds.
- **Out of Bounds False Positives:** Did GPS drift trigger boundary warnings while players were legally inside the boundary? `[ ] Yes  [ ] No`  
  *Details:* `____________________________________________________________________`

#### B. Radar Ping Timing & Clocks
- **Configured Ping Interval:** `____ seconds`
- **Observed Ping Arrival Cadence:** `____ seconds`
- **Observed Ping Latency (Server timestamp vs Phone display):** `____ seconds`
- **Did any runner pings fail to release on schedule?** `[ ] Yes  [ ] No`  
  *Details:* `____________________________________________________________________`

#### C. Tag Mechanics & Range
- **Configured Tag Radius:** `20 meters`
- **Total Tag Attempts Recorded:** `____`
- **Successful Tags:** `____`
- **Failed Tags (Outside Range):** `____`
- **Cooldown Enforced Properly (8-second freeze after failed tag)?** `[ ] Yes  [ ] No`
- **Were any tags awarded unfairly across obstacles (e.g. walls/fences)?** `[ ] Yes  [ ] No`

#### D. Safety Incidents & Hazard Log
- **Were there any close encounters with traffic, bikes, or pedestrians?** `[ ] Yes  [ ] No`
- **Did any player stumble, trip, or experience a physical hazard?** `[ ] Yes  [ ] No`
- **Was the SOS button activated during the session?** `[ ] Yes  [ ] No`  
  *If yes, reason & resolution:* `________________________________________________`

---

### 4. Defects, Glitches & Screenshot Log

| Defect # | Phone Model | Screen / Mode | Observed Behavior & Severity | Screenshot / Log Reference |
|---|---|---|---|---|
| BUG-01 | | | | |
| BUG-02 | | | | |
| BUG-03 | | | | |
| BUG-04 | | | | |

---

### 5. Sign-Off & Verification Block

> [!CAUTION]
> This section must be filled out in handwriting or signed digitally by the Project Owner. No automated script or agent may complete this section.

- **Total Human Participants:** `____`
- **Total Matches Played:** `____`
- **Critical Blocker Bugs Found:** `____`
- **Recommendation:** `[ ] Proceed to Release  [ ] Block Release for Fixes`
- **Project Owner Signature:** `________________________________________`
- **Sign-Off Date:** `____________________`

---

# Part 3: Known Limitations & Field Notes for Testers

This section provides essential operational guidance for field testers. These behaviors are known architectural trade-offs in GhostRun and should not be filed as new defects unless behavior deviates from the descriptions below.

### 1. Guest Authentication & Session Persistence
- **Limitation:** Guest accounts use anonymous authentication tokens stored in the phone's encrypted private local storage.
- **Tester Impact:** If a tester uninstalls the app or uses Android System Settings to "Clear Data / Storage", the anonymous session token is permanently destroyed.
- **Recovery:** There is no email or password linked to a guest account; the profile and match history cannot be recovered after storage wipe. Testers who want persistent match history should register with email and password.

### 2. Live Ping Window vs. Full Post-End History
- **Limitation:** In live gameplay, hunters only see pings released within the last 10 seconds (`ping_visible_s = 10`). Pings older than 10 seconds disappear from the live radar.
- **Tester Impact:** Testers may notice runner ping markers vanishing after 10 seconds. This is by design to force hunters to infer runner movement vectors rather than tracking a continuous breadcrumb trail.
- **Post-Game Reveal:** Once the round ends (`status = 'ended'`), Postgres lifts the live RLS filter; all pings from the entire match are restored and visible on the Recap and Replay screens.

### 3. Server Game Clock Cadence & Idle Delay
- **Limitation:** Background game progression relies on `pg_cron` executing `advance_active_games(10)` on a **30-second recurring cadence**.
- **Tester Impact:** Active players polling `get_game_state` or uploading fixes via `submit_position` advance their own match immediately in real time. However, if all players minimize their phones or an idle game reaches countdown/duration expiry with zero incoming network traffic, the phase transition may take up to **30 seconds** until the next `pg_cron` tick fires.

### 4. OEM Aggressive Battery Management
- **Limitation:** Certain Android hardware manufacturers (notably Samsung OneUI, Xiaomi MIUI/HyperOS, Huawei EMUI, and OnePlus OxygenOS) aggressively kill background processes and pause network sockets after 5–10 minutes of screen-off time, regardless of foreground service status.
- **Tester Workaround:** Before starting an outdoor test run, testers on these devices must navigate to:  
  `Android Settings → Apps → GhostRun → Battery → Select "Unrestricted"` (or disable "Battery Optimization").

### 5. OpenFreeMap Tile Loading Latency
- **Limitation:** GhostRun utilizes OpenFreeMap Liberty vector tiles (`https://tiles.openfreemap.org/styles/liberty`), a community-hosted tile service without commercial SLA backing.
- **Tester Impact:** On cellular connections with weak coverage, initial map tile downloads may show a brief 1–3 second grid before rendering vector features. Map tiles are cached locally in device storage after initial viewing.

### 6. Reverse GPS Inaccuracy in Dense Urban Canyons
- **Limitation:** Smartphone GPS accuracy degrades from $\sim 3\text{ m}$ under open sky to $\sim 20\text{–}35\text{ m}$ in narrow urban alleys or adjacent to multi-story concrete structures.
- **Tester Impact:** GhostRun automatically filters out fixes with accuracy worse than $30\text{ m}$ for ghost tagging and proximity calculations to prevent unfair tags. Testers should select outdoor play areas with unobstructed sky view (parks, recreation fields, open plazas).
