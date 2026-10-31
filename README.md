# GhostRun 🏃‍♂️💨👻

[![GitHub Release](https://img.shields.io/github/v/release/ArshvirSk/GhostRun?color=38BDF8&label=Release)](https://github.com/ArshvirSk/GhostRun/releases)
[![Platform](https://img.shields.io/badge/Platform-Android-34D399.svg)](https://github.com/ArshvirSk/GhostRun/releases)
[![Expo SDK](https://img.shields.io/badge/Expo-v58.0-000000.svg)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.88-61DAFB.svg)](https://reactnative.dev)
[![Supabase](https://img.shields.io/badge/Backend-Supabase%20PostGIS-3ECF8E.svg)](https://supabase.com)
[![MapLibre](https://img.shields.io/badge/Map-MapLibre%20Native-3B82F6.svg)](https://maplibre.org)
[![License](https://img.shields.io/badge/License-Proprietary-F43F5E.svg)](#license)

> **GhostRun is an open-world, real-life tactical GPS stealth chase game played on smartphones.**
>
> A blend of real-world manhunt, cops & robbers, and espionage radar mechanics. One team—the **Runners**—infiltrates the area to reach a secret extraction target or survive the clock. The other team—the **Hunters**—must track, corner, and physically tag them. 
> 
> Unlike typical GPS trackers, **Hunters do not see live runner coordinates**. Instead, the server periodically broadcasts **delayed radar pings**. Gameplay revolves around bluffing, predictive pathing, stealth, and situational awareness—not chasing a moving dot on a screen.

---

## 🎮 Game Modes

### 1. Classic Chase (The Flagship Mode)
* **The Mission:** Runners secretly select a designated extraction target coordinate on the map within the boundary.
* **Runners Win:** At least one runner reaches the secret target undetected within the time limit.
* **Hunters Win:** All runners are tagged, or the match timer expires before runners reach their target.
* **The Dynamic:** Hunters must deduce where runners are heading based only on sparse, delayed radar snapshots.

### 2. Tag Hunt (Pure Survival)
* **The Mission:** No targets, no extraction. Pure adrenaline.
* **Runners Win:** At least one runner survives until the match timer runs out.
* **Hunters Win:** Every runner is located and tagged.

---

## ⚡ The Core Mechanic: Tactical Asymmetric Information

The tension in GhostRun stems from **strict information asymmetry** enforced at the database level:

| Information / View | Runners | Hunters |
| :--- | :---: | :---: |
| **Own Live Position** | ✅ Real-time | ✅ Real-time |
| **Teammates' Live Positions** | ✅ Real-time | ✅ Real-time |
| **Opponent Live Positions** | ❌ Hidden | ❌ Hidden |
| **Periodic Radar Pings** | ✅ Visible (See what hunters see) | ✅ Visible (Tactical radar pulse) |
| **Secret Target Coordinate** | ✅ Visible (Runners only) | ❌ Hidden until match ends |
| **Play Area Boundary** | ✅ Visible with boundary HUD | ✅ Visible with boundary HUD |
| **Full Trajectories & Replay** | 🏁 Available after game ends | 🏁 Available after game ends |

### 📡 10-Second Radar Ping Window & Haptic Feedback
- **Tactical Flash:** When the server releases a delayed runner ping, it appears on the live map as an intense glowing radar pulse.
- **10-Second Lifespan:** Pings remain visible on active radar for **exactly 10 seconds** before dissolving from the live tactical display. Hunters must memorize the snapshot, infer direction and velocity, and communicate.
- **Dual-Pulse Haptic Vibration:** Whenever a ping fires, physical motor vibration alerts trigger on **both** Runners' and Hunters' phones. Runners feel the adrenaline spike knowing their past location was just compromised; Hunters feel the call to check their radar.
- **Zero-Leak Security:** Runner live positions and target coordinates are protected by PostgreSQL Row-Level Security (RLS) policies and atomic PostGIS RPCs. Hunters cannot inspect network payloads or websockets to cheat—the server never sends unauthorized coordinates.

---

## 🌟 Key Features

- **Edge-to-Edge Full-Bleed Onboarding:** Immersive dark-mode visual slides introducing core rules, roles, and safety guidelines.
- **Instant Lobby & Fast Join:** Create games in seconds; players join via a clean 4-letter room code.
- **Auto-Centering GPS Map:** Intelligent coordinate caching and staged native-ready retries ensure map creation centers directly onto the host's actual location.
- **Configurable Match Settings:**
  - Play area radius (100 m to 5,000 m).
  - Head start countdown (0 to 600 s) giving runners time to vanish before hunters are released.
  - Game duration (5 to 240 mins).
  - Radar ping interval (30 to 900 s).
  - Tag proximity radius (5 to 100 m).
- **Background Location Tracking:** Integrated Android Foreground Service (`expo-location` + `expo-task-manager`) maintains continuous GPS uploads even when the phone screen is locked in a runner's pocket.
- **Real-Time Geofence Enforcement:** Audio-visual boundary HUD notifies players when exiting the designated play area with a countdown grace period before penalty pings are triggered.
- **Fair Tagging Engine:** Server validates distance between Hunter and Runner using PostGIS (`ST_DWithin` + accuracy allowance) with an 8-second penalty cooldown on missed tags.
- **Interactive Post-Match Replay:** Scrubbable timeline showing all player routes, tag events, ping timestamps, and the revealed secret target.
- **Emergency SOS Beacon:** Instant safety override that immediately broadcasts an unmasked, high-priority emergency location beacon to all players in the lobby.

---

## 🛠️ Tech Stack & Architecture

```
                                  [ GhostRun App (Expo / React Native) ]
                                          │                     │
                        Background GPS    │                     │  MapLibre Native GL
                        Foreground Task   │                     │  (OpenFreeMap Style)
                                          ▼                     ▼
                               ┌─────────────────────────────────────────┐
                               │       Supabase Hosted Cloud Engine      │
                               │                                         │
                               │  • PostgreSQL 15 + PostGIS              │
                               │  • Realtime WebSockets (Live Lobbies)   │
                               │  • Row-Level Security (Anti-Cheat RLS)   │
                               │  • Atomic PL/pgSQL Stored Procedures    │
                               └─────────────────────────────────────────┘
```

- **Frontend & Framework:** [Expo](https://expo.dev) (SDK 58) / [React Native](https://reactnative.dev) (0.88) with Expo Router.
- **Language:** TypeScript 6 with strict typing.
- **Mapping Engine:** [MapLibre React Native](https://github.com/maplibre/maplibre-react-native) with free vector tile rendering via [OpenFreeMap](https://openfreemap.org) (no proprietary map API keys or fees required).
- **State Management:** [Zustand](https://github.com/pmndrs/zustand) + `@react-native-async-storage/async-storage` for offline queueing and session recovery.
- **Backend Infrastructure:** [Supabase](https://supabase.com) (PostgreSQL 15, PostGIS extension, Realtime broadcast channels).
- **Security:** Strict PostgreSQL Row Level Security (RLS) guaranteeing that confidential runner coordinates never reach client hardware during live rounds.

---

## 📁 Repository Structure

```
GhostRun/
├── android/                    # Native Android Gradle project configuration
├── app/                        # Expo Router application screens & navigation
│   ├── _layout.tsx             # Root navigation stack & theme providers
│   ├── index.tsx               # Entry router / splash redirection
│   ├── auth.tsx                # Email & password authentication
│   ├── onboarding.tsx          # Full-bleed tutorial & role walkthrough
│   ├── home.tsx                # Main menu (Create, Join, Active Games)
│   ├── create.tsx              # Game creation & map boundary configuration
│   ├── lobby/[id].tsx          # Pre-game lobby, team assignment, room code
│   ├── game/[id].tsx           # Active match: tactical radar, tags, geofencing
│   └── result/[id].tsx         # Post-match recap, stats & interactive replay
├── assets/                     # App icons, splash screens, vector illustrations
├── docs/                       # Product (PRD), Architecture (TRD) & System Specs
├── scripts/                    # Test suites, simulation tools & cooldown checkers
├── src/                        # Core application business logic
│   ├── components/             # Reusable UI components & HUD widgets
│   ├── hooks/                  # Custom location, game state & device hooks
│   ├── lib/                    # Supabase client, map abstractions, utilities
│   ├── state/                  # Zustand global game & player stores
│   └── theme/                  # Design tokens, color palette, typography
├── app.json                    # Expo project configuration & Android permissions
└── package.json                # Dependencies, scripts & build tooling
```

---

## 🚀 Getting Started

### 1. Download Pre-Built Android APK
You can install and play GhostRun directly on any modern Android device (Android 8.0+):
- Head over to the [**Latest Releases**](https://github.com/ArshvirSk/GhostRun/releases).
- Download `GhostRun-v1.0.0.apk`.
- Open the `.apk` on your device and tap **Install** (allow "Install from Unknown Sources" if prompted).

---

### 2. Local Development Setup

#### Prerequisites
- Node.js 20+ and npm
- Android Studio & Android SDK (for native Android builds)
- A [Supabase](https://supabase.com) project with PostGIS enabled

#### Installation

```bash
# Clone the repository
git clone https://github.com/ArshvirSk/GhostRun.git
cd GhostRun

# Install dependencies
npm install
```

#### Environment Variables
Create a `.env` file in the project root:

```ini
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
EXPO_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
```

#### Database Setup
Apply migrations and deploy PL/pgSQL functions to your Supabase project:

```bash
# Link your project
npx supabase login
npx supabase link --project-ref <your-project-ref>

# Push migrations & schema
npx supabase db push
```

#### Start Local Dev Server

```bash
# Start Metro bundler with Dev Client
npm start

# Run directly on an attached Android device/emulator
npm run android
```

---

## 🧪 Testing & Verification

GhostRun includes an automated test and verification suite:

```bash
# Run strict TypeScript compiler verification
npm run typecheck

# Run ESLint validation
npm run lint

# Run rate-limit, resend cooldown, and storage pruning tests
npm run test:cooldown
```

---

## 📦 Building Production Release APK

To compile a standalone release APK locally using Gradle:

```bash
# Navigate to the Android project directory
cd android

# Clean and compile release APK
./gradlew clean assembleRelease
```

The compiled release APK will be located at:
`android/app/build/outputs/apk/release/app-release.apk`

Alternatively, build via EAS:
```bash
eas build -p android --profile preview
```

---

## 🛡️ Safety & Fair Play

GhostRun is designed for active outdoor fun, but physical safety always comes first:
1. **Public Spaces Only:** Play in parks, pedestrian zones, campuses, or open fields. Never play in active traffic, construction zones, or restricted areas.
2. **Respect Boundaries:** Never enter private property.
3. **Emergency SOS:** In any dangerous situation, press the **SOS** button in the top HUD. It will immediately reveal your exact location to all players and provide an emergency dial shortcut.

---

## 📄 License

Copyright © Arshvir. All rights reserved.
