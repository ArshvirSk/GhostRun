# Agent Prompt 04 — GhostRun: UI restructure and redesign (v2.5 → v2.6)

## Session start protocol (do this first, every time you receive this prompt)

This prompt may be pasted into a brand-new chat part-way through the work, so never assume a fresh start.

1. Read `docs/PROGRESS.md` (create it if it is missing), `docs/DECISIONS.md` and `git log --oneline -30`. Work out which tasks of this prompt were already reported and approved by me.

1. Tell me in two or three lines: the last approved task, the next task, and any open questions. If the records are missing or ambiguous, ask me which task to resume. **Never redo an approved task and never skip ahead.**

1. Do only the next unfinished task, then STOP and wait for my "go".

1. Keep `docs/PROGRESS.md` current: one line per task with the date, task id, status word, and my approval state (`pending`, `approved` or `rejected`). Update it when I answer.

1. If I write "continue from <task>", trust me, record it in `docs/PROGRESS.md`, and carry on from there.

1. **Required document:** `docs/UI_RESTRUCTURE.md`. If it is missing, tell me and stop. Every other document named in this prompt is optional and may not exist yet (the audits that create them may run later). If one is missing, say so in one line and continue without it.

## Role

You are a senior React Native / Expo engineer and product-minded UI engineer. You will restructure and then **redesign** the navigation, screens, onboarding and visual system of **GhostRun** (reported as v2.5.0) according to `docs/UI_RESTRUCTURE.md` (Revision 2) **plus the addendum in this prompt**. Where the addendum and the document differ, **the addendum wins**.

Two phases:

- **Phase 1: Foundations.** Behaviour-preserving. No visible redesign.

- **Phase 2: Identity and new screens.** A new visual identity, animated onboarding and new screens, **built once** in the new look.

Gameplay, server logic and secrecy do not change.

## Physical checks and audits are deferred (nothing in this prompt blocks on them)

I will run the audits and all physical device checks **after** this work, so none of it may stall you.

1. Never ask me to test on a device, capture screenshots, or confirm a field test, and never wait for those results. Never block a milestone on them.

1. Whenever something needs a device, an account or another human step, mark it `deferred` (not `done`, not `failed`) and append it to `docs/PHYSICAL_CHECKLIST.md` (milestone, what to check, how, expected result). Then continue.

1. Acceptance for every milestone means everything an agent can verify itself passes: typecheck, lint, unit tests, snapshot tests, route tests, `npm run rls`, `npm run sim`, static checks, and the gallery rendering. Device items are listed but do not gate.

1. If a baseline check (`rls`, `sim` or tests) already fails before your changes, record it as a **known baseline failure** with the output, do not fix unrelated failures, and make sure your changes add **no new failures**.

1. When a decision is needed, state your recommendation and trade-off. If I reply "go" without answering it, **adopt your recommendation**, record it in `docs/DECISIONS.md`, and continue. You must still stop for: server changes (a written spec first), new dependencies, auth changes, third-party accounts, and anything outward-facing (push, tag, release, `db push`).

1. The modes audit may not have happened yet. Use the server catalogue functions and flags as the source of what exists, and **always hide ****`haunted_map`****, ****`horde`**** and any mode that depends on server-simulated NPCs with a client-side deny list**, even if a server flag is on. Record the deny list in `docs/DECISIONS.md` so the later audit can remove it. Do not treat any mode as verified.

## Read first

1. `docs/UI_RESTRUCTURE.md` (Revision 2): your main spec. Use its section numbers.

1. `docs/UI_RESTRICTIONS.md`: mandatory Afterimage visual, light/dark, responsive-layout, and accessibility constraints. It supplements the main spec; it does not authorize gameplay or server changes.

1. `docs/MODE_STATUS.md` and `docs/FIELD_TEST_PLAN.md` (**optional**: they may not exist yet), `docs/MODES.md`, `docs/NEW_FEATURES.md`, `docs/TRD.md`, `docs/FLOW.md`, `docs/V2_VERIFY.md`, `docs/DECISIONS.md`.

1. The repository: `app/`, `src/`, `scripts/`, `supabase/migrations/` (read only), `package.json`, `app.json`, `README.md`.

If an optional document is missing, continue. If the spec and the repo conflict in a way that changes the design, state your recommendation, record it in `docs/DECISIONS.md`, and continue. Do not stall.

## Addendum A: current-state facts (from a recent summary, every item is unverified: confirm each in UI-M0)

- **15 screens:** `/` (session router), `/welcome` (display name and an 8-colour picker, "Enter the Grid"), `/auth` (email OTP or magic link, guest sign-in, resend cooldown), `/reset-password` (deep link), `/onboarding` (tutorial carousel, not a permissions flow), `/home` (map canvas, greeting, Create, Join, How to Play, Privacy and Settings, requests foreground location), `/create` (**1,016 lines**, draggable bottom sheet with a pan-gesture conflict against the map, long single scroll of modes, modifiers, roles, parameters), `/join` (**4-character** code inputs with auto-advance and a QR scan toggle), `/lobby/[id]` (**1,357 lines**, roster, teams, replay-sharing sheet, ready, start), `/target/[id]`, `/game/[id]` (**5,215 lines**), `/result/[id]` (stacked cards, ghost contribution prompt), `/replay/[id]` (scrubber, layer toggles), `/settings` (audio, haptics, **metric or imperial units already exist**, battery advice), `/privacy` (also the **first-run gate** at `?mode=gate`, with an 18+ confirmation, consent toggles, export and delete).

- **Auth** today: email OTP or magic link, guest, and a password-reset deep link. It is **not** only email and password.

- **Server catalogue functions** already exist: `mode_catalogue()`, `modifier_catalogue()`, `role_catalogue()`.

- A previous inventory disagreed about where location permissions are requested (onboarding or home). Settle it from the code.

- The sign-up flow collects a display name and a colour, but **no handle**. Ghost Duel leaderboards exist and show names that are not guaranteed unique.

## Addendum B: standing decisions

1. **AI and NPC-driven modes are future scope and hidden** (`haunted_map`, `horde`, and any mode that depends on server-simulated NPCs). The registry, wizard, Modes library and lobby must respect server flags and **never show them**. You may leave flagged placeholders only.

1. AI modifiers such as `ai_gm` may appear if their flag is on.

1. Policy is **18 or older, or playing under a guardian's supervision**. Do not copy another app's under-18 handling.

1. If `docs/MODE_STATUS.md` exists, only modes it lists as shipping appear in the Modes library and wizard. If it does not exist, show the modes the server catalogue reports as enabled, minus the client-side deny list described in the deferred-checks section.

## Addendum C: changes and additions to `UI_RESTRUCTURE.md`

1. **Registry source of truth.** Prefer the **server catalogue functions** as the source for ids, parameters, defaults, ranges, compatibility and flags. In UI-M0 propose either (a) the client registry **reads** the catalogues and adds only presentation (copy, icons, widgets), or (b) a client registry plus a drift test against the catalogues. I decide.

1. **Sprint Mode HUD.** Add a fourth in-game layout option: a simplified, high-contrast HUD with oversized type that shows only the immediately critical inputs (the compass or direction cue, the tag or primary action, the timer, SOS), plus audio and haptic cues. A setting switches it on, and the shell may suggest it when sustained speed is detected. It is a layout, not a new gameplay feature.

1. **Role briefing card.** In the lobby **Rules** segment, add a private card that explains the player's assigned role (for example VIP, Bodyguard, Double Agent, Operator) before ready-up, with an acknowledgement for roles flagged `complexity: high`. The card never shows other players' secrets.

1. **Result and replay polish.** Present the result as a swipeable set of cards instead of a long scroll, with a placeholder slot for a shareable recap card (the feature itself is later). Add **-15 s and +15 s** skip buttons to replay.

1. **Auth framing (decision U-D8).** Existing OTP, magic link, guest and password-reset paths stay. The five-step sign-up is built over them. **Google sign-in and account linking are optional** and need an approved spec and human setup first. Do not remove any existing method.

1. **Join code.** The code is 4 characters today. Do not change its length or the server rules. The code boxes adapt to the configured length. If you believe 4 characters is guessable, report it to me. Do not alter it.

1. **Units** already exist in Settings: reuse them and make sure every distance in the app obeys them.

1. **Welcome colour choice.** The 8-colour picker exists. Decide with me in UI-M0 whether it stays in step 1 of sign-up or moves to You.

1. **Handles.** A handle step creates new data and needs server support (uniqueness, availability check, rules). It needs a written spec for my approval (see UI-M4). Without approval, ship the sign-up with name and colour only.

1. **Bottom-sheet gesture conflict** on create is solved by the wizard (no draggable sheet over the map).

1. **Missing screens** to add as specified in the document: Modes library, You (with history), How to play, Safety, debug HUD gallery.

## Working rules (hard)

1. **STOP gates.** Every milestone ends with a **STOP**. After a STOP, send your report and take **no further action** (no commands, no edits, no commits) until I reply with an explicit "go".

1. **One milestone per reply.** Never combine milestones or declare several done at once.

1. **Evidence, not summaries.** Every claim needs a commit hash, file path and line range, or **pasted raw command output**. If you did not run it, say "not run".

1. **Honest status words only:** `verified`, `claimed`, `failed`, `not run`, and `deferred` (needs a device or another human step, and is tracked in `docs/PHYSICAL_CHECKLIST.md`). Never use "done" for anything involving a physical device, a third-party account, a font or map-tile licence decision, or my approval.

1. **No outward actions without approval:** no `git push`, no tags, no GitHub Releases, no `supabase db push`, no changes to the live database, no creating accounts or OAuth clients. Work on a local branch named `ui/<milestone>` and show me the diff summary.

1. **No server changes** (no migrations, RPC, RLS or schema changes) unless a milestone explicitly says so and I approve a written spec first.

1. **No secrets in output.** Paths and pattern names only.

1. **Small commits** with clear messages. Every milestone leaves the app building and shippable.

1. **No new dependencies without asking** (animation, drawing, fonts, auth libraries). List what you propose, why, size and licence.

1. **Originality.** Do not copy another app's name, logo, colours, type pairing, illustrations, imagery, copy lines or screen compositions. Take **patterns** only (see `UI_RESTRUCTURE.md` 1 and 4.6). Fonts must be open-licensed with the licence recorded.

## Constraints that protect existing behaviour

- Every route reachable today from a notification tap, QR code, deep link, stored state or in-app link must **still resolve** (redirects for at least one release): `/lobby/:id`, `/game/:id`, `/target/:id`, `/reset-password`, `/join` and any others you find.

- Persisted AsyncStorage keys must keep working (migrate if renamed).

- The background location task, realtime subscription and resync must keep working when the app is backgrounded, killed and reopened.

- Payloads to `create_game` and every other RPC must be **identical** to today's for the same player choices.

- Feature flags are respected. A mode or feature whose flag is off appears nowhere in the UI.

- **Existing accounts must keep signing in.**

- No flashing or strobing visuals. Colour is never the only signal. A reduced-motion setting is honoured everywhere.

- Secrecy is unchanged. The client only renders what the server returns, and no component adds a direct table read.

- The Briefing tour makes **no network calls and no location requests**.

## Milestones

### Phase 1: Foundations

#### UI-M0: Audit and baseline (no code changes)

Produce `docs/UI_AUDIT.md` with:

- Every route and screen with file path and **line count**, plus the components, hooks and stores each uses. Confirm or correct everything in Addendum A.

- Deep links, notification tap targets, QR join links and persisted state keys.

- Modes, modifiers and roles **present in the code** versus `docs/MODE_STATUS.md` and `UI_RESTRUCTURE.md` 9.4 (flag extras such as `manhunt`, and anything hidden by flags).

- Auth methods currently supported and what each screen does.

- Counts of hard-coded hex colours, font sizes and spacing literals by file.

- Where mode-specific logic lives in `game/[id].tsx`, `create.tsx`, `lobby/[id].tsx`, `result/[id].tsx`, `replay/[id].tsx`.

- Existing dependencies relevant to motion, fonts, maps and auth, with versions.

- Pasted baseline output of `npm run typecheck`, `npm run lint`, `npm run test:cooldown`, `npm run rls` and `npm run sim` (any existing failure is recorded as a known baseline failure, not fixed).

- Start `docs/PHYSICAL_CHECKLIST.md` with a **golden-path checklist** for me to run on a device later. Do not wait for screenshots or device results.

- Your recommendation and trade-off for each decision **U-D1 to U-D13** in `UI_RESTRUCTURE.md` section 18, and for the items in Addendum C that need my decision (registry source, welcome colour choice, handles, Google sign-in).

**STOP.** Send the report in the format below. Wait for "go".

#### UI-M1: Foundations (no visible change)

- `src/theme/tokens.ts` and `ThemeProvider` with **today's values**, and a `Text` primitive with named variants.

- `src/modes/types.ts`, `registry.ts` (per my decision on Addendum C item 1) and a `ModeModule` for every shipping mode, modifier and role (metadata only), honouring server flags.

- `RulesCard` and `ParamField` generators used first in a hidden dev screen.

- A drift or catalogue-sync test wired into `package.json`.

- **Acceptance:** the app looks and behaves identically, the sync test passes, all baseline checks pass with pasted output.

**STOP.**

#### UI-M2: Game shell and widgets

- `src/game-shell/` with shell, HUD frame, phase banner, SOS sheet, event feed, tracking status, typed `actions.ts` wrappers around existing RPCs, and `selectors.ts`.

- Move each shipping mode's in-game UI into `HudWidget`s under `src/modes/<id>/hud.tsx` (contract in `UI_RESTRUCTURE.md` 8.3). The shell enforces at most three action buttons.

- Role layouts: Runner, Hunter, **Operator console**, **Spectator**, and the **Sprint Mode HUD** (Addendum C item 2).

- Isolate timers and cooldown rings in small components. Memoise map layers.

- Record re-render counts **before and after** using a deterministic test or profiler harness on the same scenario. On-device frame stats are `deferred`.

- **Acceptance:** every enabled mode's in-game features are covered by simulator scenarios and tests where possible, a per-mode manual checklist is appended to `docs/PHYSICAL_CHECKLIST.md`, `game/[id].tsx` has no mode-specific logic, re-render counts are equal or better than baseline in the harness, and existing tests pass with no new failures.

**STOP. Then wait for my "go" to start Phase 2.** U-D7 is already approved as **Afterimage** with System / Light / Dark appearances; do not reopen the palette choice. State your recommendation for U-D8 (auth), U-D9 (fonts), U-D10 (tour map), U-D11 to U-D13, the handle decision and the Google sign-in decision. If I reply only "go", adopt your recommendations (handles and Google sign-in default to "not now") and record them in `docs/DECISIONS.md`.

### Phase 2: Identity and new screens

#### UI-M3: Design system and motion

- Implement the approved **Afterimage** direction from `UI_RESTRUCTURE.md` section 4 and `UI_RESTRICTIONS.md`; do not present alternative palettes or ship a dark-only design.

- Provide **System / Light / Dark** appearance, persist explicit choice, and apply the theme to app chrome, controls, sheets, and maps. Implement semantic light/dark tokens from `UI_RESTRUCTURE.md` 4.2, adjusting only as needed to pass actual contrast checks.

- Preserve palette semantics: spectral violet is brand/ping identity, lime is reserved for action/runner/live/selected states, coral indicates hunters/urgent states, and neutral surfaces dominate. Keep role meaning stable across themes.

- Fonts are bundled only after licences are recorded and any required dependency approval is obtained. Check contrast for normal, selected, disabled, pressed, and warning states in both themes.

- Primitives: `Button`, `Card`, `Chip`, `Sheet`, `Toast`, `CodeBoxes`, `SegmentBar`, `BriefingCard`, plus motion components (`PingRipple`, `RadarSweep`, `GhostEcho`, `CountUp`, `RoleReveal`, `HeatWash`, `StaggerIn`) and the haptics map. Reduced-motion variants for all.

- **Debug HUD gallery** showing every primitive, every role layout (including Sprint Mode) and every shipping mode's HUD from mock state.

- **Tour engine skeleton** (`TourScript`, `TourPlayer`) rendering real widgets from scripted state.

- **Acceptance:** gallery renders in light, dark, and system appearance; explicit choice persists; light and dark maps are legible and retain attribution; contrast and reduced-motion checks pass; layouts survive narrow screens and large text without clipped primary controls; performance is checked in the harness (pasted numbers) with on-device frame rate `deferred`; and there are zero hard-coded hex colours in `src/ui`, `src/motion` and `src/game-shell`.

**STOP.**

#### UI-M4: Onboarding

- Welcome, **five-step sign-up** per `UI_RESTRUCTURE.md` 7.1 built **over the existing auth methods**, the permissions step, and the **Briefing** tour with all 8 beats, skip and replay.

- Handle step only if I approved a written spec. If no server function supports availability checks, **stop and propose a spec** (function, RLS, rate limit, abuse protection). Do not add it silently.

- If I approved Google sign-in or account linking, tell me exactly which human setup steps are needed (OAuth client, fingerprints, dashboard settings, email limits) and wait.

- Marketing consent checkbox unchecked by default. Community rule line and Terms and Privacy links on the account step. Age confirmation text matches the current policy version.

- **Acceptance:** sign-up and tour flows are covered by component and navigation tests, existing sign-in paths are untouched (tests), the reduced-motion variant renders (test), and the tour makes no network or location calls (asserted by a test). The on-device run-through is `deferred`.

**STOP.**

#### UI-M5: Home, join and host wizard

- Play tab, code boxes join (adapts to the configured code length, paste, auto-advance, QR, deep link prefill, wrong-code shake and haptic), five-step host wizard and generic placement step driven by the registry (only shipping modes), redirect for `/target/:id`.

- **Acceptance:** a snapshot test proves the wizard produces the **same ****`create_game`**** payload** as the old form for at least 10 representative choices (each shipping mode, with and without modifiers and roles). Incompatible options are greyed with a reason. Back navigation never loses data. No hidden mode is selectable.

**STOP.**

#### UI-M6: Lobby, tabs and You

- Segmented lobby (Players, Rules, Map) with the **role briefing card**, three-tab floating pill bar (Play, Modes, You), Modes library and detail, You tab with case file and history, Settings split (appearance, units, map style, audio and haptics, notifications, account, contact, version), Privacy split, How to play and Safety pages, copy fixes from `UI_RESTRUCTURE.md` 14.3.

- Units must apply everywhere distances appear. Satellite map only if I approved a licensed source (U-D11).

- **Acceptance:** all old entry points reachable, route-resolution test passes, privacy controls behave exactly as before, units verified on at least five screens.

**STOP.**

#### UI-M7: Result, replay and gallery completion

- Result as swipeable cards with the recap-card placeholder, replay with ±15 s skip, mode sections and layers from the registry, ghost echo on trails, remaining gallery entries, token coverage check across the whole app.

- **Acceptance:** result and replay show the same data as before for every shipping mode, zero hard-coded hex colours outside tokens (or listed exceptions with reasons).

**STOP.**

#### UI-M8: Hardening and release candidate

- Redirect and deep-link tests, an accessibility pass that can be checked statically (touch-target sizes, labels, contrast tokens, reduced-motion handling), regression runs, performance numbers from the harness after motion, a **release candidate** (bump to `v2.6.0-rc1`, update the changelog, and build a local APK with its recomputed SHA-256 only if the environment can build it, otherwise list the exact commands for me; do not publish), `docs/ADDING_A_MODE.md`, README update, a finished `docs/PHYSICAL_CHECKLIST.md`, and `docs/DECISIONS.md` entries.

- **Acceptance:** `npm run typecheck`, `lint`, unit tests, `npm run rls` and `npm run sim` pass with pasted output. Device checks are reported as `not run` until I run them.

**STOP.** Physical checks are mine to do later. This prompt is finished when I say so.

## Reporting format (every milestone)

```
Milestone: UI-M#  |  Status words only: verified / claimed / failed / not run
Evidence: (commit hashes, file:line, pasted raw command output)
What changed (branch, commit list, diff summary):
Behaviour differences found (should be none in Phase 1), or "none found":
Tests run and results (pasted):
Performance numbers (before / after), where required:
Dependencies or licences added or proposed:
Deferred (appended to `docs/PHYSICAL_CHECKLIST.md`):
Questions or conflicts with the spec:
Needs from you:
Waiting for your "go". I will take no further action.
```

## What NOT to do

- Do not start Phase 2 before I answer the Phase 1 gate decisions and say "go".

- Do not show or build UI for hidden AI or NPC modes, or for modes I did not approve to ship.

- Do not add features from `NEW_FEATURES.md` (team radio, leaderboards UI, friends, demo round, share cards, localisation, iOS, monetisation, push, analytics). Leave hidden, flagged placeholders only where the spec says so.

- Do not change gameplay, the server, database, RPC signatures or RLS without an approved spec.

- Do not copy another app's identity (name, logo, colours, type pairing, illustrations, imagery, copy, compositions). Do not use generated or stock imagery. Use vector and procedural art.

- Do not push, tag, publish, build a release, or create OAuth clients or accounts without approval.

- Do not remove old routes without redirects.

- Do not hide a failing test. Report it with the output.

- Do not describe anything as "done", "complete" or "signed off" when it needs a device, a licence decision or my approval.

## First step

Follow the session start protocol. If nothing has been approved yet, state in one line the current git branch, whether the working tree is clean, and the version in `package.json` and `app.json` (informational only: do not ask me about earlier audits or field tests). Then do **UI-M0** only, send the report in the format above, and wait for my "go". After UI-M2, stop and wait for my "go" before UI-M3.
