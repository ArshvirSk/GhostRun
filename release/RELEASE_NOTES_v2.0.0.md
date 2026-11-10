# GhostRun v2.0.0 — Tactical Radar, Modifiers, Hot & Cold Hunt, and Double Agent 🏃‍♂️💨👻

Welcome to the major **v2.0.0** release of **GhostRun**!

GhostRun turns your neighborhood, campus, or park into an outdoor tactical stealth arena with full server-side information asymmetry. The v2.0 release introduces a comprehensive extensible mode framework, physical match modifiers, the directionless Hot & Cold Hunt mode, the high-stakes Double Agent undercover role with emergency tribunals, and complete C1–C6 consent and privacy controls.

---

## 🚀 What's New in v2.0.0

### 🕹️ New Game Mode: Hot & Cold Hunt (Directionless Proximity Radar)
* **No Coordinate Snaps:** Hunter radar trades delayed coordinate pings for categorical distance pulses.
* **Proximity Pulse Engine:** Hunters activate their tactical pulse device (5 charges, 2-second cooldown) to sense runners within the boundary:
  - **HOT:** Nearest runner $\le 75\text{ m}$.
  - **WARM:** Nearest runner $75\text{ m} < d \le 175\text{ m}$.
  - **COLD:** Nearest runner $> 175\text{ m}$ or no runners in area.
* **Counter-Detection Alert:** Runners inside the $175\text{ m}$ radius receive a physical vibration and `sensed` event pulse, warning them that hunters are closing in without revealing exact positions.

---

### 🎛️ Match Modifiers (Stackable Match Rules)

Hosts can now toggle and stack one or more active modifiers:

1. **Noise Meter:**
   - Real-time velocity and movement tracking. Sprinting or erratic movement raises the player's acoustic noise bar.
   - Crossing 60 loudness emits a `noise_spark` alert to hunters.
   - Reaching 100 triggers an emergency acoustic radar ping revealing current coordinates.
   - Stationary camping (>4 minutes in a 15 m radius) triggers a camping radar ping.
2. **Dead Drops:**
   - Secret physical caches materialize dynamically across the play area.
   - Approaching within 40 m reveals the drop on radar; holding position inside 15 m for 4 seconds unlocks the cache for the team.
   - Grants tactical utilities: **Veil** (cloaks the next radar ping), **Decoy** (broadcasts a false ping coordinate), and **Recon** (instant directional scan).
3. **QR Tagging:**
   - Cryptographic backup physical tag verification using rotating HMAC-SHA256 tokens (20-second TTL), preventing GPS drift disputes in dense urban foliage or campus corridors.
4. **Shrinking Zone:**
   - In the final third of the round, the play boundary contracts inward across timed stages (100% → 70% → 45%), concentrating surviving runners and hunters into an intense endgame bottleneck.

---

### 🕵️ Secret Roles: Double Agent & Emergency Tribunal

* **The Mole:** In Classic Chase games with $\ge 2$ hunters, one hunter can be secretly designated as the **Double Agent**.
* **Undercover Powers:**
  - **Whisper (Once per match):** Unlocks the cardinal quadrant (`North`, `South`, `East`, `West`) of the runners' extraction target.
  - **Scramble (2-minute cooldown):** Displaces a chosen runner's next scheduled ping by 150–250 m within boundary limits.
* **Emergency Tribunal:**
  - Any loyal hunter can convene an emergency tribunal and accuse a suspect.
  - Hunters vote guilty or innocent within 30 seconds.
  - Majority guilty ejects the agent and awards hunters a bonus ping round.
  - Erroneous ejection of a loyal hunter imposes a 5-minute silence penalty.

---

### 🔒 Privacy, Consent & Retention Architecture (GDPR / Least-Privilege by Design)

* **C1–C6 Granular Consent Framework:** Explicit opt-in tracking for location, policy acknowledgment, ghost replays, leaderboard display names, diagnostics, and spectator feeds.
* **Replay Route Sharing Choice (Consent C3):** Every player explicitly chooses whether to share their replay breadcrumb trail (`Share Route` or `Keep Private`) before readying up in the lobby.
* **Consent-Gated Recap Stats:** Match highlights (Closest Call, Longest Unseen Streak, Loudest Moment, Heat Hit Rate, and Drops Claimed) strictly respect C3 choices—players with private routes have closest call distances redacted.
* **Self-Service Privacy Management:** Settings → Privacy features one-tap **Export My Data** and permanent **Delete My Account** (`delete_my_data()`).
* **30-Day Auto Retention:** Automated database cleanup procedures prune past game trails, pings, tags, and event logs older than 30 days.

---

### 📊 Match Highlights & Interactive Replay
* Post-game summary cards celebrate standout plays: Closest Call distance, Longest Unseen evasion streak, Loudest Moment noise peak, Heat Hit Rate accuracy, and Dead Drops claimed.
* Post-match Double Agent reveal identifies the operative and the outcome of tribunals.
* Interactive scrubbable replay timeline with 1× and 10× playback speeds.

---

## 📦 Download & Installation

1. Download **`GhostRun-v2.0.0.apk`** from the Assets below.
2. Open the downloaded `.apk` file on your Android device (Android 8.0+ supported).
3. If prompted, allow **"Install from unknown sources"** in your browser or file manager.
4. Launch **GhostRun**, acknowledge the privacy gate, and jump into a match!

---

## 🛠️ Verification & Quality Assurance

* 100% automated test coverage across strict TypeScript compilation and ESLint.
* End-to-end multi-agent game simulation passing all modes and modifiers (`npm run sim`).
* Complete anti-cheat and secrecy matrix verification verifying zero network leakage (`npm run rls`).
