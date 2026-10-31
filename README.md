# GhostRun

GhostRun is a real-world chase game played on phones.

One team — **Runners** — tries to reach a secret target or survive. The other
team — **Hunters** — tries to catch them. Hunters do **not** see live positions.
They only get **delayed GPS pings** every few minutes, so the game is about
inference, bluffing and tactics, not following a dot.

It is inspired by the classic childhood games (manhunt, cops and robbers, tag)
and the GPS chase genre. It uses original name, art and copy.

![Screens/Vectors/Header/Header app screenshot here](./assets/images/hero.webp)

## What you can do right now

- A group of 3–12 friends installs an Android APK, joins a lobby with a 4-letter
  code, and plays a 30–60 minute outdoor game.
- Setup is fast: from opening the app to being in a lobby, usually under 2
  minutes, with no sign-up form.
- **Secrecy is enforced by the server**, not the client. Hunters cannot read
  runners' live positions or the secret target, even inspecting network traffic.
- Tracking survives the screen being off for a full game on common Android phones.
- Games end cleanly with a recap: winner, trails and target reveal.

## Who it is for

| Persona       | Needs                                                           |
| ------------- | --------------------------------------------------------------- |
| **Host**      | Quick setup, clear settings, start/restart/end the game         |
| **Runner**    | Rules at a glance, map, target and own trail, boundary warnings |
| **Hunter**    | Delayed pings with age, teammates live, quick and fair tagging  |
| **Spectator** | Still watching after being tagged, recap at the end             |

## Game modes (v1)

| Mode              | What happens                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Classic Chase** | Runners choose a secret target. Runners win by reaching it. Hunters win by tagging every runner or running out the clock. |
| **Tag Hunt**      | No target. Runners win by surviving until time runs out. Hunters win by tagging everyone.                                 |

## How information works

This is the heart of the game.

| Information               | Runners                         | Hunters             |
| ------------------------- | ------------------------------- | ------------------- |
| Own live position         | Yes                             | Yes                 |
| Teammates' live positions | Yes                             | Yes                 |
| Opponents' live positions | No                              | No (only pings)     |
| Delayed pings of runners  | Yes (they see what hunters see) | Yes                 |
| Secret target             | Yes (runners only)              | No                  |
| Play area boundary        | Yes                             | Yes                 |
| Full trails and target    | After the game ends             | After the game ends |

## Round structure

1. **Lobby** — everyone joins, host sets rules, teams assigned.
2. **Target selection** (Classic only) — runners pick the secret target inside
   the play area.
3. **Ready and countdown** — everyone ready, then a 10-second countdown.
4. **Head start** — runners move, hunters are locked out and receive no pings.
5. **Live** — hunters unlocked, pings released on a server schedule, tags and
   arrival are active.
6. **Ended** — winner announced, recap and replay available.

## Game parameters and defaults

| Parameter                                 | Default    | Range             |
| ----------------------------------------- | ---------- | ----------------- |
| Players                                   | —          | 2 to 20           |
| Play area radius                          | 600 m      | 100 to 5000 m     |
| Head start                                | 180 s      | 0 to 600 s        |
| Game duration (after head start)          | 45 min     | 5 to 240 min      |
| Ping interval                             | 150 s      | 30 to 900 s       |
| Tag radius                                | 20 m       | 5 to 100 m        |
| Target radius                             | 25 m       | 10 to 100 m       |
| Position upload (foreground / background) | 5 s / 10 s | —                 |
| Failed tag cooldown                       | 8 s        | —                 |
| Boundary grace                            | 30 s       | 10 to 120 s       |
| Boundary penalty                          | Warn only  | Warn / extra ping |

## Fairness rules

- **Tagging:** a hunter presses Tag. The server finds the nearest active runner
  whose position is fresh (under 20 s old) and within the tag radius plus a small
  accuracy allowance. If one exists they are tagged; otherwise the attempt fails
  and starts a cooldown.
- **Stale positions:** if a runner's last position is old, the ping is still
  released but marked with its age so hunters can judge it.
- **Leaving:** a runner who leaves counts as tagged. A hunter who leaves is
  removed. If the host leaves, the game continues and host rights pass on.
- **Fair play:** do not enter private property, cross roads unsafely, or play near
  traffic. The app reminds players and provides an SOS button.

## Tech

- **Mobile:** Expo + React Native + TypeScript + Expo Router, Android only for v1.
  Can be previewed in **Expo Go** with a fallback map placeholder via `src/lib/map.tsx`. A **development build** is required for full MapLibre native rendering and background location tracking.
- **Map:** MapLibre GL, free tile style, no Google API key.
- **Location:** `expo-location` + `expo-task-manager`, foreground service plus
  background updates.
- **Notifications (v1):** local notifications only. Remote push (FCM) is v1.1.
- **State:** Zustand, plus plain `supabase-js` calls.
- **Storage:** AsyncStorage for Supabase session, active game id and a small
  offline queue.
- **Backend:** hosted Supabase — email/password auth, Postgres + PostGIS, Realtime,
  pg_cron.
- **Server logic:** PL/pgSQL RPC functions, atomic, PostGIS-native, no cold starts.
  **No Edge Functions needed in v1.**
- **Build and distribution:** EAS Build, `preview` profile, `buildType: apk`.

## Repository layout

```
ghostrun/
  app/                      # Expo Router screens
  src/                      # lib, state, hooks, components, theme
  supabase/                # migrations, schema, RLS, functions, cron
  scripts/                  # simulator and verification scripts
  docs/                     # PRD.md, TRD.md, FLOW.md, DECISIONS.md
  eas.json  package.json  tsconfig.json  .env.example
```

## Verification scripts

```bash
npm run test:cooldown   # resend cooldown expiry, normalisation, pruning,
                        # corrupt data and write failures, in-memory backend
```

The full RLS secrecy and end-to-end scenarios live in
[scripts/rls-check.ts](scripts/rls-check.ts). `scripts/sim` is a multi-player
Node simulator for testing the whole server logic at a desk.

## Setup

1. Clone and install:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the Supabase values:

   ```bash
   cp .env.example .env
   ```

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   EXPO_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
   ```

   The anon key ships in the app. The service-role key never goes in the client
   or this repo.

3. Link the Supabase project and push the schema:

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```

4. Start the development server:

   ```bash
   npm start
   ```

   A published preview is not part of setup yet; share the USB/debug or EAS build
   to play.

## Building an APK

```bash
npm i -g eas-cli
eas login
eas build -p android --profile preview
```

Share the EAS build link or QR with friends. They open it on Android and allow
"install unknown apps" once.

JS-only changes can ship with EAS Update. Native changes (permissions, plugins)
need a new APK.

## Environment variables

`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and
`EXPO_PUBLIC_MAP_STYLE_URL` are set through EAS environment variables for builds,
not committed. `.env.example` documents the shape.

## Status

- **v1:** Classic Chase and Tag Hunt, lobby, delayed pings, tagging, arrival,
  boundary alerts, recap and replay, Android APK.
- **v1.1:** remote push (FCM), runner proximity warning, polygon areas, freeze-on-tag option.
- **v2:** Checkpoint Run, Infection, power-ups, ghost/NPC hunters, shareable recap video.

## Want to run it with real people

Before game day:

- enable email sign-ins in Supabase Auth and sort out confirmation emails (or
  turn off "Confirm email" during playtesting behind a test project),
- make sure the redirect allowlist includes the app's reset-password deep link,
- open the Supabase dashboard before game day so a free-tier inactivity pause does
  not surprise you,
- pick a public, safe area and share the safety notice with the group.

Play safely: public areas, no traffic, no trespass. If someone needs help, use
the SOS button — it shares the player's last position with everyone.

## License

Copyright © Arshvir. All rights reserved.
