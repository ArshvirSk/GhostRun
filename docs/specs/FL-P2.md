# GhostRun — Specification: FL-P2 Echo Scoring Engine & Calibration

> **Status:** Active Phase Specification  
> **Milestone:** Wave 6 / Task FL3 (Phase P2)  
> **Companions:** `docs/FRIENDS_LEADERBOARDS.md`, `docs/ECHO_CALIBRATION.md`, `docs/specs/FL-P0.md`, `docs/specs/FL-P1.md`, `docs/MODES.md`

---

## 1. Overview & Mathematical Definition

Phase P2 introduces **Echo**, GhostRun's brand-new, original competitive scoring metric built specifically around the game's defining mechanic: the **delayed ping**.

### 1.1 The Core Idea
- Hunters see where runners **were**. Runners decide whether that ping leads anywhere.
- Runners score Echo by making pings lead to empty space (**Ghost rate**).
- Hunters score Echo by converting stale delayed pings into physical contact (**Cash rate**).
- Round outcome matters, but individual skill shines through: an outstanding runner on a losing squad or an aggressive hunter on a losing squad still earns respectable Echo.

---

## 2. Mathematical Formulations

### 2.1 Window Parameters
- **Window $W$:** Time window after ping release to evaluate displacement and hunter chase:
  $$W = \text{clamp}\left(\frac{\text{ping\_interval\_s}}{2}, 45\text{ s}, 120\text{ s}\right)$$
  *(Default $150\text{ s} \implies W = 75\text{ s}$)*
- **Minimum Displacement $D_{min}$:** Distance runner must move from ping location $L$ to be credited with ghosting:
  $$D_{min} = \text{clamp}(0.10 \times \text{area\_radius\_m}, 30\text{ m}, 80\text{ m})$$
  *(Default $600\text{ m} \implies D_{min} = 60\text{ m}$)*
- **Cash Window $T_c$:**
  $$T_c = \text{ping\_interval\_s} + 60\text{ s}$$
  *(Default $150\text{ s} \implies T_c = 210\text{ s}$)*
- **Cash Contact Radius $R_{cash}$:**
  $$R_{cash} = 2 \times \text{tag\_radius\_m}$$
  *(Default $20\text{ m} \implies R_{cash} = 40\text{ m}$)*

### 2.2 Contested Pings
A delayed ping released at time $t$ at coordinate $L$ for runner $r$ is **contested** if and only if:
1. Runner $r$ was active at $t$ (not tagged, jailed, out of bounds, or remote).
2. At least one hunter $h$ was within $200\text{ m}$ of $L$ at timestamp $t$.
3. That hunter $h$ was actively moving, traveling at least $50\text{ m}$ along their trail during window $[t, t + W]$.

### 2.3 Ghosting and Cashing Criteria
- **Ghosted by Runner $r$:** Ping is contested, runner $r$ is not tagged by $t + W$, and runner $r$'s position at $t + W$ is $\ge D_{min}$ from $L$.
- **Cashed by Hunter $h$:** Hunter $h$ satisfied the proximity and movement conditions at $t$, and within $[t, t + T_c]$, came within $R_{cash}$ of $r$'s live position or successfully tagged $r$.

### 2.4 Yield $Y$ (Bayesian Smoothing with $k = 3$)
$$Y_{runner} = \frac{\text{ghosted pings} + 1.5}{\text{contested pings} + 3.0}$$
$$Y_{hunter} = \frac{\text{cashed pings} + 1.5}{\text{contested pings positioned for} + 3.0}$$

### 2.5 Component Terms ($O, Y, P, D$)
1. **Outcome $O$:**
   - Base mode profiles define team win (1.0) vs. loss (0.0).
   - Tagged runner on winning team receives $0.8$ (Classic Chase) or $0.6$ (Tag Hunt / Jailbreak).
   - Host ended early: $O = 0$ (outcome excluded from both sides).
2. **Presence $P$:**
   - Runner: fraction of live match duration spent active.
   - Hunter: fraction of live match duration spent inside play zone and moving ($\ge 100\text{ m}$ per rolling 5 min).
3. **Difficulty $D$ (v1 Team Ratio Adjustment):**
   With $H$ hunters and $R$ runners:
   $$D_{runner} = 1 + 0.15 \times \text{clamp}\left(\frac{H/R - 0.5}{0.5}, -1, 1\right)$$
   $$D_{hunter} = 1 - 0.15 \times \text{clamp}\left(\frac{H/R - 0.5}{0.5}, -1, 1\right)$$
4. **Round Echo Formula:**
   $$\text{Echo} = 100 \times (0.40 \times O + 0.40 \times Y + 0.20 \times P) \times D$$

---

## 3. Server Schema & Constraints

```sql
CREATE TABLE public.scoring_profiles (
  mode_id text PRIMARY KEY,
  ranked boolean NOT NULL DEFAULT false,
  weights jsonb NOT NULL,               -- {"o": 0.4, "y": 0.4, "p": 0.2}
  outcome_map jsonb NOT NULL,
  params jsonb NOT NULL                 -- {"r_press_m": 200, "active_move_m": 50, "k": 3}
);

CREATE TABLE public.round_scores (
  game_id uuid REFERENCES public.games(id) ON DELETE CASCADE,
  player_id uuid REFERENCES public.players(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode_id text NOT NULL,
  role text NOT NULL,
  o real, y real, p real, d real, echo real,
  contested int, hit int,               -- ghosted (runner) or cashed (hunter)
  counted boolean NOT NULL DEFAULT false,
  excluded_reason text,
  ended_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE public.season_scores (
  season text NOT NULL,                 -- e.g. '2026-11'
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  echo_total real NOT NULL,
  rounds_counted int NOT NULL,
  avg_best real,
  avg_ghost real, avg_cash real,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (season, user_id)
);
```

---

## 4. Eligibility & Anti-Cheat Guards

A round produces counted Echo scores if and only if **all** of the following hold:
1. $\ge 1$ hunter and $\ge 2$ runners (or mode minimum).
2. Live match duration $\ge 5$ minutes ($300\text{ s}$).
3. $\ge 50\%$ of players moved $\ge 150\text{ m}$.
4. No flag for mock GPS (`mock_detected`) or sustained vehicle speed (`vehicle_speed_detected`) for that player.
5. Player did not leave early (`status != 'left'`).
6. Mode is ranked (`classic_chase`, `tag_hunt`, `jailbreak`).
7. Daily cap of max 6 counted rounds per calendar day.
8. Same-group discount: after 3 rounds with the exact same group on the same day, subsequent rounds count at $50\%$.

---

## 5. Tier System (Based on Best 12 Average)

| Tier | Best 12 Average Echo | Description |
|---|---|---|
| **Whisper** | $< 40$ | Novice stealth operative. |
| **Shade** | $40 \text{ to } 54$ | Capable operative with sound tactical pacing. |
| **Wraith** | $55 \text{ to } 69$ | Highly evasive runner / disciplined tracker. |
| **Phantom** | $70 \text{ to } 84$ | Elite tactical master; routinely dupes or cashes pings. |
| **Revenant** | $\ge 85$ | Legendary echelon; near-flawless execution under pressure. |
