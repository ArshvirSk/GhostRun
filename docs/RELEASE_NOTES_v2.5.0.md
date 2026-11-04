# GhostRun v2.5.0 — Game Expansion Release 🏃‍♂️💨👻

Welcome to **v2.5.0** of **GhostRun**!

This major release delivers **Phase B Milestones B1 through B5**, adding 3 brand-new base modes and 2 tactical role add-ons. GhostRun now supports jail rescues, circular assassin rings, package heist relays, VIP escort missions with disguise role swaps, and stationary remote tactical operators.

---

## 🚀 What's New in v2.5.0

### 1. 🚨 Jailbreak Base Mode (docs/MODES.md §4.1)
* **Jail Placement:** Host places a designated physical Jail zone inside the play area boundary during lobby setup.
* **Jailed State:** Tagged runners are sent to the Jail zone instead of being permanently eliminated. Jailed runners are muted on hunter radar.
* **Hold-to-Rescue Protocol:** Free runners can infiltrate the Jail and execute a continuous 10-second rescue hold within 10 m to liberate jailed teammates.
* **Stealth Rescue:** The `rescue_started` notification is hidden from hunters, preventing cheap rescue camping.
* **Auto-Release & Evacuation:** Jailed runners auto-release after a configurable duration (default 5 minutes). Jails overrun by the shrinking zone automatically evacuate.
* **Win Condition:** Hunters win by jailing all runners simultaneously (`all_jailed`). Runners win if any runner survives when the match clock expires.

---

### 2. 🎯 Assassin Ring Free-For-All (docs/MODES.md §4.3)
* **Solo Mode (3+ Players):** Free-for-all elimination where every player is both hunter and hunted.
* **Hamiltonian Ring Contract:** Server constructs a single circular assignment cycle ($A \to B \to C \to A$) at round start.
* **Zero-Knowledge Secrecy:** Each player sees only their assigned prey. Their stalker remains completely secret until post-game recap.
* **Directionless Proximity Warnings:** Amber sensory warning when your stalker is $\le 100\text{ m}$; rapid red pulse when stalker is $\le 40\text{ m}$.
* **Safe Zones:** Two 20 m radius safe zones auto-spawn within the boundary. Inside safe zones, tags are blocked and radar pings masked.
* **Dynamic Ring Relinking:** Eliminating your prey transfers their target directly to you ($P_{hunter} \to P_{prey's\_prey}$).
* **Win Condition:** Last surviving assassin standing wins (`last_survivor`), or timeout with most contracts fulfilled.

---

### 3. 📦 Relay Heist Base Mode (docs/MODES.md §4.5)
* **The Package & Extraction Point:** Host places an Extraction Zone on the map. At match start, the server randomly assigns one runner as the initial **Carrier** with the carried package entity (`visible_to = 'runner'`).
* **Carrier Burden:** The package carrier pings at $1.5\times$ normal frequency and cannot use evasion items.
* **Physical Handoffs:** Teammates within 5 m can execute an interactive handoff with a 15-second mutual acceptance confirmation window.
* **Drop & Securing Contests:** Tagging the carrier drops the package at their GPS coordinates. Dropped packages pulse an open beacon every 15 s.
  - **Runner Recovery:** Surviving runners can retrieve the dropped package within 10 m (`pickup_package`).
  - **Hunter Hold-to-Secure:** Hunters can initiate a 20-second continuous hold within 10 m to permanently secure the contraband.
* **Win Conditions:** Runners win if any carrier enters the extraction zone (`extraction_complete`). Hunters win if they complete the 20-second secure hold (`package_secured`) or tag out all runners.

---

### 4. 👔 VIP Escort Role Add-on (docs/MODES.md §5.2)
* **High-Value Target:** Compatible with Classic Chase and Tag Hunt. Among runners, exactly one player is assigned as the **VIP** and remaining runners become **Bodyguards**.
* **Zero-Knowledge Camouflage:** Hunters see all runners as identical; radar pings and positions never distinguish the VIP from bodyguards during live play.
* **Bodyguard Freeze Mechanics:** Tagging a bodyguard freezes them in place for 60 seconds (`already_frozen` immunity prevents double-tagging) rather than eliminating them.
* **Tactical Role Swap:** When the VIP and a bodyguard are within 5 m of each other, either player can initiate a physical role swap (15-second confirmation window, 120-second cooldown) to deceive watching hunters in real life.
* **VIP Elimination:** Tagging the VIP terminates the round immediately for a Hunter victory (`vip_eliminated`).
* **Auto-Promotion Fail-Safe:** If the VIP goes offline or disconnects for $> 60\text{ s}$, an active bodyguard is automatically promoted to VIP (`vip_promoted`).

---

### 5. 🛰️ Operator Remote Tactical Role Add-on (docs/MODES.md §5.3)
* **Remote Tactical Oversight:** An optional non-physical role for Classic Chase, Tag Hunt, Jailbreak, and Relay Heist. One player per squad can participate remotely (e.g., from home, base camp, or stationary bench).
* **GPS Bypass & Immunity:** Remote operators bypass physical GPS tracking, are completely immune to physical tags, and cannot execute tags against field runners.
* **Tactical Markers:** Operators can place up to 3 concurrent tactical waypoints on their squad's map with a 90-second TTL. Opponents receive zero visibility (strict RLS squad isolation).
* **Runner Tactical Sweep:** Runner Operators can trigger a tactical radar sweep (90-second cooldown), revealing a **150 m fuzzed circular envelope** around the nearest active hunter, valid for 10 seconds. Raw enemy GPS coordinates are never leaked to the client.
* **Hunter Sector Census:** Hunter Operators can select any coordinate within the play area boundary to conduct a **200 m sector census**, returning an integer count of active runners detected in that zone without revealing positions or identities.
* **Tactical Radio Comms:** Operators can dispatch short text directives (up to 120 characters) broadcast to squad teammates via the live event stream.

---

## 🛠️ Verification & Test Suite
* **RLS & Security Matrix:** 116+ checks passing (`npm run rls`).
* **Simulator Suite:** 14 scenarios passing 100% (`npm run sim`).
* **TypeScript Compilation:** 0 errors (`npm run typecheck`).
* **ESLint Validation:** 0 warnings / errors (`npm run lint`).
* **Format:** Clean Prettier formatting across entire repository (`npm run format:check`).

---

## 📦 Release Artifact
* **Artifact:** `release/GhostRun-v2.5.0.apk`
* **File Size:** `173,696,984 bytes` (165.65 MB)
* **Version Name:** `2.5.0`
* **Version Code:** `5`
* **Signing Keystore:** `android/app/debug.keystore` (preserves update-in-place compatibility)
* **SHA-256 Checksum:**
  ```text
  B95519BC303B8696EB67E89E106CF4D72D38168D5A97AFC8C94EB7E3C48EA1BB
  ```

