# GhostRun v3.0 Core Feature Strategy & Candidate Dossier

**Document Status:** Draft for Brainstorming & Review  
**Target Milestone:** GhostRun v3.0.0 (Flagship Release)  
**Author:** DeepMind Team & Arshvir  
**Date:** 2026-11-15  

---

## 1. Executive Summary & Milestone Identity

GhostRun has progressed from its early architecture through **v2.9.0**, achieving:
- 360° Obsidian Blackout radar heatmap with empirical units
- 3-tab responsive mission lobby with thumb-swipable tabs and custom tactical modals
- Instantaneous 0ms boot, pre-cached GPS, and zero-canvas QR code rendering
- Complete tactical rules presets (Casual, Standard, Hardcore, Blackout) and movable headstart mini-map

**v3.0.0 is the definitive milestone release.** Rather than introducing bloated administrative menus or non-essential secondary screens, v3.0 focuses strictly on **core, high-thrill physical gameplay, vertical multi-floor stealth, sensory immersion, and shareable post-match virality** that make real-world stealth gaming unforgettable.

---

## 2. Core Candidate Pillars

```
                     ┌───────────────────────────────────┐
                     │     GhostRun v3.0 Flagship        │
                     └─────────────────┬─────────────────┘
                                       │
        ┌──────────────────┬───────────┼───────────┬──────────────────┐
        ▼                  ▼           ▼           ▼                  ▼
┌───────────────┐  ┌───────────────┐ ┌───────────┐ ┌───────────────┐ ┌───────────────┐
│  Pillar 1     │  │  Pillar 2     │ │ Pillar 3  │ │  Pillar 4     │ │  Pillar 5     │
│  Multi-Floor  │  │  Tactical     │ │ Flagship  │ │  Post-Match   │ │  Outdoor      │
│  Indoor 3D    │  │  Audio Engine │ │ Horde     │ │  Telemetry    │ │  Resilience   │
└───────────────┘  └───────────────┘ └───────────┘ └───────────────┘ └───────────────┘
```

---

### Pillar 1: Multi-Floor & Indoor 3D Tactical Stealth (The Z-Axis Revolution)

Moving GhostRun indoors into multi-story environments (university campuses, shopping malls, parking garages, tech office blocks) unlocks a massive new category of stealth gameplay. 

#### 1. Sensor Reality: Z-Axis (Vertical) vs. X/Y-Axis (Horizontal)
Inside steel-reinforced concrete structures, sensor behavior diverges dramatically:

| Sensor / Method | Metric | **Accuracy** (Truth vs. Real World) | **Precision** (Consistency / Jitter) | Verdict for Multi-Floor GhostRun |
|---|---|---|---|---|
| **Barometer (`expo-sensors`)** | **Uncalibrated (Raw)** | ❌ **Poor ($\pm 5\text{m}$ to $20\text{m}$)**<br>Factory bias + weather shifts | ✅ **Ultra-High ($\pm 0.02\text{ hPa} \approx 0.15\text{m}$)**<br>Detects raising phone from waist to eye level | Unusable raw; **gold standard once calibrated**. |
| **Barometer (`expo-sensors`)** | **Lobby-Calibrated ($\Delta P$)** | ✅ **High ($\pm 0.5\text{m}$ to $1.0\text{m}$)**<br>Easily resolves $3.2\text{m} - 3.5\text{m}$ floor stories | ✅ **High ($\pm 0.2\text{m}$ with smoothing)**<br>Rock-solid across 15–45 min matches | **Primary engine for vertical Z-axis floor detection.** |
| **Raw GPS Altitude** | **Vertical (`altitude`)** | ❌ **Terrible ($\pm 15\text{m}$ to $40\text{m}$)**<br>Off by 4 to 10 floors indoors | ❌ **Poor ($\pm 10\text{m}$ jitter)**<br>Jumps up and down while standing still | **Never use for floor detection.** |
| **Fused Location (GPS/Wi-Fi)** | **Horizontal (`lat`/`lng`) Outdoors** | ✅ **High ($\pm 2\text{m}$ to $5\text{m}$)** | ✅ **High ($\pm 1.5\text{m}$)** | Standard park/street GPS tracking. |
| **Fused Location (GPS/Wi-Fi)** | **Horizontal (`lat`/`lng`) Indoors** | ⚠️ **Degraded ($\pm 8\text{m}$ to $35\text{m}$)**<br>Concrete/steel causes multipath reflections | ❌ **Low (Drifts across rooms/walls)**<br>May drift outside building footprint | **Requires algorithmic compensation (see below).** |

> **Architectural Takeaway:** Indoors, your **Z-axis (Floor Level via Barometer) is actually MORE accurate and stable than your X/Y-axis (Map Position via GPS)**! You will know with 95%+ certainty that a Runner is on Floor 3 while a Hunter is on Floor 2, even if horizontal GPS drifts $15\text{m}$ through a wall.

#### 2. The Four Barometer Edge Cases & Engineered Solutions
1. **The "Pocket / Squeeze" Pressure Spike:**
   - *Problem:* Tight jeans or squeezing the waterproof phone casing briefly compresses internal air, spiking pressure by $0.5\text{ to }2.0\text{ hPa}$ (mimicking a sudden 1–3 floor drop).
   - *Engineered Fix:* **3-Second Rolling Median Filter + Exponential Moving Average (EMA)**. Sudden instantaneous spikes are completely rejected; physical stair/elevator climbs are smooth and accurate.
2. **Weather Front Drift Over Long Matches:**
   - *Problem:* An incoming storm drops atmospheric pressure by $\sim 1.0\text{ hPa}$ ($\approx 8\text{m}$ or 2.5 floors) over 45 minutes.
   - *Engineered Fix:* **Live Differential Player Comparison**:
     $$\Delta h_{\text{relative}} = h_{\text{hunter}} - h_{\text{runner}} = \frac{R \cdot T}{g \cdot M} \cdot \ln\left(\frac{P_{\text{runner}}}{P_{\text{hunter}}}\right)$$
     Because ambient weather affects all phones in the building identically, comparing $(H_{\text{Hunter}} - H_{\text{Runner}})$ cancels atmospheric weather drift to **exact zero**!
3. **HVAC Pressurized Stairwells & Fire Doors:**
   - *Problem:* Opening heavy fire doors or passing industrial HVAC vents shifts local pressure by $\pm 0.15\text{ hPa}$ ($\approx 1.2\text{m}$).
   - *Engineered Fix:* **Schmitt Trigger (Floor Hysteresis at 70%)**. To transition from Ground ($G$) to Floor 1 ($1\text{F}$ at $3.3\text{m}$), the player must pass $+2.3\text{m}$ ($70\%$). To transition back down to $G$, they must descend below $+1.0\text{m}$. Eliminates UI flickering on stair landings.
4. **Phone-to-Phone Hardware Offset:**
   - *Problem:* Different phone manufacturers have slight factory calibration variances ($1013.2$ vs $1014.1\text{ hPa}$).
   - *Engineered Fix:* **Pre-Game Ready Check Tare ($P_0$)**. When tapping `READY UP` in the starting lobby, each phone averages 3 seconds of readings and latches $P_0 = 0.0\text{m}$ as its personal Ground Floor baseline.

#### 3. Solving the Indoor Horizontal Drift & Fair Tagging
Because indoor GPS drifts horizontally ($\pm 15\text{m} - 35\text{m}$), relying purely on 2D distance (`ST_DWithin < 10m`) causes false tags through ceilings or misses in hallways.
- **Vertical Floor Gatekeeper:** No tag can ever register unless $|\text{Hunter Floor} - \text{Runner Floor}| == 0$. A hunter directly below a runner on the floor below cannot tag them.
- **Indoor Drift Protection (Auto-Require QR Tagging):**
  - If GPS accuracy is healthy ($<12\text{m}$): Standard proximity tag is allowed.
  - If GPS accuracy is degraded ($>15\text{m}$ indoors): Automatically prompts the Hunter to scan the Runner's optical QR badge (or tap NFC) to register the capture, eliminating disputes.
- **Confidence Halo on Radar Pings:** Indoor pings display a radial halo matching horizontal accuracy with a prominent floor pill: **`FLOOR +2 • ±18m`**.

#### 4. Step 4 Host Wizard: 3D Building Selector UI

![Step 4 Indoor / 3D Area Selector](file:///C:/Users/arshv/.gemini/antigravity/brain/063d1ff8-caa4-4e19-b75f-bae6145a6d68/.user_uploaded/media_1794751129545_dde4fa71.jpg)

- **Segmented Selector:** `Outdoor Radius` vs. `Building / Multi-Floor`.
- **MapLibre 3D Vector Footprint:** Uses OpenStreetMap building polygon vector data with `'fill-extrusion'` to render an isometric 3D glowing wireframe prism of the campus building.
- **Vertical Floor Selector Strip:** Right-side vertical elevator control (`B1`, `G`, `1F`, `2F`, `3F`, `4F`) allowing hosts to customize the playable floor range.
- **Vertical & Indoor Parameters Card:**
  - Floor Range (`B1 to 4F • 6 Levels`)
  - Floor Height Calibration (`3.3m / story` stepper)
  - Barometric Tare Status (`🧭 Barometer Tare (P0): 1013.2 hPa • Calibrated (±0.4m)`)
  - Indoor Drift Protection (`Auto-Require QR Tagging` toggle)

---

### Pillar 2: Sensory Immersion & Tactical Audio Engine ("The Ear HUD")

Currently, GhostRun relies on screen visuals and haptic buzzes. In physical running and outdoor hide-and-seek, constantly looking down at a screen is dangerous and immersion-breaking. Introducing a dedicated **Tactical Audio Engine** allows operatives to run with their phone in a pocket or armband while wearing earbuds.

#### Key Mechanics:
1. **Radar Sonar Ping:** A crisp, submarine-style delayed audio ping whenever a location pulse fires over the network.
2. **Proximity Heartbeat Pulse:**
   - When an opposing operative enters proximity ($<50\text{m}$), a subtle, low-frequency heartbeat begins.
   - At $<25\text{m}$, the heartbeat quickens and intensifies.
   - At $<10\text{m}$ (danger/tag zone), a high-tension auditory/haptic drone triggers.
3. **Vertical Audio Cues (Paired with Pillar 1):**
   - Target on higher floor: higher-pitch sonar harmonic chirp.
   - Target on lower floor: deep sub-bass acoustic pulse.
   - Same floor: urgent rhythmic heartbeat!
4. **Headstart Countdown & Release Sirens:**
   - 90-second runner headstart audio countdown with tactical radio static.
   - High-energy airhorn/siren when hunters are officially released.
5. **Tactical Capture Alarm:** Instant sound effect when a tag is registered or when an operative is eliminated.
6. **AI GM Radio Comms (TTS Narration):**
   - *"Warning: Hunter approaching Sector South."*
   - *"All runners: 3 minutes remaining on extraction window."*

* **Player Impact:** Massive. Transforms the app from a digital map into an immersive sensory stealth radar.
* **Effort:** Low-to-Medium (utilizes `expo-audio`, plays in background with screen off).

---

### Pillar 3: Flagship Game Mode — Outbreak Horde Mode ("Zombies / Infection Swarm")

The single most requested real-world group game mode worldwide, supercharged with **dynamic procedural zones, ticking biological infection decay, and health-as-currency tactical abilities** inspired by urban stealth games like PlayCulture and SCRAM.

#### 1. Core Asymmetric Rules & The Swarm Ratio
- **Starting Ratio:** Starts with 1 designated **Patient Zero (Alpha Zombie/Hunter)** and all remaining players as **Runners (Survivors)**.
- **Conversion on Tag:** When a Runner is tagged (via proximity radius, QR scan, or tap confirmation), they instantly flip to the Zombie swarm with a severe haptic jolt, auditory scream cue, and red HUD transition.
- **Victory Conditions:**
  - **Zombies Win:** If all Survivors are infected or succumb to biological decay before the match clock expires.
  - **Survivors Win:** Any surviving Runner who outlasts the match clock is extracted and crowned **Lone Survivor**.

#### 2. The Ticking Infection Health Pool & Time-As-Currency Engine
- **Infection Timer (Bio-Lifespan):**
  - Every Survivor starts with a ticking biological health pool (default: **300 to 360 HP**, exactly 5 to 6 minutes of life).
  - Health continuously depletes at **-1 HP per second**.
  - If HP reaches 0, the Survivor succumbs to the pathogen and converts into a Zombie automatically.
- **Health as Tactical Currency:**
  - Survivors' health pool doubles as **Bio-Energy** to purchase high-impact tactical survival abilities:
    - **Cloak (Cost: 35 HP / 35s of life):** Completely hides the Survivor from Zombie radar and proximity heatmaps for 20 seconds.
    - **Cloak+ (Cost: 65 HP / 65s of life):** 30 seconds of full radar invisibility plus immunity from proximity infection alerts.
    - **Haste (Cost: 25 HP / 25s of life):** Grants tactical sprint burst indicator and temporarily extends tag evasion grace buffer.
  - *The Core Psychological Dilemma:* Spending precious life seconds to evade a nearby Zombie swarm increases immediate survival odds but drastically accelerates death if no Antidote Healing Zone is reached in time.

#### 3. Dynamic Procedural Zones (Healing Stations & Ability Depots)
Rather than static objectives, the arena features dynamic procedural zones plotted randomly across the play boundary:
- **Antidote / Healing Zones (Green Reticle):**
  - Entering the decontamination geofence immediately injects **+50 to +75 HP** (restoring 50–75 seconds of life and bio-currency).
  - Emits soothing decontamination audio in earbuds and green radial pulse on radar.
- **Ability Drop Pods (Cyan/Amber Reticle):**
  - Tactical supply caches where Survivors can spend Bio-Currency to unlock Cloak, Cloak+, and Haste charges.

#### 4. Procedural Zone Lifecycles & Drifting Physics (Host Configurable)
Hosts can customize how zones behave across the match:
- **Static Timed Nodes:** Spawns at a random safe coordinate, active for $T$ seconds (e.g., 90s) before despawning and relocating elsewhere.
- **Shrinking Nodes:** Starts at a generous radius (e.g., $35\text{m}$) and continuously contracts down to $0\text{m}$, forcing players to hurry before it disappears.
- **Dynamic Drifting Nodes:** Zone centroids actively move and glide across park pathways and street grids at pedestrian walking speeds ($0.5 - 1.2\text{ m/s}$), optionally shrinking as they travel.

#### 5. Zombie Counterplay & Ambush Strategy
- **Antidote Ambush Dynamics:** Because Survivors *must* visit Healing Zones to prevent death, Zombies can strategically patrol, flank, and ambush the perimeter of active Antidote stations.
- **Swarm Radar & Scent Tracking:** As the Zombie swarm expands, their collective radar pings create red directional threat wavefronts, while dying Survivors (<60 HP) begin emitting weak distress pings detectable by nearby Zombies.

* **Player Impact:** Unmatched adrenaline and high-stakes decision-making for groups of 4 to 30+ players.
* **Effort:** Medium-High (extends existing role assignment, timer loops, and dynamic GeoJSON zone layers).
* **Detailed Specification:** See companion document [docs/specs/HORDE_OUTBREAK_MODE_SPEC.md](file:///c:/ASK_Main/ASK/Projects/GhostRun/docs/specs/HORDE_OUTBREAK_MODE_SPEC.md).

---

### Pillar 4: Post-Match Glory & Replay Telemetry

The most viral features in fitness and tactical apps (Strava, Nike Run Club, F1 Telemetry) are post-match shareable recaps.

#### Key Mechanics:
1. **Animated 2D Match Replay Scrub Bar:**
   - An interactive, time-scrubbed map preview in the Match Results screen.
   - Operatives can press **[ Play ]** at $1\times$, $2\times$, or $5\times$ speed to watch all cyan (Runners) and red (Hunters) ghost paths weave and intersect across the park.
   - Highlights the exact timestamp and coordinates where tags occurred.
2. **Shareable Story Card Export:**
   - One-tap 9:16 vertical card generator formatted for Instagram Stories, Snapchat, and WhatsApp Status.
   - Visual elements:
     - Stylized dark map outline of the park and escape route.
     - Operative callsign, match duration, total meters sprinted.
     - Bold badge: *"SURVIVED 14M 22S • EVADED 4 HUNTERS"*.
     - Embedded GhostRun room QR code for friends to download and challenge.
3. **Direct Crew Dispatch:**
   - Bypass room codes: Host can tap **[ Mobilize Crew ]** to send high-priority push notifications to their regular squad.

* **Player Impact:** Drives organic viral growth and deep bragging rights among friends.
* **Effort:** Medium (renders canvas/SVG telemetry curves with privacy start/end radius masking).

---

### Pillar 5: Outdoor Battery & Field Resilience

Real-world playtests reveal two major field vulnerabilities: battery drain and tree-canopy cellular dead spots.

#### Key Mechanics:
1. **Adaptive Battery Guard (Accelerometer Gating):**
   - **Hiding / Stationary:** When accelerometer registers zero movement for $>10\text{s}$, GPS polling drops to low-power background frequency (15–30s interval).
   - **Sprinting:** The moment high acceleration is detected, GPS instantly throttles up to high-frequency 10Hz sampling.
   - **Result:** Extends match battery life by 40%–50% on long outdoor sessions.
2. **Offline Dead-Zone Ping Buffering:**
   - In dense tree cover or urban canyons where cellular connectivity temporarily drops:
     - GPS coordinates, timestamps, and tag attempts are buffered locally in an encrypted memory queue.
     - The moment network connection recovers, the buffer automatically flushes to Supabase with precise backdated timestamps.
     - Prevents dropped games or missing tags due to cellular carrier lag.

* **Player Impact:** Professional-grade stability and zero ruined matches in real parks.
* **Effort:** Low-to-Medium.

---

## 3. Candidate Comparison & Trade-Off Matrix

| Candidate Feature | Core Experience Impact | Dev Effort | Battery / Perf Impact | Viral / Social Value |
|---|:---:|:---:|:---:|:---:|
| **Multi-Floor / Indoor 3D Tactical Stealth** | ⭐⭐⭐⭐⭐ (5/5) | Medium | Light sensor load (Barometer) | ⭐⭐⭐⭐⭐ (5/5) |
| **Tactical Audio Engine & Proximity SFX** | ⭐⭐⭐⭐⭐ (5/5) | Low–Med | Negligible (Audio efficient) | ⭐⭐⭐⭐ (4/5) |
| **Horde Mode (Infection Tag)** | ⭐⭐⭐⭐⭐ (5/5) | Medium | None | ⭐⭐⭐⭐⭐ (5/5) |
| **Animated Replay & Story Card Export** | ⭐⭐⭐⭐ (4/5) | Medium | Client-side export only | ⭐⭐⭐⭐⭐ (5/5) |
| **Adaptive Battery Guard (GPS Gating)** | ⭐⭐⭐⭐ (4/5) | Low–Med | **+40% Battery Life** | ⭐⭐ (2/5) |
| **Direct Crew Push Dispatch** | ⭐⭐⭐ (3/5) | Low | None | ⭐⭐⭐ (3/5) |
| **Dead-Zone Signal Buffering** | ⭐⭐⭐⭐ (4/5) | Low | Resilient sync | ⭐⭐ (2/5) |

---

## 4. Recommended v3.0 Release Packages

### Package A: "The 3D Vertical Milestone" (Recommended Flagship)
> *Focus: Category-defining indoor/outdoor tactical gameplay.*
1. **Multi-Floor & Indoor 3D Tactical Stealth:** Calibrated barometer delta, floor hysteresis, Step 4 3D building prism selector, and QR drift protection.
2. **Tactical Audio & Proximity Heartbeat:** Screen-off earbud stealth with floor-pitch harmonic cues.
3. **Horde Mode (Infection Tag):** Multi-story swarm tag across campus buildings and parks.

---

### Package B: "The Pure Thrill & Replay"
> *Focus: Sensory immersion & post-match virality.*
1. **Tactical Audio Engine**: Sonar chirps, countdown sirens, and escalating proximity heartbeat.
2. **Horde Mode (Infection)**: Dynamic Hunter conversion for massive outdoor group chases.
3. **Animated 2D Telemetry Replay & Story Card Export**: Post-match chase playback and Instagram story export.

---

### Package C: "The Complete v3.0 Universe"
> *The ultimate all-inclusive release.*
1. **Multi-Floor & Indoor 3D Stealth** (Barometer $\Delta P$, 3D building extrusion, floor pills).
2. **Tactical Audio & Proximity Heartbeat Engine** (Screen-off earbud stealth).
3. **Horde Mode (Infection)** (The ultimate party tag mode).
4. **Animated 2D Telemetry Replay & Story Export** (Post-game glory).
5. **Adaptive Battery Guard & Dead-Zone Buffering** (Rock-solid real-world reliability).
