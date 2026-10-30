# GhostRun — Product Requirements Document (PRD)

> **Working title:** GhostRun (placeholder, pick your own name before sharing widely).
> **Status:** Draft v1 · **Platform:** Android APK (friends playtest) · **Owner:** Arshvir

---

## 1. Summary

GhostRun is a real-world chase game played on phones. One team (**Runners**) tries to reach a secret destination or survive. The other team (**Hunters**) tries to catch them. Hunters do **not** see live positions. They only receive **delayed GPS pings** of each runner every few minutes, so the game is about inference, bluffing and tactics, not just following a dot.

It is inspired by the classic childhood game (manhunt, cops and robbers, tag) and the "GPS chase game" genre. It uses original name, art and copy, and does not reuse any other product's branding or assets.

## 2. Goals and non-goals

### Goals (v1)
1. A group of 3 to 12 friends can install an APK, join a lobby with a 4-letter code, and play a full 30 to 60 minute game outdoors.
2. The **secrecy rules are enforced by the server**, not the client: hunters can never read runners' live positions or the secret target, even by inspecting network traffic.
3. Tracking keeps working with the screen off for a full game on common Android phones.
4. Setup is fast: from opening the app to being in a lobby takes under 2 minutes, with no sign-up form.
5. Games end cleanly with a satisfying recap (winner, trails, target reveal).

### Non-goals (v1)
- iOS build, Play Store release, payments, social features, accounts and profiles beyond a display name.
- Power-ups, NPC hunters, AI game master, transit mode (see roadmap).
- Anti-cheat beyond basic sanity checks. Players are friends.
- Polygon play areas (v1 uses a circle).

## 3. Users

| Persona | Description | Needs |
|---|---|---|
| **Host** | The friend who organises the game | Quick setup, clear settings, ability to start, restart and end the game |
| **Runner** | Tries to reach the secret target or evade capture | Know the rules at a glance, see the map, target and own trail, get warned near boundaries |
| **Hunter** | Tries to locate and tag runners | See delayed pings with their age, see teammates live, tag quickly and fairly |
| **Eliminated player** | Tagged runner | Keep watching (spectator view) and see the recap |

## 4. Game concept

### 4.1 Play modes
| Mode | v1 | Description |
|---|---|---|
| **Classic Chase** | Yes | Runners choose a secret target. Runners win by reaching it, hunters win by tagging all runners or running out the clock. |
| **Tag Hunt** | Yes | No target. Runners win by surviving until time runs out, hunters win by tagging all runners. |
| Checkpoint Run | v2 | Runners must hit several hidden checkpoints. |
| Infection | v2 | Tagged runners become hunters. |

### 4.2 Information rules (the heart of the game)
| Information | Runners | Hunters |
|---|---|---|
| Own live position | Yes | Yes |
| Teammates' live positions | Yes | Yes |
| Opponents' live positions | **No** | **No** (only pings) |
| Delayed pings of runners | Yes (they see what hunters see) | Yes |
| Secret target | **Yes (runners only)** | **No** |
| Play area boundary | Yes | Yes |
| Full trails and target | After game ends | After game ends |

### 4.3 Round structure
1. **Lobby:** players join, host sets rules, teams assigned.
2. **Target selection** (Classic only): runners pick the secret target inside the play area.
3. **Ready and countdown:** everyone ready, 10 second countdown.
4. **Head start:** runners move, hunters are locked out and receive no pings.
5. **Live:** hunters unlocked, pings released every N seconds, tags and arrival are active.
6. **Ended:** winner announced, recap and replay available.

## 5. Features

Priority: **P0** = required for first playtest, **P1** = needed for a good game, **P2** = nice to have.

### 5.1 Onboarding and identity
| ID | Feature | Pri |
|---|---|---|
| F-01 | Email/password sign-in with a display name and colour | P0 |
| F-02 | Location permission flow: foreground first, then background ("Allow all the time"), with plain explanations | P0 |
| F-03 | Battery-optimisation guidance screen (per major Android brand) | P1 |
| F-04 | Safety and privacy notice shown before first game | P0 |

### 5.2 Lobby
| ID | Feature | Pri |
|---|---|---|
| F-10 | Create game with a map picker for play-area centre and radius | P0 |
| F-11 | 4-letter join code plus shareable link | P0 |
| F-12 | Live lobby list with team badges, ready status, host crown | P0 |
| F-13 | Team assignment: self-pick, host-assign, randomise with N hunters | P0 |
| F-14 | Game settings (see section 6) with sane defaults | P0 |
| F-15 | Host can kick a player and cancel the game | P1 |
| F-16 | "Play again" returns everyone to the same lobby with settings kept | P1 |

### 5.3 Pre-game
| ID | Feature | Pri |
|---|---|---|
| F-20 | Runners choose the secret target on the map (must be inside the area), can change it until start | P0 |
| F-21 | Ready-up per player, host can force start | P0 |
| F-22 | Synchronised countdown driven by server time | P0 |

### 5.4 In-game
| ID | Feature | Pri |
|---|---|---|
| F-30 | Live map: own position, teammates, boundary circle, tag-radius ring, ping markers fading by age ("seen 2m ago") | P0 |
| F-31 | HUD: phase, time remaining, next-ping countdown, runners remaining | P0 |
| F-32 | **Delayed ping release** on a server schedule | P0 |
| F-33 | **Tag** button for hunters, validated by the server (radius, freshness, cooldown) | P0 |
| F-34 | **Arrival detection** for runners at the secret target (server-side) | P0 |
| F-35 | Boundary warnings and optional penalty (an extra ping) | P1 |
| F-36 | Event feed ("Sam was tagged", "Ping released") and local notifications plus vibration | P1 |
| F-37 | SOS / "I need help" button that alerts everyone with the player's last position | P1 |
| F-38 | Spectator view for tagged runners | P1 |
| F-39 | Reconnect handling: app killed or offline, rejoin and resync | P0 |

### 5.5 Post-game
| ID | Feature | Pri |
|---|---|---|
| F-40 | Result screen: winner, reason, key stats (distance, tags, time) | P0 |
| F-41 | Target reveal | P0 |
| F-42 | Trail replay with timeline scrubber | P1 |
| F-43 | Shareable recap image or video | P2 |

## 6. Game parameters and defaults

| Parameter | Default | Range | Notes |
|---|---|---|---|
| Players | n/a | 2 to 20 | v1 tested up to about 12 |
| Play area radius | 600 m | 100 to 5000 m | Circle |
| Head start | 180 s | 0 to 600 s | Hunters locked out |
| Game duration (after head start) | 45 min | 5 to 240 min | |
| Ping interval | 150 s | 30 to 900 s | First ping when hunters unlock |
| Tag radius | 20 m | 5 to 100 m | Plus a small accuracy allowance |
| Target radius | 25 m | 10 to 100 m | Runner must enter it |
| Position upload (foreground / background) | 5 s / 10 s | n/a | Client-side |
| Failed tag cooldown | 8 s | n/a | Stops tag button being used as a radar |
| Boundary grace | 30 s | 10 to 120 s | Before penalty |
| Boundary penalty | Warn only | Warn / extra ping | |
| Tagged runner result | Out (spectate) | Out / Freeze (v2) | |

## 7. Rules in detail

- **Win conditions**
  - Classic: Runners win on target reached. Hunters win when all runners are tagged **or** time expires.
  - Tag Hunt: Hunters win when all runners are tagged. Runners win when time expires with at least one runner untagged.
- **Tagging:** a hunter presses Tag. The server finds the nearest active runner whose position is fresh (under 20 s old) and within the tag radius plus an accuracy allowance (up to 10 m). If one exists they are tagged, otherwise the attempt fails and starts a cooldown.
- **Stale positions:** if a runner's last position is old (phone asleep, no signal), the ping is still released but marked with its age so hunters can judge it.
- **Leaving:** a runner who leaves counts as tagged. A hunter who leaves is removed. If the host leaves, the game continues and host rights pass to the earliest-joined player.
- **Fair play:** do not enter private property, cross roads unsafely, or play near traffic. The app reminds players and provides an SOS button.

## 8. Screens (summary)

Sign in, Welcome and name, Permissions, Home (create / join), Create game, Lobby, Target selection, Pre-game countdown, In-game map (hunter and runner variants), Spectator, Result, Replay, Settings and help. Detailed navigation and states are in `FLOW.md`.

## 9. Safety, privacy, legal

- Location is collected **only** while a game is live and stops when it ends. Players are told this before their first game.
- Raw trails are visible to players only after a game ends, and are auto-deleted after 30 days.
- No minors-specific features are provided, and the app is intended for adults or supervised groups.
- Games must be played in public, safe areas. The app shows this guidance on the create screen and in the first-run notice.
- Use original branding. No assets, names or copy from other apps.

## 10. Success metrics (playtest-based)

| Metric | Target |
|---|---|
| Full 45-minute game with at least 6 players completes without anyone restarting the app | Yes |
| Pings released within 5 s of schedule | 95% or more |
| Background tracking survives screen-off for a full game | Works on at least 3 different phone brands |
| Tag success when a hunter is within 15 m of a runner | 90% or more |
| App open to inside a lobby | Under 2 minutes |
| Battery drain during a game | Under 20% per hour |
| Friends say "let's play again" | At least once |

## 11. Roadmap

| Version | Scope |
|---|---|
| **v1 (this PRD)** | Classic Chase and Tag Hunt, lobby, delayed pings, tagging, arrival, boundary alerts, recap and replay, Android APK |
| v1.1 | Remote push notifications (FCM), runner proximity warning, polygon areas, freeze-on-tag option |
| v2 | Checkpoint Run, Infection, power-ups, ghost or NPC hunters, shareable recap video |
| Later | AI game master, transit-aware mode, community rule sets, iOS, handicap balancing |

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Android kills background tracking | Game breaks mid-round | Foreground service with persistent notification, battery guidance, early field test |
| GPS drift near buildings | Unfair tags or arrivals | Accuracy allowance, ignore low-accuracy fixes (over 50 m) for tags, generous radii |
| Secret info leaks to hunters | Game is pointless | Server-side enforcement with RLS, verified by automated checks |
| Supabase free tier pauses | Game day failure | Open the dashboard before game day, keep a small keep-alive job |
| Players unsafe (traffic, trespass) | Real-world harm | Safety notice, SOS, area guidance |
| Too few players | Boring game | Small-group friendly defaults, ghost hunters planned for v2 |

## 13. Open questions

1. Final name and visual identity.
2. Should runners get a proximity warning ("hunter within 100 m") in v1 or v1.1? Default: v1.1.
3. Should tagged runners be out or frozen? Default: out in v1, freeze in v1.1.
4. Do any friends use iPhones? If yes, an iOS plan is needed (TestFlight requires a paid Apple developer account).
