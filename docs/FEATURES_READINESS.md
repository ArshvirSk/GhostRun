# GhostRun — Feature Readiness Audit (F0)

> **Generated:** 2026-11-15 · **Commit:** `3399022` (v2.7.4, branch `main`)
> **Scope:** Entry gates G1–G6, overlapping-feature inventory, foundation status, leaderboard audit, baseline tests, and decisions F-D1 to F-D14 plus NF-33 to NF-36.

---

## 1. Entry Gates

| # | Gate | Status | Evidence |
|---|---|---|---|
| G1 | All shipping modes implemented and verified | **deferred** | MODE_STATUS.md lists classic_chase, tag_hunt, jailbreak, assassin_ring, relay_heist, territory_pulse, ghost_duel as implemented; all say "fixed in code, needs device test" except classic_chase & tag_hunt ("Ship"). No field test has occurred. Modes audit not yet done against live DB. |
| G2 | Recovery tasks approved | **verified** | PROGRESS.md R1–R4 approved 2026-11-08; DECISIONS.md records recovery decisions. |
| G3 | UI restructure & redesign complete and released | **verified** | UI-M0 through UI-M8, UI-R1 approved; released as v2.7.1–v2.7.4 (commits `2065db7` to `3399022`). |
| G4 | Auth & onboarding approach decided | **verified** | Decision UI-D8 in DECISIONS.md: preserve existing auth (email/password, guest, magic link), defer Google sign-in and account linking to future scope. |
| G5 | Stable release with ≥2 field tests | **deferred** | No field tests have occurred. Appended to PHYSICAL_CHECKLIST.md. |
| G6 | Privacy policy, consent flows and retention job live | **partially verified** | Consent RPCs (set_consent, get_my_consents) verified in V2_VERIFY.md C28–C32. Retention cleanup via `cleanup_old_games()` verified (C31). Privacy policy is inline, not separately hosted. Full match against code deferred to physical audit. |

**Per the addendum, gates are informational and do not block feature work.** All deferred items recorded in `docs/PHYSICAL_CHECKLIST.md`.

---

## 2. Existing Overlapping Features (claimed vs. found)

| Feature area | Status | Evidence (file:line or migration) |
|---|---|---|
| **Host kick** | **Implemented** | `app/lobby/[id].tsx:96,336–340` — `kick_player` RPC, confirmation UI, kicked-player realtime listener. |
| **Rematch** | **Implemented** | Migration `20261030002000_m7_rematch.sql`; `rematch_game` RPC; tested in sim. NF-03 becomes an audit + role rotation enhancement. |
| **Replay sharing** | **Implemented** | `app/replay/[id].tsx:22,315` — uses `expo-sharing`; `app/result/[id].tsx:236,1385` — share from result screen. |
| **Route sharing choice (C3)** | **Implemented** | `app/lobby/[id].tsx:527–598` — mandatory share/private choice before ready-up. V2_VERIFY.md C29 verified. |
| **Export my data** | **Implemented** | `20261101001000_v2m1_consent_rpcs.sql:142,148` — `export_my_data` RPC; `20261101003000_v2m1_export_fix.sql`. |
| **Delete my data** | **Implemented** | `20261101001000_v2m1_consent_rpcs.sql:500–506`; `app/settings.tsx:30` — DELETE confirmation flow. V2_VERIFY.md C32 verified. |
| **Ghost contribution flow** | **Implemented** | `20261107000000_v2m7_ghost_library.sql` — contribution, 150m trimming, self-service listing/deletion; `app/privacy.tsx` — UI for delete_my_ghosts. V2_VERIFY.md C24–C27. |
| **Leaderboard (Ghost Duel)** | **Partially implemented** | `20261114000000_b6_ghost_duel_schema.sql:39–109` — `ghost_duel_scores` table, `get_ghost_duel_leaderboard` RPC. **Hidden in UI** per VM2 decision. Lacks: 6h delay, daily cap, report/block gate, name uniqueness, profanity filter. See §4. |
| **Consent C5 (leaderboard name)** | **Implemented** | `app/privacy.tsx:260–263` — opt-in toggle for "Public leaderboard name". `get_ghost_duel_leaderboard` masks to 'Anonymous Runner' when consent ungranted (DECISIONS.md, V2_VERIFY.md C28). |
| **Metric/imperial units** | **Implemented** | `app/settings.tsx:28` — `useUnits()` hook; test:routes verifies formatting at lines 55–56 (km ↔ mi, km/h ↔ mph). |
| **SOS emergency beacon** | **Implemented** | `20261031002000_m8_sos.sql`; `app/game/[id].tsx:540`. V2_VERIFY.md C40 verified. |
| **Force start** | **Implemented** | `20261031001000_m8_force_start.sql`. |
| **Cancel game** | **Implemented** | `20261031000000_m8_cancel_game.sql`. |
| **Sound engine** | **Implemented** | `src/lib/audio.ts` — 9 SFX via `expo-audio` (ping, heat_hot, heat_cold, tag, whisper, victory, defeat, countdown, scan_success); `assets/sounds/*.wav` — 9 WAV files; mute toggle persisted. V2_VERIFY.md C17 verified. |
| **Haptic engine** | **Implemented** | `src/motion/haptics.ts` — 9 haptic patterns (pingArrival, tagConfirmed, heatHot, heatCold, roleReveal, buttonTap, error, sosTrigger, noiseWarning); enable/disable toggle; `app/settings.tsx:40,56` — settings UI. V2_VERIFY.md C34 verified. |
| **Offline handling** | **Partial** | GameShell.tsx shows "RADAR LINK OFFLINE" with retry. No persistent action queue (positions dropped on failure, next fix wins per DECISIONS.md). NF-34 may be needed. |
| **Push notifications** | **Not implemented** | `app/(onboarding)/signup/before-you-play.tsx:3,37` — requests notification permission but only for local permissions gate, not FCM. No expo-notifications push token flow. |
| **Team Radio / Chat** | **Not implemented** | No chat tables, no message RPCs, no chat UI. |
| **Report / Block** | **Not implemented** | No report or block tables, RPCs, or UI. |
| **Badges** | **Not implemented** | No `player_badges` table or badge logic. |
| **Invite links** | **Partial** | `app/join.tsx:31` — deep link handler for `ghost-run://join`; `app/(onboarding)/signup/account.tsx:271` — deep link reference. No share-sheet invite flow, no App Links web verification. |
| **Feature flags / remote config** | **Not implemented (client)** | Server has `app_settings` table with feature flags per mode/modifier. No client remote-config fetch or feature gate system. |
| **i18n / string table** | **Not implemented** | Strings are inline throughout all `.tsx` files. No i18n framework, no central string table. |
| **Analytics / crash reporting** | **Not implemented** | No Sentry, no analytics provider, no crash reporting SDK. |
| **TTS / spoken narration** | **Not implemented** | No `expo-speech` or TTS imports anywhere. |

---

## 3. Foundation Status (NEW_FEATURES.md §10.3)

| # | Foundation | Status | Notes |
|---|---|---|---|
| 1 | String table and i18n scaffolding | **not started** | All strings inline. Needed before NF-20. |
| 2 | Analytics and error reporting layer | **not started** | Needed for NF-17. No provider chosen. |
| 3 | Push infrastructure | **not started** | Notification permission requested but no FCM/Expo push token flow. Needed for NF-12. |
| 4 | Image rendering pipeline | **not started** | No card generation. Needed for NF-10, NF-15. |
| 5 | Username system and moderation tables | **partial** | Profiles have `display_name` (no unique constraint found). No handle system, no profanity filter, no moderation tables. |
| 6 | Realtime scaling plan | **not started** | Current approach uses `postgres_changes` which won't scale past ~50 players. |
| 7 | Admin RPCs and admin page | **not started** | No admin UI. Server has some admin-level RPCs (feature flags in `app_settings`). |
| 8 | Auth upgrade (Google, emailed code) | **deferred** | Decision UI-D8: existing auth preserved, Google deferred. |
| 9 | Remote config for seasons/banners | **not started** | No `seasons` or `banners` table. |

---

## 4. Leaderboard Audit (NF-14 vs. existing Ghost Duel leaderboard)

| Rule (from NF-14 & Addendum C.1) | Current status |
|---|---|
| Opt-in consent (C5) | ✅ Implemented — `leaderboard_name` consent toggle in privacy.tsx; `get_ghost_duel_leaderboard` masks when ungranted. |
| Handle or display name only | ⚠️ Shows `display_name` (not a handle). No uniqueness constraint. No profanity filter. |
| Never show where or when played | ⚠️ `get_ghost_duel_leaderboard` takes `(lat, lng, radius_m)` — location-scoped by design, which reveals approximate area of play. |
| Updates delayed ≥6 hours | ❌ No delay — scores written immediately on game end, leaderboard reads live. |
| Eligibility gates (min players, length, distance) | ❌ No gates — any completed ghost duel round produces a score. |
| No mock-location or vehicle-speed rounds | ❌ No mock-location detection or speed filtering for leaderboard eligibility. |
| Daily caps | ❌ No daily cap on leaderboard-eligible games per player. |
| Report and removal of abusive names | ❌ No report flow, no block system (NF-08 not built). |
| Country flag separate opt-in | ❌ No country flag feature. |

**Recommendation:** Keep the Ghost Duel leaderboard **hidden in UI** (as it is now) until NF-08 (report/block) is built and the above gaps are addressed. Record in DECISIONS.md.

---

## 5. Baseline Test Results

### TypeScript (`npx tsc --noEmit`)
```
Exit code: 0
(no output — zero errors)
```

### Test: Routes (`npm run test:routes`)
```
All 57 route resolution, deep linking, unit and accessibility checks passed successfully.
```

### Test: Theme (`npm run test:theme`)
```
All 15 theme persistence and Light/Dark checks passed successfully.
```

### Test: Wizard (`npm run test:wizard`)
```
All 16 wizard payload & compatibility snapshot checks passed.
```

### Test: Tour (`npm run test:tour`)
```
All tour engine checks passed successfully.
```

### Test: Registry (`npm run test:registry`)
```
All registry drift checks passed.
```

### Jest
```
No test files found, exiting with code 0.
(Project uses custom test scripts, not Jest test files)
```

### RLS Check (`npm run rls`)
**not run** — requires live Supabase credentials. Deferred to physical testing.

### Simulator (`npm run sim`)
**not run** — requires live Supabase credentials. Deferred to physical testing.

### Lint (`npx expo lint`)
**not run** — not a blocking baseline. Can run on request.

**Summary:** All 6 runnable test suites pass. No baseline failures. RLS and sim deferred to physical device testing.

---

## 6. Client Deny List

Per DECISIONS.md UI-D2 and Addendum B, the following are hidden from all mode-dependent features:

| Mode/Modifier | Reason |
|---|---|
| `haunted_map` | Server-simulated NPC patrol engine; never approved; flag `false` |
| `horde` | Future scope; server swarm simulation; never implemented |
| `manhunt` | Marketing copy only; no programmatic engine |
| `qr_tagging` | Feature flag `false`; pending outdoor camera reliability testing |

---

## 7. Decisions Required

### F-D1: Target audience — friends only or public release?
**Recommendation:** Friends first. Public changes the weight of leaderboards, moderation, monetisation and legal review. Adopt this unless you say otherwise.

### F-D2: Text chat — build it or not?
**Recommendation:** Yes, but only after NF-08 (report/block) exists. Matches NF-07 dependency.

### F-D3: Voice chat?
**Recommendation:** No. Per "Not recommended" section and Addendum B.

### F-D4: Leaderboards?
**Recommendation:** Only after Wave 2 (NF-08 proven), opt-in, with the design rules in NF-14. Keep Ghost Duel leaderboard hidden until then.

### F-D5: iOS timing?
**Recommendation:** After Wave 3, unless several friends use iPhones.

### F-D6: Analytics and crash provider?
**Recommendation:** Sentry (free tier, opt-in, DPA available). Disclose in privacy policy. Decide when NF-17 is in scope.

### F-D7: Website stack and domain?
**Recommendation:** Next.js static site on a domain you own, with App Links verified. Decide when NF-19 is in scope.

### F-D8: Languages to support first?
**Recommendation:** Decide from where your players are. English first, then Hindi if India is the main audience.

### F-D9: Monetisation?
**Recommendation:** Skip until a public launch. Adopt this.

### F-D10: Age policy?
**Recommendation:** Keep 18+ or supervised by a guardian. Per Addendum B. Adopt this.

### F-D11: Auth approach for new players (NF-29)?
**Recommendation:** Defer Google sign-in until you can set up GCP OAuth client, release keystore SHA-1, and provider settings. Keep existing email/password + guest. Per Decision UI-D8. Adopt this.

### F-D12: Friends and presence (NF-30)?
**Recommendation:** After report/block (NF-08). Presence opt-in, off by default.

### F-D13: Seasons and promo banners (NF-31)?
**Recommendation:** Build alongside or after leaderboards. Not before.

### F-D14: In-app review prompt (NF-32)?
**Recommendation:** Yes, once per version after a positive moment. Low risk.

### NF-33: Spoken narration for AI Game Master?
**Status:** Not started. No `expo-speech` in the codebase.
**Recommendation:** Approve as a low-risk, accessibility-friendly feature. On-device TTS (`expo-speech`) reading existing deterministic event text, off by default, with a toggle, no network, no microphone, no voice chat. Spec needed. Candidate for Wave 4 alongside NF-25 accessibility extras.

### NF-34: Offline action queue and tracking resilience?
**Status:** Current approach is "latest fix wins" — failed uploads are dropped in favour of the next fix (per DECISIONS.md). GameShell shows "RADAR LINK OFFLINE" with retry button but no persistent queue.
**Recommendation:** The current design is intentional (see DECISIONS.md "no 50-point offline queue"). **Do not build** unless field testing proves that the current approach causes unacceptable data loss. Mark as `deferred` pending field test evidence.

### NF-35: Sound and haptic engine completion?
**Status:** Sound engine covers 9 SFX events (ping, heat_hot, heat_cold, tag, whisper, victory, defeat, countdown, scan_success). Haptic engine covers 9 events (pingArrival, tagConfirmed, heatHot, heatCold, roleReveal, buttonTap, error, sosTrigger, noiseWarning). Both have mute/disable toggles.
**Gaps found:** No zone entry/exit cue, no ping sweep directional cue, no rescue-hold countdown audio, no tag cooldown tick. These are polish items, not blockers.
**Recommendation:** Mark as `deferred` — the engine is functional. Add missing cues as part of mode-specific work or NF-25 accessibility extras.

### NF-36: Community rule packs (data only)?
**Status:** Not started. No pack schema.
**Recommendation:** Low priority. Needs NF-08 moderation first. Defer to Wave 5 at earliest.

---

## 8. Wave Ordering (recommended)

Per NEW_FEATURES.md §11, adjusted for addendum:

| Wave | Theme | Features |
|---|---|---|
| 0 | Delivered | ✅ Sign-up, Briefing tour, hero home, code boxes, host wizard, tabs, case file, settings |
| 1 | Easy to start | NF-04 (Ready Check), NF-05 (Silent alerts), NF-06 (Safety check-in), NF-03 (Rematch audit + role rotation), NF-02 (Invite links, needs NF-19 minimal) |
| 2 | Social glue | NF-08 (Report/block), NF-07 (Radio), NF-09 (Boundary options), NF-10 (Round card), NF-11 (Badges), NF-17 (Analytics), NF-18 (Feedback), NF-32 (Review prompt) |
| 3 | Retention | NF-12 (Push), NF-31 (Seasons), NF-30 (Friends), NF-13 (Scheduled), NF-15 (Recap), NF-16 (Crews), NF-14 (Leaderboards — last) |
| 4 | Reach | NF-19 (Website), NF-20 (i18n), NF-21 (iOS), NF-22 (Discord), NF-25 (Accessibility), NF-26 (Admin console), NF-33 (TTS narration) |
| 5 | Scale | NF-23 (Events), NF-24 (Wear OS), NF-27 (Video export), NF-28 (Monetisation), NF-36 (Rule packs) |

**NF-01 (Demo round)** excluded from Wave 1 because it depends on the NPC engine which is hidden per Addendum B (bots reuse ghost/NPC movement). Recommend deferring until the NPC engine is approved and field-tested.

**NF-29 (Google sign-in)** deferred per Decision UI-D8 until human setup is done.

**NF-34 (Offline queue)** deferred pending field test evidence.

**NF-35 (Sound/haptic)** deferred — engine is functional, missing cues are polish.

---

## 9. Summary

- **All 6 runnable test suites pass** with zero failures.
- **No baseline regressions** to record.
- **Key overlapping features already built:** host kick, rematch, replay sharing, route sharing choice, export/delete, ghost contribution, Ghost Duel leaderboard (hidden), SOS, sound engine, haptic engine, metric/imperial units.
- **Key features NOT built:** report/block, chat, badges, push, invite share-sheet, feature flags client, i18n, analytics, TTS, offline queue.
- **Leaderboard should stay hidden** until NF-08 and the design rules are met.
- **NF-01 deferred** due to NPC dependency.
- **Next task:** First feature from Wave 1 (recommend starting with NF-04 Ready Check or NF-05 Silent alerts — no dependencies, high value).
