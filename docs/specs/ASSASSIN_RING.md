# B2 — Assassin Ring Mode Specification

> **Status:** Draft — awaiting host approval before any code is written.
> **MODES.md reference:** Section 4.3 (lines 423–447), compatibility matrix §2.3 (line 143), mode framework §2.1–2.2.
> **Effort estimate:** M (1–2 weeks).

---

## 1. Rules (from MODES.md §4.3, with clarifications)

### Core concept
Free-for-all tactical elimination ring. Everyone has a secret assigned prey and is someone else's prey. You receive delayed radar pings of your assigned prey only, and a directionless sensory proximity pulse when your unknown hunter closes in. The last survivor wins.

### Teams and players
- **Teams:** No teams. Free-for-all (`solo`). In the database, players have `team = 'solo'`.
- **Minimum:** 6 players (recommended in `MODES.md` §4.3; degraded test support for 3+ in dev/sim).
- **Ideal:** 8 to 16 players.

### Setup & Ring Permutation
1. During lobby setup, players ready up individually without picking runner/hunter teams.
2. The host or system establishes at least two **Safe Zones** inside the play area boundary.
3. When the round starts (`start_game`):
   - The server validates that at least 3 players (production: 6) are active and ready.
   - The server generates a random single-cycle permutation (Hamiltonian cycle) of all active players:
     $$P_{\pi(1)} \to P_{\pi(2)} \to P_{\pi(3)} \dots \to P_{\pi(N)} \to P_{\pi(1)}$$
   - Each player $P_{\pi(i)}$ is assigned $P_{\pi(i+1)}$ as their prey.
   - Stored in a new `ring_assignments` table.
   - **Asymmetric Secrecy:** Player $P_{\pi(i)}$ receives the identity (display name, avatar color) of their assigned prey only. They do **not** know who is hunting them, nor the layout of the rest of the ring.

### Information Architecture & Pings
- **Prey Radar Pings:** On each scheduled ping interval (`ping_interval_s`, default 45 s), each active player receives a delayed radar coordinate snapshot of **their prey only**. They receive no coordinate data for any other player.
- **Hunter Proximity Pulse:**
  - If a player's assigned hunter is within **100 m**, the player's screen and haptic engine emit a faint amber proximity warning ("HUNTER NEAR").
  - If the hunter closes to within **40 m**, the sensory alert intensifies to urgent red ("HUNTER CLOSE").
  - The alert is completely **directionless** and reveals **zero identity** or coordinates of the hunter.

### Tagging & Ring Relinking
- **Tag Validation:** Player $P$ presses TAG within tag radius (default 15 m).
  - The server checks if the nearest player is $P$'s assigned prey.
  - If the nearest player is **not** $P$'s assigned prey: tag fails (`success: false, reason: 'not_your_prey'`). Standard 8-second failed tag cooldown applies. Zero presence is leaked to the other player.
  - If the nearest player **is** $P$'s assigned prey:
    - Prey transitions to status `'tagged'` (eliminated spectator).
    - Hunter $P$ increments their `elimination_count`.
    - **Ring Relink:** Hunter $P$ inherits their victim's assigned prey. If the ring was $A \to B \to C$ and $A$ tags $B$, the ring updates to $A \to C$.
    - A `player_eliminated` event is emitted.
    - Hunter $P$'s HUD updates immediately with their new prey target.

### Safe Zones
- At least 2 Safe Zones (default 20 m radius) inside the boundary.
- Inside a safe zone:
  - Tagging is disabled for all players inside the zone.
  - A player may shelter for up to `safe_zone_max_s` (default 60 s).
  - Leaving or exceeding 60 s triggers a `safe_zone_cooldown_s` (default 120 s) before that player can benefit from shelter again.

### Win Conditions
| Winner | Condition |
| :--- | :--- |
| **Last Survivor** | Only 1 active player remains alive in the ring. |
| **Most Eliminations** | Match timer expires with $\ge 2$ players alive; player with highest `elimination_count` wins. Tiebreakers: (1) longest survival time, (2) distance traveled. |

### Edge cases
- **Disconnected / Offline Player:** If an active prey drops offline or ceases submitting GPS fixes for $> 180\text{ s}$ (`offline_relink_s`), the server auto-relinks the ring around them, marking the offline player eliminated by timeout to prevent match deadlock.
- **Mutual Tag Attempt:** If two players are in a 2-player final duel ($A \to B \to A$), both can tag each other. Postgres row locking on the `ring_assignments` table resolves the tie: the first transaction committed at server time wins the tag.

---

## 2. Server & Secrecy Architecture

### Database Schema Changes
1. **Enum Additions:**
   ```sql
   alter type public.game_mode add value if not exists 'assassin_ring';
   alter type public.team_type add value if not exists 'solo';
   ```
2. **Ring Assignments Table:**
   ```sql
   create table public.ring_assignments (
     id uuid primary key default gen_random_uuid(),
     game_id uuid not null references public.games(id) on delete cascade,
     hunter_player_id uuid not null references public.players(id) on delete cascade,
     prey_player_id uuid not null references public.players(id) on delete cascade,
     status text not null default 'active' check (status in ('active', 'eliminated', 'relinked')),
     assigned_at timestamptz not null default now(),
     eliminated_at timestamptz,
     unique (game_id, hunter_player_id, status)
   );
   create index ring_assignments_game_idx on public.ring_assignments(game_id);
   ```
3. **RLS Policies:**
   - `ring_assignments`: A player can SELECT only the row where `hunter_player_id` matches their own player ID and `status = 'active'`. Direct selects for other players are blocked.
   - `pings`: In `assassin_ring`, RLS and `get_game_state` return pings only where `player_id = my_prey_id`.
4. **Safe Zone Entities:**
   - Stored in `entities` with `kind = 'safe_zone'`, `visible_to = 'all'`, `state = '{"radius_m": 20}'`.

### RPC Updates
- `create_game`: Accepts `mode = 'assassin_ring'`.
- `set_safe_zones`: Host RPC to configure 2 safe zone coordinates.
- `start_game`: Generates random circular permutation and seeds `ring_assignments`.
- `apply_tag`: Validates target is assigned prey, marks prey eliminated, relinks ring, checks last survivor.
- `get_game_state`: Embeds `my_prey` (id, display_name, color), `hunter_proximity` ('none' | 'near' | 'close'), safe zones, and active survivor count.
- `advance_game`: Checks offline timeout relinks and last survivor win condition.

---

## 3. Client UI Changes

1. **`app/create.tsx`**:
   - Add `Assassin Ring` option with icon, min players badge (6), and description card.
2. **`app/lobby/[id].tsx`**:
   - Render solo roster (no team picker).
   - Display safe zone placements on the lobby map.
   - Start button requires $\ge 6$ ready players (or 3+ in development).
3. **`app/game/[id].tsx`**:
   - Top Target Card: "YOUR PREY: [Name]" with prey avatar and ping indicator.
   - Hunter Warning Indicator: Ambient edge glow and haptic pulse when hunter is within 100 m (amber) or 40 m (red).
   - Map: Safe zone visual circles (green glow) with shelter countdown timer when inside.
   - TAG button enabled only when within 15 m of assigned prey.
4. **`app/result/[id].tsx`**:
   - Final leaderboard with elimination counts, survival ranks, and full ring reveal for post-game recap.

---

## 4. Test & Verification Plan

1. **Simulation Suite (`scripts/sim/index.ts`)**:
   - Scenario `assassin-ring`:
     - Test ring generation with 6 players ($P_1 \to P_2 \dots \to P_6 \to P_1$).
     - Verify player receives pings of prey only.
     - Verify proximity pulse triggered when hunter enters 100 m / 40 m.
     - Verify tagging non-prey fails without penalty.
     - Verify tagging prey eliminates prey and relinks hunter to victim's prey.
     - Verify safe zone shelter disables tagging.
     - Verify last survivor triggers round win.
2. **Access Control (`scripts/rls-check.ts`)**:
   - Verify player cannot read another player's ring assignment.
   - Verify player cannot query positions or pings of non-prey.
   - Verify outsider cannot read ring or safe zone states.
3. **Typecheck & Lint**:
   - `npm run typecheck` (0 errors)
   - `npm run lint` (0 errors)

---

## 5. Decisions Needed from You

| # | Decision | Recommendation | Trade-off |
|---|---|---|---|
| **D9** | **Safe Zone Placement:** Host places them manually, or auto-generate two safe zones based on the play area? | **Auto-generate 2 safe zones by default**, with host ability to drag/relocate them in the lobby. | Auto-generation ensures zero setup friction; manual adjustment allows aligning with physical park structures. |
| **D10** | **Minimum Player Count:** Strictly enforce 6 players, or allow 3+ with a "small group" warning? | **Allow 3+ with a warning**, while recommending 6–16 in the UI copy. | Allows casual testing and small friend groups to play, while preserving the full ring dynamic. |
| **D11** | **Spectator Revenge Rule (MODES.md §4.3):** Include "revenge token" or standard spectator mode on elimination? | **Standard spectator mode for B2**; consider revenge tokens as a future modifier. | Keeps base mode implementation clean, robust, and focused on core mechanics. |
