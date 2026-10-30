# GhostRun — User and System Flows

> Companion to `PRD.md` and `TRD.md`. Diagrams use Mermaid (render in GitHub, VS Code with a Mermaid extension, or Obsidian).

---

## 1. App navigation map

```mermaid
flowchart TD
  A[Launch] --> B{Session exists?}
  B -- No --> AUTH[Auth: email + password]
  AUTH --> C[Welcome: display name + colour]
  B -- Yes, no profile --> C
  C --> D[Save profile]
  B -- Yes, profile --> E{Active game in progress?}
  D --> F[Permissions + safety notice]
  F --> G[Home]
  E -- Yes --> R[Resume: sync state, route to game or lobby]
  E -- No --> G
  G --> H[Create game]
  G --> I[Join by code]
  H --> L[Lobby]
  I --> L
  L --> M{Mode}
  M -- Classic --> T[Target selection - runners]
  M -- Tag Hunt --> P[Ready-up]
  T --> P
  P --> Q[Countdown 10s]
  Q --> S[Head start]
  S --> U[Live game]
  U --> V[Result]
  V --> W[Replay]
  V --> X[Play again -> Lobby]
  V --> G
  G --> Y[Help / Settings]
  R --> L
  R --> U
```

**Account recovery:** the auth screen can send a password-reset link with `resetPasswordForEmail`, or resend the confirmation email with `auth.resend({ type: 'signup' })` when an account is still unconfirmed. The reset link returns to `reset-password`, which reads the session tokens through `src/lib/authLink.ts`, sets the session and calls `updateUser({ password })`. The project's redirect allowlist must include `ghost-run://reset-password` (or the Expo development URL) for the link to return to the app.

## 2. First-run and permissions flow

```mermaid
flowchart TD
  A[Welcome] --> B[Enter name + pick colour]
  B --> C[Safety and privacy notice]
  C --> D[Request foreground location]
  D -- Granted --> E[Explain why background is needed]
  D -- Denied --> D2[Blocking screen: open settings / retry]
  E --> F[Request background location: Allow all the time]
  F -- Granted --> G[Request notifications]
  F -- Denied --> F2[Warn: tracking may stop with screen off. Allow to continue with warning]
  G --> H[Battery optimisation guidance by brand]
  H --> I[Home]
  F2 --> G
  D2 --> D
```

## 3. Game lifecycle (server state machine)

```mermaid
stateDiagram-v2
  [*] --> lobby: create_game
  lobby --> target_selection: begin_target_selection (Classic)
  lobby --> countdown: start_game (Tag Hunt, all ready)
  target_selection --> countdown: start_game (target set, all ready)
  countdown --> head_start: now >= head_start_at
  head_start --> live: now >= live_at
  live --> ended: target reached
  live --> ended: all runners tagged
  live --> ended: now >= ends_at
  lobby --> cancelled: host cancels
  target_selection --> cancelled: host cancels
  ended --> lobby: play again (new game, same players)
  ended --> [*]
  cancelled --> [*]
```

## 4. Player state machine

```mermaid
stateDiagram-v2
  [*] --> active: join_game
  active --> tagged: runner tagged by hunter
  active --> left: leave / kicked
  tagged --> spectating: (UI state) spectator view
  tagged --> left: leave
  left --> [*]
```
A runner who leaves mid-game is treated as tagged. A hunter who leaves is removed from play.

## 5. Lobby flow

```mermaid
sequenceDiagram
  actor Host
  actor P as Player
  participant App
  participant DB as Supabase (RPC + Realtime)

  Host->>App: Create game (pick area, mode, settings)
  App->>DB: create_game()
  DB-->>App: game + 4-letter code
  Host->>P: Share code or link
  P->>App: Enter code
  App->>DB: join_game(code)
  DB-->>App: game_id
  DB-->>Host: realtime: player_joined
  Host->>App: Randomise teams / assign
  App->>DB: randomize_teams() / set_team()
  DB-->>P: realtime: team assigned
  Host->>App: Lock teams
  App->>DB: begin_target_selection()
```

## 6. Pre-game: target selection, ready, countdown

```mermaid
sequenceDiagram
  actor R as Runner
  actor H as Hunter
  actor Host
  participant DB as Supabase

  R->>DB: set_target(lat, lng)  (inside area?)
  DB-->>R: ok (runner-only event target_set)
  Note over H,DB: Hunters never receive the target (RLS)
  R->>DB: set_ready(true)
  H->>DB: set_ready(true)
  Host->>DB: start_game()
  DB-->>R: status = countdown (head_start_at = now+10s)
  DB-->>H: status = countdown
  Note over R,H: Both show the same server-time countdown
  DB-->>R: head_start (runners move)
  DB-->>H: head_start (hunters locked: map greyed, "Hunters unlock in 02:41")
  DB-->>R: live (at live_at)
  DB-->>H: live (hunters unlocked, first ping arrives)
```

## 7. Location upload and ping release (core loop)

```mermaid
sequenceDiagram
  participant RP as Runner phone
  participant DB as Supabase
  participant HP as Hunter phone

  loop every 5-10 s (foreground service)
    RP->>DB: submit_position(lat,lng,acc,...)
    DB->>DB: advance_game(), upsert position, trail + boundary warning
    DB-->>RP: {phase, server_time, next_ping_at, in_bounds, winner}
  end

  opt next_ping_at has passed (any member read; the live screen reads at the boundary)
    HP->>DB: get_game_state()
    DB->>DB: copy active runner positions into pings (with age)
    DB-->>HP: snapshot with the new pings
    DB-->>RP: realtime: ping_released (runners see what hunters learn)
    HP->>HP: render marker "seen just now", fades with age
  end
```

## 8. Tag flow

```mermaid
sequenceDiagram
  actor H as Hunter
  participant App
  participant DB as Supabase
  actor R as Runner

  H->>App: Press TAG
  App->>DB: attempt_tag(game_id)
  DB->>DB: cooldown ok? positions fresh (<20s)?
  DB->>DB: nearest active runner within tag radius + accuracy allowance?
  alt runner found
    DB->>DB: insert tag, runner.status = tagged
    DB-->>App: {success:true}
    DB-->>R: realtime: you were tagged -> spectator view
    DB-->>H: event runner_tagged (all players)
    opt no runners left
      DB->>DB: end_game(hunters, all_tagged)
    end
  else nobody in range
    DB-->>App: {success:false, reason} (no distance or direction)
    App->>H: "Nobody in range" + 8 s cooldown
  end
```

## 9. Arrival (Classic mode) and game end

```mermaid
sequenceDiagram
  actor R as Runner
  participant DB as Supabase
  participant All as All players

  R->>DB: submit_position()
  DB->>DB: within target radius of secret target?
  alt yes
    DB->>DB: end_game(runners, target_reached)
    DB-->>All: realtime: game_ended + winner
    All->>All: stop location tracking, route to Result
  else no
    DB-->>R: normal response
  end
  Note over DB: Time expiry is handled by advance_game(): Classic = hunters win, Tag Hunt = runners win
```

## 10. In-game screen states

| Role / phase | Map shows | Controls | HUD |
|---|---|---|---|
| Runner, head start | Area, self, teammates, target and radius, own trail | SOS | "Head start 02:10" |
| Runner, live | Same plus ping markers (what hunters know) | SOS | Time left, next ping in, hunters unlocked |
| Hunter, head start | Area, self, teammates (map greyed) | SOS | "Unlocking in 02:10" |
| Hunter, live | Area, self, teammates, ping markers with age, tag ring | **TAG**, SOS | Time left, next ping in, runners remaining |
| Tagged runner | Teammates only (spectator) | Leave | "You were tagged" |
| Any, boundary breach | Red edge, banner "Return to area (0:25)" | none | Countdown to penalty |
| Any, connection lost | Banner "Reconnecting..." and last known state | none | Auto-resync via `get_game_state` |

## 11. Boundary flow

```mermaid
flowchart TD
  A[submit_position] --> B{Outside radius?}
  B -- No --> C[Clear out_of_bounds_since]
  B -- Yes --> D{out_of_bounds_since set?}
  D -- No --> E[Set it + emit boundary_warning]
  D -- Yes --> F{Elapsed > grace?}
  F -- No --> G[Keep warning]
  F -- Yes --> H{Penalty mode}
  H -- warn --> I[Repeat warning only]
  H -- extra_ping --> J[Release extra ping for that runner + event boundary_penalty]
```

## 12. Reconnect and resilience

```mermaid
flowchart TD
  A[App killed / offline / process restarted] --> B[App relaunch or network returns]
  B --> C[Restore session from storage]
  C --> D[Read stored active game id]
  D --> E[get_game_state]
  E --> F{Game status}
  F -- live / head_start / countdown --> G[Resubscribe realtime, restart location task, resume game screen]
  F -- ended --> H[Result screen]
  F -- lobby / target_selection --> I[Lobby / target screen]
  F -- cancelled --> J[Home with notice]
```

Also handled:
- **Background task killed by the OS:** foreground service plus the in-app warning if no upload was received for over 60 s ("Tracking paused, open the app").
- **Offline for a short time:** uploads queue (max 50), only the newest position matters, trail gaps are acceptable.
- **Clock skew:** all timers come from the server offset, never from device time alone.

## 13. Host and edge-case rules

| Situation | Behaviour |
|---|---|
| Host leaves in lobby | Host passes to the earliest-joined player |
| Host leaves mid-game | Game continues, host passes on |
| Last hunter leaves | Runners win by forfeit |
| Last runner leaves or is tagged | Hunters win (`all_tagged`) |
| Player leaves mid-game | Runner is treated as tagged, hunter is removed |
| Start pressed with no hunters or no runners | Blocked with message |
| Target outside the area | Rejected with message |
| Code collision | Regenerated (unique among active games) |
| Join after start | Blocked ("Game in progress") |
| SOS pressed | All players see the player's last position and a banner. The game continues, and the player can end their participation |
| Two hunters tag the same runner at once | Row lock, one tag recorded, the other gets `no_target` |

## 14. Post-game flow

```mermaid
flowchart LR
  A[game_ended] --> B[Stop location tracking + clear active game]
  B --> C[Result: winner, reason, stats]
  C --> D[Reveal target + final positions + recorded trails]
  D --> E[Replay: tags, pings, timeline scrubber]
  C --> F[Play again -> lobby, same players + settings]
  C --> G[Home]
```

The result screen (`app/result/[id].tsx`) owns the ended phase. It loads `get_game_state` for the winner, final positions and target, then calls `get_game_trails` for the recorded routes. That RPC is member-only and refuses to run unless the game is `ended`; the `trail_points` RLS policy applies the same gate. The live screen replaces itself with the result as soon as it sees `ended`, and the result stops any surviving location task on mount.

**Play again** calls `rematch_game`. Any member can press it, not only the host. The first press copies the mode, play area and round settings into a new lobby, keeps the original host if they are still in the crew, adds every player who had not left with their previous side, and resets tags and ready flags. The source game stores the new id in `games.rematch_game_id`; later presses return that same lobby. The result screen polls the pointer, so every player still on the result moves into the fresh lobby together. Classic Chase asks a runner for a new target before the next round.

The result's “Watch replay” opens `app/replay/[id].tsx`. The replay loads `get_game_replay` for every tag and released ping, reuses `get_game_trails`, and scrubs `live_at` to the finish. Trails, positions and pings stop at the playhead; tags and pings appear as timeline markers, and playback runs at 1× or 10×. Both recap RPCs are member-only and ended-only.
