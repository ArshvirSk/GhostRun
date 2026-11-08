# Agent Prompt 05 — GhostRun: new features (post-modes backlog)

## Session start protocol (do this first, every time you receive this prompt)

This prompt may be pasted into a brand-new chat part-way through the work, so never assume a fresh start.

1. Read `docs/PROGRESS.md` (create it if it is missing), `docs/DECISIONS.md` and `git log --oneline -30`. Work out which tasks of this prompt were already reported and approved by me.
2. Tell me in two or three lines: the last approved task, the next task, and any open questions. If the records are missing or ambiguous, ask me which task to resume. **Never redo an approved task and never skip ahead.**
3. Do only the next unfinished task, then STOP and wait for my "go".
4. Keep `docs/PROGRESS.md` current: one line per task with the date, task id, status word, and my approval state (`pending`, `approved` or `rejected`). Update it when I answer.
5. If I write "continue from <task>", trust me, record it in `docs/PROGRESS.md`, and carry on from there.
6. **Required document:** `docs/NEW_FEATURES.md`. If it is missing, tell me and stop. Every other document named in this prompt is optional and may not exist yet (the audits that create them may run later). If one is missing, say so in one line and continue without it.

## Role

You are a senior mobile and backend engineer extending **GhostRun** (Expo + React Native + Supabase) with the features in `docs/NEW_FEATURES.md` (Revision 2) **plus the addendum in this prompt**. Where the addendum and the document differ, **the addendum wins**. You work **one feature at a time**, spec first, with evidence-based reports and hard stops. You do not choose the order or the scope on your own.

## Physical checks and audits are deferred (nothing in this prompt blocks on them)

I will run the audits and all physical device checks **after** this work, so none of it may stall you.

1. Never ask me to test on a device, capture screenshots, or confirm a field test, and never wait for those results. Never block a milestone on them.
2. Whenever something needs a device, an account or another human step, mark it `deferred` (not `done`, not `failed`) and append it to `docs/PHYSICAL_CHECKLIST.md` (milestone, what to check, how, expected result). Then continue.
3. Acceptance for every milestone means everything an agent can verify itself passes: typecheck, lint, unit tests, snapshot tests, route tests, `npm run rls`, `npm run sim`, static checks, and the gallery rendering. Device items are listed but do not gate.
4. If a baseline check (`rls`, `sim` or tests) already fails before your changes, record it as a **known baseline failure** with the output, do not fix unrelated failures, and make sure your changes add **no new failures**.
5. When a decision is needed, state your recommendation and trade-off. If I reply "go" without answering it, **adopt your recommendation**, record it in `docs/DECISIONS.md`, and continue. You must still stop for: the **spec of each feature** (Task Fx.1), server changes, new dependencies, auth changes, third-party accounts, and anything outward-facing (push, tag, release, `db push`).
6. The modes audit may not have happened yet. Build every mode-dependent feature (recaps, seasons, leaderboards, share cards) against the server catalogue and the registry, never against a hard-coded mode list, and **always exclude `haunted_map`, `horde` and any mode that depends on server-simulated NPCs with a client-side deny list**, even if a server flag is on. Record the deny list in `docs/DECISIONS.md` so the later audit can remove it. Do not treat any mode as verified.

## Read first

1. `docs/NEW_FEATURES.md`: your backlog, with IDs (NF-01 to NF-32), waves, rules, risks and decisions F-D1 to F-D14.
2. `docs/UI_RESTRUCTURE.md`, `docs/MODE_STATUS.md`, `docs/MODES.md`, `docs/TRD.md`, `docs/FLOW.md`, `docs/V2_VERIFY.md`, `docs/DECISIONS.md`.
3. The repository: `supabase/migrations/`, `scripts/rls-check.ts`, `scripts/sim/`, `app/`, `src/`, `README.md`, `package.json`.

If an optional document is missing, continue. If a document and the repo conflict in a way that changes the design, state your recommendation, record it in `docs/DECISIONS.md`, and continue. Do not stall.

## Addendum A: current-state facts (from a recent summary, every item is unverified: confirm each in F0)

- **Auth already includes** email OTP or magic link, guest sign-in, and a password-reset deep link. So NF-29 shrinks to **Google sign-in and account linking**, and only if I approve it.
- **Join codes** are 4 characters.
- **Ghost Duel already has leaderboards**, and display names are not guaranteed unique. NF-14 therefore starts as an **audit and gate of what exists**, not a new build.
- The server already exposes `mode_catalogue()`, `modifier_catalogue()` and `role_catalogue()`.
- **Settings already has a metric or imperial units switch.** Do not rebuild it.
- A recent summary lists as "remaining": tournaments, streamer mode, venue partnerships, a Discord bot, community rule packs, spoken narration (text-to-speech) for the AI Game Master, a sound and haptic engine, an offline action queue, iOS, and push notifications. **Earlier reports contradicted this** for the sound engine and the offline queue (they were claimed as built). Verify the real status before listing either as a feature.
- Several backlog items are probably already partly present (for example host kick, replay sharing choice, export and delete, ghost contribution flow). F0 must list them.

## Addendum B: standing decisions

1. **AI and NPC-driven modes are future scope and hidden** (for example `haunted_map`, `horde`, anything needing server-simulated NPCs). Do not implement or expand them. **AI modifiers are allowed** (`ai_gm`), as a deterministic server-side engine with no external AI or language-model call from the app, and with no secrets or positions ever fed to a language model.
2. Policy is **18 or older, or playing under a guardian's supervision**. No separate under-18 handling.
3. Only modes I approved to ship appear in features that list modes (recaps, leaderboards, seasons, banners, share cards).

## Addendum C: changes and additions to `NEW_FEATURES.md`

1. **NF-14 (leaderboards) becomes "verify and gate existing leaderboards".** The rules in the document still apply: opt-in consent, handle or display name only (never where or when someone played), updates delayed at least 6 hours after a game ends, eligibility gates, no mock-location or vehicle-speed rounds, daily caps, report and removal of abusive names. Recommend hiding the existing leaderboards until report and block (NF-08) and a uniqueness rule for names exist. A country flag stays a separate opt-in.
2. **NF-29 shrinks** to Google sign-in and account linking (optional, needs human setup: Google Cloud OAuth client, release keystore SHA-1, provider settings, email limits or custom SMTP). Existing methods stay.
3. **NF-33: Spoken narration for the AI Game Master** (new, candidate). On-device text-to-speech reading the **existing** deterministic event text, off by default, with a toggle, no network, no microphone, and a clear note that it is not voice chat. Needs a spec and the privacy and accessibility review.
4. **NF-34: Offline action queue and tracking resilience** (new, candidate). Only if F0 proves the current queue is missing or weak. Covers queuing `submit_position` and action calls during poor signal and replaying them safely (idempotent, stale actions dropped, no gameplay exploit).
5. **NF-35: Sound and haptic engine completion** (new, candidate). Only if F0 proves gaps (ping sweep, heat cues, tag cue, zone cues). Must honour mute and haptics toggles and the reduced-motion and accessibility rules.
6. **NF-36: Community rule packs (data only)** (new, low priority). Packs are **validated data** composed from existing mechanics (parameters, item pools, curfews, text). **Never scripts or code**, no "objective scripts". Needs moderation (NF-08) first.
7. **Mapping of the "remaining" list to backlog items:** tournaments and spectator dashboard and streamer mode map to NF-23 (event mode) and the spectator feed in `MODES.md` 8.1 and 8.2. A Discord bot maps to NF-22. iOS maps to NF-21. Push maps to NF-12. Venue partnerships have no item and stay out of scope until I ask.
8. **Entry gates are informational, not blocking.** The audits and field tests happen after this prompt. Record the status of G1 (modes verified), G2 (recovery approved), G5 (field tests) and G6 as `deferred` and continue. The only hard prerequisite is that the UI redesign (prompt 04, gate G3) is complete for features that need the new screens. If it is not, tell me which features are affected and propose building them on the current screens.

## Working rules (hard)

1. **STOP gates.** Every task ends with a **STOP**. After a STOP, send your report and take **no further action** until I reply with an explicit "go".
2. **One task per reply.** Never combine tasks, features or waves.
3. **Evidence, not summaries.** Every claim needs a commit hash, file path and line range, or **pasted raw command output**. If you did not run it, say "not run".
4. **Honest status words only:** `verified`, `claimed`, `failed`, `not run`, and `deferred` (needs a device or another human step, tracked in `docs/PHYSICAL_CHECKLIST.md`). Never use "done" for anything involving a physical device, a store, a third-party account or my approval.
5. **No outward actions without approval:** no `git push`, no tags, no releases, no `supabase db push`, no changes to the live database, no third-party account creation, no sending real emails or push notifications. Work on a local branch named `feat/<NF-id>-<short-name>` and show me the diff summary.
6. **Server changes need an approved spec first.** Migrations are new numbered files, never edits to applied ones. You may write them locally, but applying them to the hosted database requires my explicit "go".
7. **Secrecy and privacy are non-negotiable.** Game logic stays in `SECURITY DEFINER` functions (`set search_path = public, extensions`). Clients are SELECT-only through RLS. Any view exposing data applies its own membership and team filter. No secrets in the app or repo. No precise coordinates sent to third-party services.
8. **No new dependencies or paid services without asking** (analytics, crash reporting, push, hosting, domains).
9. **No Docker, no local Supabase.** Use the hosted project and `supabase db push` only after approval.
10. **Feature flags.** Every feature ships off by default behind a server-side flag.
11. **No scope creep.** Do not implement items from section 9 of `NEW_FEATURES.md` ("Not recommended") or anything not in the approved spec.
12. **Report secrets by path and pattern only, never values.**
13. **Originality.** Do not copy another app's name, logo, colours, type pairing, illustrations, copy lines, badges or screen compositions. Take **patterns** only. Fonts and assets must be open-licensed with the licence recorded.
14. **Auth and accounts.** Never lock out or alter existing accounts. Any authentication change needs an approved spec, explicit approval, and a list of the human setup steps before you write code.

## Task structure (repeat for each feature I approve)

### Task F0: Readiness audit (once, before any feature)
Produce `docs/FEATURES_READINESS.md`:
- Report each entry gate G1 to G6 in `NEW_FEATURES.md` with a status word and evidence. **G3 means the UI restructure and redesign (`UI_RESTRUCTURE.md` Phases 1 and 2, including the new sign-up flow and Briefing tour). G4 means the auth and onboarding approach was decided.** **Gates do not block you** (Addendum C item 8). Note which features each unmet gate puts at risk.
- List what already exists that overlaps with any NF item, with file paths (host kick, replay sharing, export and delete, ghost contribution, **leaderboards**, any chat-like code, any offline queue, any sound or haptic engine, any narration code, any units handling).
- Confirm the status of the foundations in section 10.3 of the document as present, partial or missing (string table, analytics layer, push, image rendering, handles and moderation tables, realtime scaling, admin RPCs, auth upgrade, remote config for seasons and banners).
- **Leaderboard audit:** compare the existing leaderboards with the NF-14 rules and list every missing protection.
- Paste baseline output of `npm run typecheck`, `lint`, unit tests, `npm run rls` and `npm run sim` (any existing failure is recorded as a known baseline failure, not fixed).
- Ask me for decisions **F-D1 to F-D14** with your recommendation and trade-off for each, plus decisions on the new candidates NF-33 to NF-36.

**STOP.** Wait for "go". Adopt your recommendation for any decision I do not answer, and record it in `docs/DECISIONS.md`.

### Task Fx.1: Spec (per feature)
Write `docs/specs/NF-xx.md` containing:
- Goal, user stories and the exact scope for this feature (v1 only).
- Rules and parameters with defaults.
- Data model changes (tables, columns, indexes), RLS policies, RPC signatures, events.
- UI: where it lives in the current navigation, screens, states (loading, empty, error, offline), strings.
- **Privacy review:** data collected, who can see it, retention, deletion path in `delete_my_data()`, consent or policy changes required (and the exact wording changes).
- **Safety and abuse review:** what could go wrong and the mitigation.
- Test plan: `rls-check` rows, `sim` scenarios, unit tests, device checks for me.
- Rollout: flag name, default state, rollback.
- Effort estimate and dependencies, and anything you want me to decide.

**STOP.** Wait for my approval of the spec.

### Task Fx.2: Implement (per feature, after spec approval)
- Implement on the feature branch with small commits.
- Add migrations locally, tests, strings, flags, docs.
- Run the full check set and **paste the output**: typecheck, lint, unit tests, `npm run rls`, `npm run sim`.
- Do **not** apply migrations to the hosted database yet.
- Append a short device checklist to `docs/PHYSICAL_CHECKLIST.md`. Do not wait for device results.

**STOP.** Report and wait for "go" to apply migrations. Device test results are not required.

### Task Fx.3: Apply and verify (after "go")
- Apply the migration to the hosted project only when I say so. Paste the migration list before and after.
- Re-run `rls` and `sim` against the hosted project. Paste output.
- Update `README.md`, `docs/DECISIONS.md`, `docs/PLAYTEST.md`, and the privacy policy text if the spec requires it.
- Leave the feature flag **off**. I will turn it on after my field test.

**STOP.** I decide whether it ships.

## Per-wave guidance (follow my chosen order, not yours)

- **Wave 0 (delivered by the redesign, not by this prompt):** the sign-up flow, Briefing tour, hero home, code boxes, host wizard, tabs, case file and settings come from `UI_RESTRUCTURE.md`. Do not rebuild them.
- **Wave 1 (NF-29 if approved, NF-04, NF-05, NF-06, NF-03, NF-02):** lowest risk, highest value. NF-29 needs human setup and must keep existing accounts working. **NF-01 (demo round against bots) is NPC-driven, so it is deferred with the other NPC work** and is skipped unless I say otherwise. The Briefing tour from the UI work already teaches the game without NPCs.
- **Wave 2 (NF-08, NF-07, NF-09, NF-10, NF-11, NF-17, NF-18, NF-32):** **NF-08 (report, block, moderation) must be built and approved before NF-07 (Radio).** NF-10 must trim 150 m from both ends of the route, blur or remove street labels, preview before sharing, and respect C3. NF-09 must implement live reveal as scheduled pings, never by loosening RLS on `player_positions`. NF-17 is consent-gated (C7) and must never include coordinates, names or free text. NF-32 must never prompt right after a bad experience and must not attach coordinates.
- **Wave 3 (NF-12, NF-31, NF-30, NF-13, NF-15, NF-16, NF-14):** NF-31 (seasons and banners) must never carry ads or tracking links. NF-30 (friends and presence) comes only after report and block, with presence **opt-in and off by default**, exposing only the lobby code and mode, never any location. NF-14 is the leaderboard gate described in Addendum C item 1.
- **Wave 4 (NF-19, NF-20, NF-21, NF-22, NF-25, NF-26, NF-33 if approved):** for NF-21 (iOS), produce a **plan only** first and wait for approval. NF-20 (localisation) starts only after copy is stable, and safety copy translations are safety-critical. NF-33 is on-device text-to-speech only, off by default.
- **Wave 5 (NF-23, NF-24, NF-27, NF-28, NF-34, NF-35, NF-36):** NF-23 requires a **realtime scaling plan and a 100+ player simulator load test** before any capacity claim. NF-24 is research only. NF-28 is a business decision. NF-34 and NF-35 only if F0 proves they are needed. Do not start any of these without my explicit instruction.

## Definition of done (per feature)

- Spec approved, flag added and off by default, consent and policy updated first where data use changes.
- RLS rows and simulator scenarios added and passing, with pasted output.
- Strings in the string table, accessibility checked, no flashing visuals.
- Retention and deletion paths cover all new data.
- Docs updated, and a device checklist prepared.
- All agent-verifiable checks pass. Device verification is `deferred` and tracked in `docs/PHYSICAL_CHECKLIST.md`. **You never declare a feature "shipped". I do that after my physical checks.**

## Reporting format (every task)

```
Task: F0 or NF-xx.#  |  Status words only: verified / claimed / failed / not run
Evidence: (commit hashes, file:line, pasted raw output)
What changed (branch, commit list, diff summary), or "nothing changed":
Privacy and safety notes:
Tests run and results (pasted):
Deferred (appended to `docs/PHYSICAL_CHECKLIST.md`):
Questions or conflicts:
Needs from you:
Waiting for your "go". I will take no further action.
```

## What NOT to do

- Do not start any feature before F0 is approved and I name the feature.
- Do not implement or expand AI or NPC-driven modes. Do not add any external AI or language-model call.
- Do not implement voice chat, public matchmaking, cross-team chat, ads, betting, user-scripted modes (rule packs are data only), child-directed features, separate under-18 account handling, or social feeds.
- Do not weaken RLS or add client-side table reads to make a feature easier.
- Do not push, tag, release, apply migrations to the hosted database, or contact third-party services without approval.
- Do not store or transmit precise coordinates outside Supabase, and never put coordinates in analytics, feedback or share images beyond what the approved spec allows.
- Do not describe anything as "done" or "signed off" when it needs a device, an external account or my approval.

## First step

Follow the session start protocol. If nothing has been approved yet, do **F0** only: reply with the readiness audit and the decisions F-D1 to F-D14 (plus NF-33 to NF-36) with your recommendations, then wait for my "go". After F0, start a feature when I name it, and always start it with its spec task. If I say "go" without naming a feature, take the next unfinished feature in the wave order below, one at a time, spec first.
