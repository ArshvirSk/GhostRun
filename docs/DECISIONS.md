# GhostRun — Decisions

## 2026-10-28 — Use OpenFreeMap Liberty for the initial map style

**Decision:** Use `https://tiles.openfreemap.org/styles/liberty` as the default MapLibre style, overridable through `EXPO_PUBLIC_MAP_STYLE_URL`.

**Reason:** It is compatible with MapLibre Native and does not require an API key, which keeps M0 setup simple and avoids adding a third-party credential. MapLibre's attribution control remains visible.

**Trade-off:** OpenFreeMap is a community-operated public service offered without an availability guarantee. Revisit the provider if field testing shows reliability issues or the app needs an SLA-backed map service.

## 2026-10-29 — End M1 at target selection, not the countdown

**Decision:** The lobby advances to `target_selection` for Classic Chase only, and `set_target` is its own RPC. Tag Hunt lobbies stay in `lobby` where players ready up. Neither mode starts a round yet.

**Reason:** The countdown, head start and live map belong to the gameplay milestone. Shipping a `countdown` status before those screens exist would leave players on a screen the app cannot render, and would make `set_ready` reject changes for a phase nobody can act in.

**Trade-off:** The host has no “start” action until the next milestone. The target screen states this in plain copy rather than offering a disabled button that looks broken.

**Superseded 2026-10-30:** the round-start milestone below adds the host start action and phases.

## 2026-10-30 — Server timestamps drive the round clock

**Decision:** `start_game` is host-only and starts a fixed 10-second countdown. It writes `head_start_at`, `live_at`, `ends_at` and `next_ping_at` once, and `advance_game` moves `countdown → head_start → live → ended` when those timestamps pass. `get_game_state` calls it before returning, so any member reading state keeps the phase current. Clients derive every timer from the snapshot's `server_time`, never the device clock.

**Reason:** Every player must see the same countdown even when phone clocks differ. Lazy advancement avoids depending on pg_cron before the location and ping loop exists; the next read after a deadline catches up, including across several phases at once.

**Trade-off:** With nobody reading state, the phase changes on the next read rather than exactly on time. The `live` window can also end by time expiry before target-reached and tag endings exist; Classic awards the win to hunters and Tag Hunt to runners, per `TRD.md`.

## 2026-10-30 — Live positions are team-only; hunters get scheduled pings

**Decision:** `submit_position` stores only the caller's fix and returns the phase. `get_game_state` includes the caller's own position and their teammates' positions, and includes opponents' positions only after the round ends. Pings are delayed snapshots of active runners, released by `advance_game` once per `ping_interval_s`, and both teams can read them (runners see exactly what hunters know).

**Reason:** The PRD's core promise is inference from delayed pings, not following a live dot. Filtering inside the security-definer snapshot and in RLS means a client cannot opt into opponent positions. Pings contain runners only, so showing them to runners leaks nothing.

**Trade-off:** Realtime `player_positions` rows reach teammates only; hunters rely on the `pings` insert to refresh. A runner with no stored fix is omitted from that ping round rather than appearing as an empty marker.

## 2026-10-30 — Ping release is lazy; uploads are latest-fix-wins

**Decision:** No pg_cron job is installed. Any member's `get_game_state` or `submit_position` call runs `advance_game`, which releases one ping round when `next_ping_at` has passed and then skips missed rounds instead of replaying them. The live screen reads state at the ping boundary, and runners upload every 5-10 s. `submit_position` upserts one position per player, appends a trail point at most every 10 s, clamps client timestamps to a 5-second future / 2-minute past window, emits one boundary warning per excursion, and releases one extra ping per excursion when the `extra_ping` penalty is configured. The phone keeps a foreground fallback uploader when background permission is refused and drops failed uploads in favour of the next fix.

**Reason:** Only the newest position matters for gameplay, and a bounded trail is enough for replay. Lazy release removes the scheduled-job dependency and still keeps pings accurate while at least one player is reading. Treating client clocks as untrusted keeps `position_age_s` honest. The fallback lets players who deny “all the time” location still share while the screen is open.

**Trade-off:** With nobody polling, a ping is released on the next read rather than exactly on schedule. Background tracking needs a development build and, on Android, the “Allow all the time” setting; the app shows a foreground-only notice when that is missing. There is no 50-point offline queue: an outage longer than one interval yields no snapshot for that runner, and the next round uses the newer fix.

## 2026-10-30 — The result screen reads trails through a recap RPC

**Decision:** `game/[id]` replaces itself with `result/[id]` when the round is `ended`. The result loads `get_game_state` for the winner, final positions and revealed target, then calls `get_game_trails` for the recorded routes. The RPC is member-only and refuses any game that is not ended; `trail_points` RLS keeps the same gate.

**Reason:** The live screen's job is over once the round ends, so the recap gets its own screen and camera. Trails are larger than the rest of the snapshot and are read once, so they do not belong in every `get_game_state` poll. The RPC is security definer because PostGIS coordinates are awkward to select through PostgREST, and the explicit status check keeps the secrecy rule in one server-side place.

**Trade-off:** The result makes one extra round trip after the state snapshot. The RPC caps the response at 30,000 points as a payload guard. Play again is still future work; the result screen stops location tracking and sends the player home.

## 2026-10-30 — Tagging and arrival are server-authoritative endings

**Decision:** `attempt_tag` is hunter-only and live-only. It requires a fresh (under 20 s) hunter fix, finds the nearest active runner with a fresh fix inside `tag_radius_m` plus up to 10 m of average GPS accuracy, and returns only `{success:false, reason}` on failure. A failed attempt starts an 8-second cooldown; a successful tag records the tag, marks the runner `tagged`, emits `runner_tagged`, and ends the round `all_tagged` when no active runners remain. `submit_position` ends a Classic round `target_reached` when a runner's fix is inside `target_radius_m` of the secret target. Both paths call an internal `end_game` whose execute privilege is revoked from every API role. The live screen shows hunters a tag-radius ring and a TAG control; a tagged runner becomes a spectator and stops sharing location.

**Reason:** The round should be decided by what players actually do, not only by a clock. Keeping range, freshness and winner checks inside Postgres prevents a modified client from tagging from across the map or ending a round at will. Omitting distance and direction from failures preserves the inference game.

**Trade-off:** A successful tag does not start a cooldown, so a hunter standing among several runners can tag again immediately (the next runner must still be fresh and in range); only a failed tag starts the timer. Spectators see pings and teammate positions, but the screen does not yet name who tagged them; the `runner_tagged` event is the source for that feed.

## 2026-10-30 — Replay scrubs tags, pings and trails from server data

**Decision:** The result screen links to `replay/[id]`. The replay loads `get_game_state` for the round, `get_game_trails` for routes, and `get_game_replay` for every tag and released ping. `get_game_replay` is member-only and ended-only. The scrubber runs from `live_at` to `ended_at` (or `ends_at` when time expired), truncating trails, positions and pings at the playhead. Tags and pings are drawn as timeline markers; play advances at 1× or 10×.

**Reason:** The replay should show what the server recorded, not reconstruct gameplay from live state. One ended-only RPC keeps the tag and ping history complete and gives the screen display names, colors and coordinates without exposing raw PostGIS rows. Truncating client-side is cheap because the data is terminal and already bounded.

**Trade-off:** A tag record stores the distance between players, not the tag coordinates, so the map places a tag at the runner's last trail point at or before the tag; the exact spot can be up to one trail interval away. Playback is local rather than a shared synchronized stream, and the result's replay button is the only entry point beyond a deep link.
