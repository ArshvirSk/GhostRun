# GhostRun — V2 Audit (M0)

> Written 2026-11-01 before any v2 feature code. Source of truth: this repository. Every claim below was read from the actual migrations, screens and scripts, not from the v1 docs. Where the repo and `MODES.md` disagree, the conflict is numbered (C-n) and listed in section 7.

---

## 1. Current schema and RLS (table by table)

All tables have RLS enabled; `authenticated` gets SELECT only (plus UPDATE on own `profiles`). All writes go through SECURITY DEFINER RPCs with `set search_path = public, extensions`.

| Table | Columns (essentials) | RLS SELECT policy | Realtime |
|---|---|---|---|
| `profiles` | id → auth.users (cascade), display_name (1–20), color (hex, default `#1D4ED8`), created_at | Own row, or a user who shares a non-left game with you (`profiles_select_self_or_game_mates`, m1). UPDATE own row only | No |
| `games` | id, code (`^[A-HJ-NP-Z2-9]{4}$`, unique among active), host_id, **mode enum('classic_chase','tag_hunt')**, status enum(lobby, target_selection, countdown, head_start, live, ended, cancelled), area_center geography(Point,4326), area_radius_m 100–5000 def 600, head_start_s def 180, duration_s def 2700, ping_interval_s def 150, tag_radius_m def 20, target_radius_m def 25, boundary_grace_s def 30, boundary_penalty warn\|extra_ping, head_start_at/live_at/ends_at/next_ping_at, ping_seq, winner, end_reason, ended_at, rematch_game_id (m7) | `is_member(id)` | Yes |
| `players` | id, game_id (cascade), user_id → profiles (**NO ACTION**), team enum(runner,hunter,unassigned), status enum(active,tagged,left), is_ready, last_tag_attempt_at, joined_at, tagged_at; unique(game_id,user_id) | `is_member(game_id)` | Yes |
| `player_positions` | player_id PK (cascade), game_id, geog, accuracy_m, speed_mps, heading, is_mock, recorded_at, updated_at, out_of_bounds_since | member AND (same team OR ended) | Yes |
| `trail_points` | id bigserial, game_id (cascade), player_id (cascade), geog, accuracy_m, recorded_at | member AND ended (`trails_after_end`) — **any member sees everyone's trail after end** (C-3) | No |
| `targets` | game_id PK, geog, set_by → players (NO ACTION), set_at | member AND (my team = runner OR ended) | No |
| `pings` | id, game_id, seq, player_id (cascade), geog (nullable), accuracy_m, position_age_s, reason check ('scheduled','boundary'), released_at | member (all teams, always) | Yes |
| `tags` | id, game_id, hunter_id → players (NO ACTION), runner_id → players (NO ACTION), distance_m, tagged_at | member | Yes |
| `events` | id, game_id, type, audience check('all','runner','hunter'), payload jsonb, created_at | member AND (audience='all' OR audience = my_team). **No `target_player` column** (C-2) | Yes |

Helpers (SECURITY DEFINER, granted to authenticated): `is_member(uuid)`, `my_team(uuid)`, `game_ended(uuid)`. Internal `end_game(uuid,text,text)` has EXECUTE revoked from every API role (m4). Realtime publication contains games, players, player_positions, pings, tags, events; realtime applies RLS per subscriber.

## 2. Current RPC inventory

| RPC | Since | Notes |
|---|---|---|
| `upsert_profile(name,color)` | m0 | |
| `create_game(mode enum, lat, lng, radius_m, settings jsonb)` | m1 | settings: head_start_s, duration_s, ping_interval_s, tag_radius_m, target_radius_m, boundary_grace_s, boundary_penalty |
| `join_game(code)` | m1 | lobby only, max 20 players |
| `set_team`, `randomize_teams`, `begin_target_selection` | m1 | begin_target_selection is Classic-only (raises for Tag Hunt) |
| `set_target` | m1 (fixed) | fixed by `m1_set_target_fix` (ambiguous conflict target) |
| `set_ready` | m1 | lobby/target_selection only |
| `leave_game`, `kick_player` | m1 | host pass-on; runner-leave = tagged |
| `get_game_state` | m1→m2→m3 (final in m3_live_loop) | calls `advance_game` first; returns server_time, game+area, players (names/colors), my_position, team/ended positions, last 100 pings (all members), target (runner or ended), last 50 events |
| `start_game` | m2 (final in **m8_force_start**) | 10 s countdown; **all-ready requirement removed** — host can force start (only teams + target must be set) |
| `advance_game` | m2→m3 (final in m3_ping_catchup_fix) | lazy phase clock + one ping round per due interval, cadence restart after long gaps |
| `submit_position` | m3→heading_fix→**m4 final** | upsert, 10 s trail throttle, boundary warn/penalty, Classic arrival → end_game; clamps client clock (5 s future / 2 min past) |
| `attempt_tag` | m4 | hunter only, live only, 8 s failed cooldown, ≤10 m accuracy allowance, no distance/direction in failures |
| `get_game_trails` | m5 | ended-only, member-only, returns **all players'** trail points (cap 30 000) |
| `get_game_replay` | m6 | ended-only; tags + pings with names; **inner joins profiles** (breaks if a profile is deleted — see C-8) |
| `rematch_game` | m7 | idempotent; copies mode + all settings; preserves sides |
| `cancel_game`, `send_sos` | m8 | SOS emits event audience 'all' with last position |
| `prune_old_trails()` | m8 | deletes trail_points > 30 days; EXECUTE only service_role/postgres; **not scheduled anywhere** (C-6) |

## 3. Current screens (`app/`, Expo Router)

`index` (session/routing), `onboarding` (tutorial), `auth` (email/password sign-in+up, resend with 60 s cooldown, forgot-password), `reset-password` (deep link `ghost-run://reset-password`, implicit+PKCE), `welcome` (name+colour, safety copy, battery guidance per brand), `home` (profile greeting, create/join, sign-out), `create` (mode Classic/Tag Hunt, map centre, radius + round settings), `join` (code), `lobby/[id]` (teams, ready, host start, code share), `target/[id]` (secret target picker), `game/[id]` (1 922 lines: live map, HUD, TAG, SOS, boundary countdown, event feed, spectator, ping vibration), `result/[id]` (winner, stats, trails, rematch), `replay/[id]` (scrubber, 1×/10×).

**No** `settings.tsx`, `help.tsx` or `permissions.tsx` exist although TRD/FLOW list them (G-1). M1 will add a Privacy screen and a Settings screen.

## 4. Auth

Email + password via `supabase.auth` (session persisted in AsyncStorage) — anonymous sign-ins were **disabled on the hosted project**, so onboarding was switched to email/password on 2026-10-30 (DECISIONS). Sign-up → Welcome (profile); sign-in → Home or Welcome. Confirmation email can block new players; the auth screen supports `auth.resend` with a persisted 60 s per-email cooldown (`src/lib/resendCooldownCore.ts`, tested by `npm run test:cooldown`). Password reset via deep link (`src/lib/authLink.ts`). `scripts/rls-check.ts` documents that the project must have either anonymous sign-ins, confirmations off, or a service-role key to mint pre-confirmed test accounts.

## 5. How pings are shown and expired

- **Server:** `advance_game` releases one ping round per `ping_interval_s` (lazy — any member's `get_game_state`/`submit_position` triggers it; no cron). Boundary penalty pings (`reason='boundary'`) and (in v2) noise pings bypass the schedule.
- **Client:** `get_game_state` returns the last 100 pings with **no age limit**. The map shows a ping only while `serverNow − released_at ≤ 10 s`: `PING_VISIBILITY_DURATION_S = 10`, `app/game/[id].tsx:825`. Vibration fires for pings fresher than 6 s (line 482).
- **Enforcement: UI-only.** A modified client can keep rendering old pings from the snapshot. Server-side option proposed as C-5 (needs approval).
- **Replay** (`get_game_replay`, ended-only) intentionally returns the complete ping history — unaffected by the 10 s rule.

## 6. How trails and replay are exposed

- `trail_points` RLS: member AND ended → after a game **every member can read every player's full route** (C-3, the v1 privacy behaviour C-3 will change).
- `get_game_trails` is SECURITY DEFINER and returns all players' points regardless of RLS — both must be gated by `share_trail` in M1, since RLS alone cannot filter a definer RPC.
- `get_game_replay` gives tags (with distance) and pings with display names — event markers stay visible to everyone per 7.4.3 ("they already happened in front of everyone").
- Retention: `prune_old_trails()` exists but nothing schedules it; there is **no** `cleanup_old_games()` and **no** pg_cron job in any migration (C-6).

## 7. Test tooling: what exists and what does not

- **`scripts/rls-check.ts` (1 203 lines): live end-to-end check against the hosted project.** Creates three throwaway players (host=runner, hunter, outsider), plays lobby → target → start → live uploads → waits a real ping interval → tag win, plus a second round won by target-reached; asserts the secrecy matrix (positions, target, live trails, outsider isolation, denied direct writes, tag failure leaks nothing), phase-clock behaviour and reconnect snapshot. Account paths: service-role admin mint (preferred), anonymous, or email/password (needs confirmations off). Leaves test accounts behind (public API cannot delete them). Run: `EXPO_PUBLIC_SUPABASE_URL=… EXPO_PUBLIC_SUPABASE_ANON_KEY=… [SUPABASE_SERVICE_ROLE_KEY=…] npx tsx scripts/rls-check.ts`.
- **`scripts/test-resend-cooldown.ts`:** local, no network; covers the resend guard.
- **There is no `scripts/sim` simulator** (C-1). TRD 7.6 and every v2 milestone assume it exists. Verification today = `npm run typecheck`, `npm run lint`, `test:cooldown`, and a manual `rls-check` run.

## 8. Known gaps versus TRD.md

| TRD item | Reality |
|---|---|
| `scripts/sim` multi-player simulator (7.6) | Missing (C-1) |
| `permissions.tsx`, `settings.tsx`, `help.tsx` screens (§3, FLOW) | Missing; permission/battery guidance lives in `welcome.tsx`, requests are inline |
| pg_cron `advance_all_games` / `cleanup_old_games` (§6.4) | Never installed. Lazy `advance_game` covers phases/pings (DECISIONS 2026-10-30); **retention is not running at all** (C-6) |
| 50-point offline upload queue (7.3) | Deliberately not built (DECISIONS 2026-10-30): newest-fix-wins |
| `src/state`, `src/hooks`, `src/components`, `src/theme` (§3, README) | Only `src/lib` exists; logic is colocated in screens |
| `debug_log` table (§10) | Not added; Supabase logs used |
| `games.mode` as text | It is a PG enum (see C-7) |

## 9. Conflicts and risks: repo vs MODES.md

- **C-1 — No simulator.** MODES.md §10 and all milestones say "extend `scripts/sim`"; the directory does not exist. M2+ acceptance requires scripted scenarios, so a minimal Node simulator must be *built*, not extended. **Needs your approval.**
- **C-2 — `events` has no `target_player`.** Needed for Hot & Cold sensed pulses (4.2). Plan: add in M2 (you allowed either).
- **C-3 — Trail replay readable by all members after end** (`trails_after_end` + `get_game_trails`). C-3 consent must replace both: own trail always; others' only when their `share_trail = true`.
- **C-4 — No consent records, no `share_trail`.** Confirmed: no `consents` table, no share columns. M1 adds them.
- **C-5 — The 10-second ping life is UI-only** (section 5). MODES.md open question 1. Proposed server enforcement: `get_game_state` trims the live ping list to pings released within the last 10 s while the round runs; full history still available post-game via `get_game_replay`. Costs nothing for v1 clients (they filter at 10 s anyway). **Needs your approval.**
- **C-6 — Retention job missing and unscheduled.** No `cleanup_old_games()`, no pg_cron extension created in any migration, `prune_old_trails` cron line is a comment. M1 will create `cleanup_old_games()` (delete trails, pings, tags, events of games ended > 30 days; heat presses join later automatically once they exist) and schedule it via `cron.schedule` in the migration, with a dashboard fallback documented if the plan blocks extension-created schedules. **May need a dashboard click** (see questions).
- **C-7 — `games.mode` is a PG enum, not text.** MODES.md 2.2 adds `mode_id text`. Adding enum values inside a migration transaction cannot be *used* in the same transaction, so v2 goes with `mode_id text not null default 'classic_chase'` (check constraint for now: classic_chase | tag_hunt) **kept in sync with the legacy enum column**, which v1 clients still read. Rematch copies both. Logged as a deviation.
- **C-8 — `delete_my_data()` will fail on real data today.** `players.user_id`, `targets.set_by`, `tags.hunter_id/runner_id`, `games.host_id` are NO ACTION FKs; deleting a profile with game history raises FK violations, and `get_game_replay`'s inner joins would drop rows for deleted players. M1 includes an FK-readiness migration (players cascade; targets/tags set-null with "Deleted player" resolution via LEFT JOIN; host transferred in-transaction before delete).
- **C-9 — Noise secrecy needs column-level RLS.** Noise lives on `player_positions`, whose rows teammates may read. Plan: revoke table SELECT, re-grant column-by-column excluding the secret columns (`noise`, anchor fields); `get_game_state` already whitelists fields. Same technique for `players.secret_role` in M2.
- **C-10 — Force-start bypasses ready-up.** m8 removed the all-ready gate, so the M1 consent block must live in **both** `set_ready` and `start_game` (every active player must have `share_trail <> null`).
- **C-11 — QR Tagging needs a server HMAC secret.** No secrets in repo/app. Plan: random secret generated in the migration, stored in a deny-all table readable only by SECURITY DEFINER functions; rotation is a later dashboard/SQL step. **Tell me if you'd rather use Supabase Vault.**
- **C-12 — `hot_cold` is called both a modifier and a "mode id"** in MODES.md (catalogue vs 4.2). Plan: implement as a **modifier** (matches the compatibility matrix and requires no new win conditions). Logged as deviation.
- **C-13 — MODES.md `phases` include a `setup` phase** that the `game_status` enum does not have; v2.0 modes use lobby/target_selection as setup. No enum change.
- **C-14 — Export sharing needs new deps.** `export_my_data` returns JSON; sharing a file needs `expo-file-system` + `expo-sharing` (small, Expo-official). **Ask before adding** — see questions.
- **C-15 — Ghost tables not built now.** 7.4.7's `ghost_library`/`ghost_contributions` are out of scope (C4 later); the `consents` table will still accept a 'ghost' consent type so the schema is ready.
- **C-16 — README/docs drift (record only):** README's repo-structure section lists directories that do not exist (`src/components` etc.) and does not mention `scripts/rls-check.ts` correctly; TRD says "pings expire" language that is UI-only. README updates are scheduled in M6.

## 10. Migration plan (M1–M5)

Naming follows the repo convention `YYYYMMDDHHMMSS_v2mN_topic.sql`. One concern per file; every replaced function is restated in full (never edited in place). Rollback for every milestone is a hand-written reversal migration (Supabase CLI has no down migrations) plus reverting the APK: the schema is additive with safe defaults, so old clients keep working throughout.

### V2-M1 — Privacy, consent, retention
1. `20261101000000_v2m1_consent_schema.sql` — `consents` (append-only: INSERT via SECURITY DEFINER RPC only; no client UPDATE/DELETE), `players.share_trail boolean null`, `players.share_choice_at`, trail RLS replaced (own trail always; others only when `share_trail = true` and game ended), FK-readiness for deletion (C-8). *Rollback:* drop consents, restore `trails_after_end`, restore FKs.
2. `20261101001000_v2m1_consent_rpcs.sql` — `set_consent`, `set_share_trail` (changeable until ended + post-game hide), `export_my_data` (JSON bundle: profile, consents, games, own trails/events), `delete_my_data` (host transfer → neutralise → delete profile → app signs out), `get_game_trails` replaced (share_trail filter), `get_game_replay` replaced (LEFT JOIN, "Deleted player"), `set_ready` + `start_game` replaced (consent gate, C-10). *Rollback:* drop RPCs; restate v1 bodies from git.
3. `20261101002000_v2m1_retention.sql` — `cleanup_old_games()` (trails, pings, tags, events of games ended > 30 days; supersets `prune_old_trails`), `cron.schedule('cleanup-games','0 3 * * *', …)` guarded with a clear comment + dashboard fallback instructions. *Rollback:* unschedule, drop function.
4. Code: Privacy screen (first-run gate w/ age ack, Settings variant, short-version card, expandable draft copy, `PRIVACY_VERSION` + "What changed" prompt), lobby-join replay sharing sheet (two equal buttons), Settings screen (export, delete account with typed confirmation, C3/C5/C7 toggles; C4 UI absent), `TODO` placeholders for contact email + policy URL. rls-check gains: private-trail unreadability, consent append-only, delete/export smoke test.

### V2-M2 — Mode framework
1. `20261102000000_v2m2_mode_schema.sql` — `games.mode_id/roles/modifiers/mode_params` (C-7), `players.secret_role/is_remote/status_detail` (column-grants, C-9), `entities`, `player_resources`, `events.target_player` + its 4.2 RLS rule, `app_settings` deny-all feature-flag table + `feature_enabled()` helper. *Rollback:* drop columns/tables, restore events policy.
2. `20261102001000_v2m2_mode_rpcs.sql` — `get_mode_registry()` (server copy of modes/modifiers/params/compatibility/flags), `create_game` + `start_game` replaced (validate registry + compatibility + flags with clear errors; seed resources). *Rollback:* restate functions.
3. Code: `src/lib/modeRegistry.ts`, lobby mode/modifier/role picker + rules card, `scripts/sim` created (C-1, on approval), rls-check rows for new tables and secret_role. *Rollback:* revert APK.

### V2-M3 — Modifiers
1. `20261103000000_v2m3_noise.sql` — noise/anchor columns (column-grants), `pings.reason` += 'noise','camping', `submit_position` replaced (15 s smoothing, accuracy gate, gain/decay, 100→ping+reset-40, 60→spark event, camping ping, vehicle warning).
2. `20261103001000_v2m3_dead_drops.sql` — drops spawn on start (entities kind='drop', ≥150 m apart, ≥60 m inside), `nearby_drops` (40 m), claim-hold RPC (15 m/5 s, 3 min cooldown), `use_item` (Veil/Decoy/Burn/Free Ping/Jam/Sweep), ping-release path consumes Veil/Decoy, `report_drop` respawn.
3. `20261103002000_v2m3_qr_tagging.sql` — `qr_token` (20 s HMAC, server secret C-11), `tag_by_qr` reusing a shared internal tag core extracted from `attempt_tag`.
4. `20261103003000_v2m3_shrinking_zone.sql` — staged effective radius from `mode_params`, `advance_game` + `submit_position` replaced (60 s pre-announcements, centre-only shrink).
Each file rolls back by dropping its objects and restating replaced functions; all are inert for games with the modifier off.

### V2-M4 — Hot & Cold Hunt
1. `20261104000000_v2m4_heat_schema.sql` — `team_resources`, `heat_presses`, `heat_press_feed` view (owner-rights view applies member+hunter filter itself; 5-minute mark window; no `nearest_runner_m`), grants: SELECT on view only, base table locked down, no realtime.
2. `20261104001000_v2m4_heat_press.sql` — `heat_press(game_id)` per spec: lazy regen, `team_resources` row lock, hunter freshness 20 s, runner freshness 45 s, seeded fuzz (game,hunter,60 s bucket), Variant A default + B with refund, events heat_used (all) / heat_mark (hunter) / sensed (target_player, runner). Client: HEAT button (pips + cooldown ring), non-touch-blocking 30–35 % fade overlay (icon+label+haptic, no strobe), runner ripple, marks layer.
*Rollback:* drop view/tables/RPC; revert APK.

### V2-M5 — Double Agent + recap stats
1. `20261105000000_v2m5_double_agent.sql` — `start_game` replaced (assign agent when role on and ≥2 hunters), `agent_scramble` (next scheduled ping of chosen runner shifted 150–250 m, clamped inside boundary, consumed at release), `agent_whisper` (target quadrant, Classic only), `start_tribunal`/`cast_vote` (eject agent → extra ping round; eject loyal → lost ping round + 5 min silence), role reveal in `get_game_state` post-end.
2. `20261105001000_v2m5_recap.sql` — `get_game_stats(game_id)` (closest call — ended-only, and only for players with `share_trail = true`, own card + per-player gating; longest unseen streak; loudest moment; heat presses + hit rate; drops claimed) + Result-screen cards.
*Rollback:* drop RPCs, restate `start_game`.

M6 (field test) adds no migrations: `docs/PLAYTEST.md`, README, DECISIONS, EAS preview APK.

## 11. Open questions (blocked on you)

1. **Contact email + policy URL** for the privacy screen, or confirm placeholders (`TODO`) until you host it. Reminder: the policy needs real legal review before the app goes beyond friends.
2. **Sign-in method:** keep email/password (recommended: disable "Confirm email" in the Supabase dashboard → Authentication → Providers → Email, since the built-in sender has low hourly limits and confirmation blocks new players) **or** re-enable anonymous guests. Pick one; exact dashboard steps will be in the M1 report either way.
3. **Ping lifespan:** keep 10 s (currently UI-only). Approve the server-side trim in `get_game_state` (C-5)?
4. **Dashboard actions:** (a) confirm pg_cron is enabled (Database → Extensions) if the retention migration's `cron.schedule` is rejected; (b) the "Confirm email" toggle if you choose option 2. I will give exact click-paths in M1.
5. **Export dependencies:** approve `expo-file-system` + `expo-sharing` for JSON export via the system share sheet (C-14), or export renders JSON in-app with copy-to-clipboard (zero new deps)?
6. **Simulator:** approve building a minimal `scripts/sim` in M2 (C-1)? Every milestone from M2 depends on it for acceptance.
7. **QR HMAC storage:** in a deny-all table (default) or Supabase Vault (C-11)?
