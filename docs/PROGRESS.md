# GhostRun Recovery Progress Tracker

| Date | Task ID | Task Description | Status | User Approval |
|---|---|---|---|---|
| 2026-11-08 | R1 | Git forensics (read-only audit, commits since v2.3.0, specs, reflog, tags/releases, secrets scan, network hosts) | verified | approved |
| 2026-11-08 | R2 | Verification of unaccepted claims (V1 to V19) with raw command output and code evidence | verified | approved |
| 2026-11-08 | R3 | Fix what the evidence shows is wrong (on branch recovery/r3, no push) | verified | approved |
| 2026-11-08 | R4 | Release-candidate verification pack (generic smoke test checklist, field test sheet, limitations list) | verified | approved |
| 2026-11-08 | VM0 | Mode inventory matrix (docs/MODE_STATUS.md), catalogue outputs, and baseline test suite | verified | approved |
| 2026-11-08 | VM1 (jailbreak) | Spec check and discrepancy analysis for Jailbreak base mode (docs/specs/jailbreak.md) | verified | approved |
| 2026-11-08 | VM2 (jailbreak) | Fix Jailbreak mode auto-release loop, update tests and PLAYTEST.md | fixed in code, needs device test | approved |
| 2026-11-08 | VM1 (assassin_ring) | Spec check and discrepancy analysis for Assassin Ring base mode (docs/specs/assassin_ring.md) | verified | approved |
| 2026-11-08 | VM2 (assassin_ring) | Fix Assassin Ring RLS pings isolation policy, update tests and PLAYTEST.md | fixed in code, needs device test | approved |
| 2026-11-08 | VM1 (relay_heist) | Spec check and discrepancy analysis for Relay Heist base mode (docs/specs/relay_heist.md) | verified | approved |
| 2026-11-08 | VM2 (relay_heist) | Fix Relay Heist carrier drop & ping loop, negative tests, and PLAYTEST.md | fixed in code, needs device test | approved |
| 2026-11-08 | VM1 (vip_escort) | Spec check and discrepancy analysis for VIP Escort role add-on (docs/specs/vip_escort.md) | verified | approved |
| 2026-11-08 | VM2 (vip_escort) | Fix VIP auto-promote and target arrival guard, update tests and PLAYTEST.md | fixed in code, needs device test | approved |
| 2026-11-08 | VM1 (operator) | Spec check and discrepancy analysis for Operator role add-on (docs/specs/operator.md) | verified | approved |
| 2026-11-08 | VM2 (operator) | Fix Operator canonical get_game_state payload, negative tests, and PLAYTEST.md | fixed in code, needs device test | approved |
| 2026-11-08 | VM1 (double_agent) | Spec check and discrepancy analysis for Double Agent role add-on (docs/specs/double_agent.md) | verified | approved |
| 2026-11-08 | VM2 (double_agent) | Fix Double Agent scramble displacement in advance_game, negative tests, and PLAYTEST.md | fixed in code, needs device test | approved |
| 2026-11-08 | VM1 (ghost_duel) | Spec check and discrepancy analysis for Solo Ghost Duel base mode (docs/specs/ghost_duel.md) | verified | approved |
| 2026-11-08 | VM2 (ghost_duel) | Fix Ghost NPC stepping in advance_game, unconditional team assignment, hide public leaderboard, negative tests, and PLAYTEST.md | fixed in code, needs device test | approved |
| 2026-11-08 | VM1 (territory_pulse) | Spec check and discrepancy analysis for Territory Pulse base mode (docs/specs/territory_pulse.md) | verified | approved |
| 2026-11-08 | VM2 (territory_pulse) | Fix Territory Pulse advance_game canonical 2-pulse flip, negative tests, and PLAYTEST.md | fixed in code, needs device test | approved |
| 2026-11-08 | VM1 (ai_gm) | Spec check and forensic audit for AI Game Master modifier (docs/specs/ai_gm.md) | verified | approved |
| 2026-11-08 | VM2 (ai_gm) | Fix AI Game Master negative tests, playtest checklist, and mode status | fixed in code, needs device test | approved |
| 2026-11-08 | VM3 | Hide unreleased modes (haunted_map, qr_tagging, horde, manhunt) from UI and catalogue, migration 155, and negative tests | verified | approved |
| 2026-11-08 | VM4 | Field-test plan (docs/FIELD_TEST_PLAN.md): testing matrices, real-world failure vectors, 1-page checklists, and Go/No-Go criteria | verified | approved |
| 2026-11-09 | UI-M0 | UI Audit and baseline (docs/UI_AUDIT.md, docs/PHYSICAL_CHECKLIST.md, test baselines, U-D1 to U-D13 recommendations) | verified | approved |
| 2026-11-09 | UI-M1 | Token architecture, ThemeProvider, Text primitive, mode registry & modules, RulesCard, ParamField, dev preview, drift test | verified | approved |
| 2026-11-09 | UI-M2 | Game shell, role layouts, mode HUD widgets, timer isolation, profile:hud benchmark | verified | approved |
| 2026-11-09 | UI-M3 | Design system tokens (Direction A), UI primitives, motion primitives, tour engine skeleton, HUD gallery, zero hardcoded hex | verified | approved |
| 2026-11-09 | UI-M4 | Onboarding & entry flow (welcome hero, 4-step signup over existing auth, permissions & 18+ gate, offline briefing tour, back-compat redirects, handles spec) | verified | approved |
| 2026-11-09 | UI-M5 | Home, join, host wizard (Play tab, code boxes, 5-step wizard, map placement, redirect shims, wizard snapshot test) | verified | approved |
| 2026-11-09 | UI-M6 | Lobby, tabs and You (3-segment lobby, role briefing card, Modes library, You profile & stats, Settings & Privacy redesign) | verified | approved |
| 2026-11-09 | UI-M7 | Result, replay and gallery completion (swipeable recap cards, ±15s replay skip, ghost echo, gallery completion, token coverage) | verified | approved |
| 2026-11-09 | UI-M8 | Hardening and release candidate (redirects & deep links test, a11y pass, docs/ADDING_A_MODE.md, README update, release checklist) | verified | approved |
| 2026-11-10 | UI-M0 | UI Audit and baseline refresh (Afterimage direction, light/dark constraints, updated baseline captures, U-D1 to U-D13) | verified | approved |
| 2026-11-10 | UI-M1 | Token architecture, ThemeProvider, Text primitive, mode registry & modules, RulesCard, ParamField, dev preview, drift test | verified | approved |
| 2026-11-10 | UI-M2 | Game shell, role layouts, mode HUD widgets, timer isolation, profile:hud benchmark | verified | approved |
| 2026-11-10 | UI-M3 | Design system tokens (Afterimage), System/Light/Dark ThemeProvider, UI primitives, motion primitives, tour engine skeleton, HUD gallery, zero hardcoded hex | verified | approved |
| 2026-11-10 | UI-M4 | Onboarding suite (welcome hero, 4-step signup over existing auth, permissions & 18+ gate, offline briefing tour, back-compat redirects, handles spec) | verified | approved |
| 2026-11-10 | UI-M5 | Home, join and host wizard (Play tab, code boxes join modal, five-step host wizard, create_game payload snapshot test) | verified | approved |
| 2026-11-10 | UI-M6 | Lobby, tabs and You (3-segment lobby, role briefing card, Modes library, You profile & stats, Settings & Privacy redesign) | verified | approved |
| 2026-11-10 | UI-M7 | Result, replay and gallery completion (swipeable recap cards, ±15s replay skip, ghost echo, gallery completion, token coverage) | verified | approved |
| 2026-11-10 | UI-M8 | Hardening and release candidate (redirects and deep links test, a11y pass, docs/ADDING_A_MODE.md, README update, release checklist) | verified | approved |
| 2026-11-10 | UI-R1 | Afterimage Light/Dark redesign implementation against reference screenshots (label collision & mid-word wrap, review metric grid, chip padding, floating tab scroll offsets, dark map theme, theme switcher in settings, persistence suite, before/after captures) | verified | approved |
| 2026-11-10 | RELEASE-v2.7.1 | Release v2.7.1 (versionCode 9) Afterimage UI Redesign Release APK, release notes, changelog, and clean branch deletion | verified | approved |
| 2026-11-10 | RELEASE-v2.7.2 | Release v2.7.2 (versionCode 10) Floating navbar padding & drop shadow, unboxed top logo, full-bleed filter chips, Operative profile redesign, and verified APK build | verified | approved |
| 2026-11-10 | RELEASE-v2.7.3 | Release v2.7.3 (versionCode 11) Typography (Space Grotesk + Rajdhani), tactical onboarding (briefing, role-reveal, 16-color picker, Host a game CTA), modes two-tab library with global & player modifier tiles, ModeSimulationView animation crash fix | verified | approved |
| 2026-11-10 | RELEASE-v2.7.4 | Release v2.7.4 (versionCode 12) arm64-v8a only build, resource shrinking (APK 53 MB), battery/CPU safeguards in GameShell, mode detail accordian modifiers & pause/play fix | verified | approved |
| 2026-11-15 | F0 | Readiness audit: docs/FEATURES_READINESS.md, gates G1-G6, overlapping features, foundation status, leaderboard audit, baseline tests, decisions F-D1 to F-D14 and NF-33 to NF-36 | verified | approved |
| 2026-11-15 | NF-04 | Pre-game Ready Check and tracking health diagnostic (docs/specs/NF-04.md, migration 160, evaluator, tests) | verified | pending |
| 2026-11-15 | NF-05 | Silent-by-default tactical notification channels & settings toggle (docs/specs/NF-05.md, channels, tests) | verified | pending |
| 2026-11-15 | NF-06 | Safety check-in & night curfew prompts (docs/specs/NF-06.md, migration 170, useSafetyCheckin, tests) | verified | pending |
| 2026-11-15 | NF-03 | Rematch & role rotation engine, ratio guard (docs/specs/NF-03.md, migration 180, teamRotation, tests) | verified | pending |
| 2026-11-15 | NF-02 | Invite links, share sheet, QR modal, App Links & web landing fallback (docs/specs/NF-02.md, invite, tests) | verified | pending |
| 2026-11-15 | WAVE-1 | Wave 1: Easy to start, hard to fail — All 5 features implemented, tested and verified | verified | approved |
| 2026-11-15 | NF-07 | Team Radio (team text chat, quick chips, rate limit, profanity filter, TeamRadioSheet) | verified | pending |
| 2026-11-15 | NF-08 | Moderation basics (blocks & reports tables, block_user & report_player RPCs) | verified | pending |
| 2026-11-15 | NF-09 | Boundary rule options (reveal_live, auto_tag, drift buffer, accuracy gating, boundary rules evaluator) | verified | pending |
| 2026-11-15 | NF-10 | Shareable round card (150m privacy start/finish trim, scorecard modal, ShareRoundCardModal) | verified | pending |
| 2026-11-15 | NF-11 | Badges & personal records (7 canonical medals, player_badges table, dossier achievements in YouTab) | verified | pending |
| 2026-11-15 | NF-17 | Privacy-safe analytics & crash reporting (opt-in consent C7, zero GPS/name telemetry, analyticsCore) | verified | pending |
| 2026-11-15 | NF-18 | In-app feedback & bug report form (feedback table, submit_feedback RPC, FeedbackModal) | verified | pending |
| 2026-11-15 | NF-32 | In-app review prompt & support contact (Play store link, mailto diagnostics intent in settings) | verified | pending |
| 2026-11-15 | WAVE-2 | Wave 2: Comms, Safety & Player Progress — All 7 features implemented, tested and verified | verified | pending |
| 2026-11-15 | NF-12 | Remote push notifications (FCM & Expo push tokens, categories, payload builder) | verified | pending |
| 2026-11-15 | NF-13 | Scheduled games & calendar reminders (.ics RFC 5545 export & RSVP) | verified | pending |
| 2026-11-15 | NF-15 | Season recap card ("Wrapped" monthly/seasonal statistics & dossier modal) | verified | pending |
| 2026-11-15 | NF-16 | Persistent Crews & squad lists (create/join crew, crew invites, CrewManagementModal) | verified | pending |
| 2026-11-15 | NF-31 | Season framework & remote promo announcement banners on Play tab | verified | pending |
| 2026-11-15 | WAVE-3 | Wave 3: Operations & Group Retention — All 5 features implemented, tested and verified | verified | pending |
| 2026-11-15 | NF-19 | Official website & join gateway (public landing, safety, privacy, support, Universal Links) | verified | pending |
| 2026-11-15 | NF-20 | Localisation engine (i18n dictionary, 5 locales: en, es, de, fr, ja, full key parity) | verified | pending |
| 2026-11-15 | NF-21 | iOS configuration & Universal Links (app.json, permissions, background modes, apple-app-site-association) | verified | pending |
| 2026-11-15 | NF-22 | Discord integration (rich embed match mobilization & recap webhooks with location privacy) | verified | pending |
| 2026-11-15 | NF-25 | Accessibility extras (Protanopia, Deuteranopia, Tritanopia palettes, HUD scale, TalkBack cues) | verified | pending |
| 2026-11-15 | NF-26 | Admin console & remote config (admin role, RLS kill-switches, disabled_modes, system health metrics) | verified | pending |
| 2026-11-15 | NF-33 | Spoken TTS narration for AI Game Master (priority speech queue, screen-off tactical audio cues) | verified | pending |
| 2026-11-15 | WAVE-4 | Wave 4: Reach, Platform & Accessibility — All 7 features implemented, tested and verified | verified | pending |
| 2026-11-15 | NF-23 | Event mode for large games (Realtime broadcast channels, delayed spectator buffer, referee controls) | verified | pending |
| 2026-11-15 | NF-24 | Wear OS companion protocol (HUD updates, wrist haptics, one-tap check-in, wrist SOS) | verified | pending |
| 2026-11-15 | NF-27 | Replay trail animation & video export (150m privacy start/finish trimming, relative screen coordinates, SVG keyframes) | verified | pending |
| 2026-11-15 | NF-28 | Hosting purchase & monetisation safeguards (disabled by default per F-D9, free community tier, event pass) | verified | pending |
| 2026-11-15 | NF-36 | Community rule packs (strictly data-only, physical safety bounds validator, no code execution) | verified | pending |
| 2026-11-15 | WAVE-5 | Wave 5: Scale & Extras — All 5 features implemented, tested and verified | verified | pending |




