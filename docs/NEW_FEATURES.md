# GhostRun — New Features Worth Adding (post-modes backlog)

> **Status:** planning document. **Nothing here is started until the entry gates in section 2 are met.**
> **Sources:** gaps found in GhostRun's current build (README, screen inventory, `MODES.md`), and a review of a comparable product, SCRAM (scramhideandseek.com, checked Nov 2026; all SCRAM numbers are its own published claims).
> **Companions:** `MODES.md`, `UI_RESTRUCTURE.md`, `TRD.md`, `FLOW.md`.
> **Effort scale:** S (about 1 to 3 days) · M (about 1 to 2 weeks) · L (more than 2 weeks).
>
> **Revision 2 (Nov 2026):** updated after a teardown of a comparable app's screens (sign-in, onboarding tour, home, profile, ranks, settings, paywall). Added NF-29 to NF-32, adjusted gates G3 and G4, dependencies, waves and decisions. The app's redesign, animated onboarding and new screens now live in `UI_RESTRUCTURE.md` (Revision 2), not here.

---

## 1. Purpose

GhostRun's strength is game depth (secret targets, modifiers, roles, ghosts, strong secrecy and privacy). What it lacks compared with simpler competitors is the **layer around the game**: easy onboarding, social glue, shareability, progression, reach and operations. This document lists the additions worth making, why, how big they are, and what could go wrong.

**A finding that shapes the priorities.** SCRAM reports about 37 million video views, 26,322 sign-ups, but only 699 rounds played. Their own page notes that sign-ups are accounts, not players. The lesson is that attention is easy to get and **assembling a group is the hard part**. Features that lower the cost of starting and finishing a first game come first.

**A second finding.** The comparable app invests heavily in the first minute: a one-question-per-screen sign-up, a scripted animated tour built from real HUD components, and a hero home screen with a demo-round link. That work sits in `UI_RESTRUCTURE.md`. The features here (demo round, invites, ready check) complement it, and the tour and the demo round are **different things**: the tour is a scripted animation with no network, the demo round is a real server-run game against bots.

## 2. Entry gates (all must be true before any feature work)

| # | Gate | Evidence required |
|---|---|---|
| G1 | **All modes in `MODES.md` that you decided to ship are implemented and verified** (specs, RLS rows, simulator scenarios, outdoor test) | A signed-off mode checklist in `docs/V2_VERIFY.md` |
| G2 | **Recovery tasks** (`AGENT_PROMPT_RECOVER.md`) approved | Approval recorded in `docs/DECISIONS.md` |
| G3 | **UI restructure and redesign** (`UI_RESTRUCTURE.md` Phases 1 and 2, including the new sign-up flow and Briefing tour) complete and released | Release candidate approved |
| G4 | **Auth and onboarding approach decided** (NF-29): either shipped with the redesign or explicitly deferred | Decision recorded in `docs/DECISIONS.md` |
| G5 | **A stable release with at least two successful field tests** | Field-test sheets |
| G6 | Privacy policy, consent flows and retention job are live and match the code | `docs/V2_VERIFY.md` shows no contradicted claims |

### Entry criteria for each individual feature
1. A written spec at `docs/specs/NF-xx.md` that I approve.
2. A **privacy and safety review** (what new data, who can see it, how long kept, how it is deleted, what abuse is possible).
3. Consent and policy updates **before** code, where data use changes.
4. A server-side **feature flag**, off by default.
5. RLS rows in `scripts/rls-check.ts` and scenarios in `scripts/sim` for anything touching data.
6. Strings in the central string table (i18n-ready from the first line).
7. Accessibility check and documentation updates.

## 3. Summary table

Priority: **A** = highest value for the effort and risk, **B** = strong, **C** = worthwhile later, **D** = long-term or optional.

| ID | Feature | Pri | Effort | Depends on | Risk |
|---|---|---|---|---|---|
| NF-01 | Demo round against bots | A | M | NPC engine, Briefing tour engine (UI) | Low |
| NF-02 | Invite links, share sheet, join landing page | A | S–M | NF-19 (minimal) | Low |
| NF-03 | Rematch and role rotation | A | S | None | Low |
| NF-04 | Pre-game **Ready Check** (tracking health) | A | S–M | None | Low |
| NF-05 | Silent-by-default alerts (vibration-only channels) | A | S | None | Low |
| NF-06 | Safety check-in and curfew | A | S–M | None | Low |
| NF-07 | Team Radio chat with quick-chat chips | B | M | NF-08 | **Medium** |
| NF-08 | Report, block and moderation basics | B | M | None | **Medium** |
| NF-09 | Boundary rule options (reveal live, auto-tag) | B | S–M | None | Low |
| NF-10 | Shareable round card | B | S–M | None | **Medium** (location leak) |
| NF-11 | Badges and personal records | B | M | None | Low |
| NF-12 | Remote push notifications (FCM) | B | M | None | Low |
| NF-13 | Scheduled games and reminders | C | M | NF-12 | Low |
| NF-14 | Monthly leaderboards | C | M–L | NF-08, handles (created in UI sign-up), NF-31 | **High** |
| NF-15 | Season recap ("Wrapped") | C | S–M | NF-11 | Low |
| NF-16 | Crews and friend list | C | M–L | NF-08 | Medium |
| NF-17 | Privacy-safe analytics and crash reporting | B | S–M | Consent C7 | Low |
| NF-18 | In-app feedback and bug report | B | S | None | Low |
| NF-19 | Website: landing, support, policies, join pages | B | M | None | Low |
| NF-20 | Localisation | C | M | Stable strings | Low |
| NF-21 | iOS build | C | L | Stable app | Medium |
| NF-22 | Discord integration | D | S–M | NF-19 | Low |
| NF-23 | Event mode for large games | D | L | Realtime scaling | Medium |
| NF-24 | Wear OS companion | D | L | Research | Medium |
| NF-25 | Accessibility extras | C | M | None | Low |
| NF-26 | Admin console and remote config | C | S–M | None | Low |
| NF-27 | Replay video export | D | L | NF-10 | Medium |
| NF-28 | Hosting purchase (monetisation) | D | M | Business decision | Medium |
| NF-29 | Passwordless and Google sign-in | A | M | Human setup (OAuth, email limits) | Medium |
| NF-30 | Friends and hosting presence | C | M | NF-08, NF-29 | Medium |
| NF-31 | Season framework and promo banners | C | S–M | NF-26 (remote config) | Low |
| NF-32 | In-app review prompt and contact | B | S | None | Low |

## 4. Wave 1: get groups into a first game (Priority A)

### NF-01 Demo round against bots
**What:** a one-person tutorial round on the Play tab ("Try a demo round") against simulated players. It is linked from the Briefing tour's last beat and from the home screen, and it is a **real server-run game**, unlike the tour, which is a scripted animation.
**Why:** SCRAM offers it, and it solves the "I can't test this without five friends" problem. It also makes store screenshots and clips easy.
**Scope v1:** 1 human plus 2 to 3 bots. Human can pick runner or hunter. Short (5 to 8 minutes), small fixed zone around the player's location (or a preset park if location is unavailable).
**Rules:** bots follow simple scripted paths (reuse the NPC engine and ghost movement), bots never exceed 1.5 m/s, pings every 30 s, the HEAT button and tagging are demonstrated with guided prompts.
**Data and privacy:** runs on the server like a normal game flagged `is_demo`, with no other human data, auto-deleted after 24 hours, excluded from leaderboards and stats.
**Risks:** bots behave unrealistically and teach wrong habits. Keep the demo short and label it as a tutorial.

### NF-02 Invite links, share sheet, join landing page
**What:** one-tap "Invite friends" that shares a link and code through the Android share sheet. The link opens the app (or a web page with install instructions) and pre-fills the code.
**Scope v1:** App Links for `https://<your-domain>/join/<CODE>`, Android verification file, fallback landing page, share text template, optional memorable codes (word plus number, for example `TACO42`) if the server and README agree on the format (see `UI_RESTRUCTURE.md` U-D3).
**Depends on:** minimal website (NF-19).
**Risks:** domain ownership and link verification. Do not put secrets in links.

### NF-03 Rematch and role rotation
**What:** "Play again" keeps the same lobby, settings and players, and rotates roles (or re-randomises) so everyone gets to hunt.
**Rules:** hunter ratio guard (at least one hunter per 10 players, never more hunters than runners), "Random" fills whichever team needs players.
**Scope:** server uses existing lobby logic. UI only plus a small RPC if not already present.

### NF-04 Pre-game Ready Check (tracking health)
**What:** a checklist screen shown in the lobby before ready-up: location permission level, background permission, battery-optimisation status, notification permission, GPS accuracy test (a few fixes), network check, "keep GhostRun open (do not swipe away)" reminder, and device-specific help links.
**Why:** background tracking is the biggest reliability risk for this kind of game, and it is the most common reason a first game goes wrong.
**Scope v1:** read-only checks plus deep links to system settings. Host can see a green/amber/red readiness indicator per player (no exact data, only the status).
**Privacy:** statuses only, no coordinates, not stored after the game.

### NF-05 Silent-by-default alerts
**What:** all in-game notifications use vibration-only notification channels, with no sound, so a ring does not give away a hiding place. Optional sound toggle in Settings.
**Scope:** Android notification channels (created once), haptic patterns per event type.

### NF-06 Safety check-in and curfew
**What:** optional host settings: a **curfew time** that ends the game, and a **check-in prompt** every N minutes in night games ("Are you OK?" with a 60-second response window). No response notifies teammates with the last known position.
**Why:** safety matters more as modes and areas grow, and it supports a responsible public posture.
**Scope v1:** host toggles, local prompt, server event `checkin_missed` (audience: team) with last position of that player only.
**Risks:** false alarms. Make prompts easy to dismiss and always allow "I'm fine".

### NF-29 Passwordless and Google sign-in
**What:** new players sign in with **Google**, an **emailed code**, or **guest**, with no password. Existing email and password accounts keep working.
**Why:** passwords add friction and reset screens. The comparable app signs people up in a few one-question screens with no password.
**Scope v1:**
- Google sign-in through the existing auth provider (needs an OAuth client in the Google Cloud console, the release keystore's SHA-1 fingerprint, and provider setup in the Supabase dashboard).
- Emailed 6-digit code (the app already has magic-link support, so evaluate switching to the code flow for a smoother in-app experience).
- Account linking so a guest can later attach Google or email without losing history (verify provider behaviour).
- Marketing email consent is a separate, **unchecked** checkbox, stored with a timestamp.
**Human prerequisites:** Google Cloud project and OAuth client, SHA-1 of the release keystore, provider settings, and a decision on custom SMTP.
**Risks:** Supabase's built-in email sender has a low hourly limit, so emailed codes alone can block groups signing up together. Keep Google and guest as alternatives, and consider custom SMTP. Check the per-IP limit for anonymous sign-ins.
**Coordination:** the sign-up screens are built in `UI_RESTRUCTURE.md` UI-M4. If this feature is not approved by then, those screens ship over the existing auth.

## 5. Wave 2: social glue and shareability (Priority B)

### NF-07 Team Radio (text chat plus quick chips)
**What:** team-only chat and one-tap chips ("Hunter nearby!", "I'm safe", "On the move", "Need help", "Regroup").
**Why:** SCRAM's Radio is one of its most visible features, and it is how teams coordinate without a phone call.
**Rules:**
- Channels: runners only, hunters only. Operators join their team's channel. Tagged players read-only (host setting). **No cross-team chat.**
- Rate limit (for example 1 message per second, 20 per minute), length limit (200 chars), simple profanity filter, system messages for pings and phase changes.
- Retention: messages deleted with the game or after **7 days**, whichever is first.
**Data:** `messages(id, game_id, team, sender_player_id, kind('text','chip','system'), body, created_at)`. RLS: readable by members of that team only (plus spectators if the host allows). Insert only through an RPC that checks team, phase and rate.
**Privacy and policy:** add chat to the privacy policy and terms, report and block must exist first (NF-08).
**Out of scope:** voice or push-to-talk (see section 9).
**Risks:** harassment, spam, secrets leaking through chat (players can tell each other things, which is normal). Moderation and reporting are mandatory.

### NF-08 Report, block and moderation basics
**What:** long-press a message or a player to **Report** or **Block**. Blocked players cannot join games you host, and their messages are hidden from you. Host can remove players in the lobby (exists today).
**Data:** `reports(id, reporter, reported_user, game_id, message_id, reason, created_at, status)`, `blocks(user_id, blocked_user_id)`.
**Operations:** a simple daily email digest of new reports to you, a documented response target (for example within 24 hours), and a manual action procedure (suspend account via an admin RPC).
**Policy:** short **Community Rules** page linked from the report flow and the terms.
**Risks:** you are the moderator. Keep volumes manageable by keeping games private (code-only join).

### NF-09 Boundary rule options
**What:** extra host options for leaving the play area:
- `warn` (today),
- `extra_ping` (today),
- **`reveal_live`**: a runner who stays outside the zone for more than N seconds (default 30) is revealed to hunters through **frequent pings (for example every 5 s)** until they return,
- **`auto_tag`**: after T seconds outside (default 120) the runner counts as tagged.
**Why:** SCRAM uses a similar rule, and it makes boundaries self-enforcing without a human referee.
**Implementation note:** implement the live reveal as scheduled pings written to the existing `pings` table, **not** by loosening RLS on `player_positions`.
**Edge cases:** GPS drift near the boundary (use an inner buffer and accuracy gating), cancelled penalty when the runner returns.

### NF-10 Shareable round card
**What:** after a game, generate a card (image) with the player's own route, outcome and 2 to 3 stats, ready to post to Stories, WhatsApp or others via the system share sheet.
**Privacy rules (important):**
- Only the player's **own** route, and only if they chose to share routes in that game (C3).
- **Trim the first and last 150 m** and use a **blurred or label-free map** so a shared image never reveals a home or an exact meeting point.
- Show a preview and a plain warning ("Your route will be visible to anyone who sees this image").
- No other players' names or routes.
- Watermark with the app name.
**Scope v1:** client-side rendering from existing trail data, no server storage, no account links.
**Risks:** location leakage in public posts. The trimming and blur are non-negotiable.

### NF-11 Badges and personal records
**What:** achievements computed from existing data: Closest Call, Longest Unseen Streak, Ghost Whisperer (escaped a ghost), Silent Step (finished with noise never above 60), Perfect Hunt, Clean Sweep, first game, 10 games, and similar.
**Scope v1:** server-computed after each game into a small `player_badges` table, shown on History and Me. Position-derived badges respect C3.
**Why:** retention with low risk, and it reuses data already collected.

### NF-17 Privacy-safe analytics and crash reporting (opt-in)
**What:** crash and error reports plus a few anonymous funnel events: install, sign-up, first lobby, first game started, first game completed, rematch. **No coordinates, names or free text.**
**Why:** the SCRAM numbers show the funnel from sign-up to played round is the key metric. You need to see where groups drop off.
**Rules:** gated by consent C7, off by default, clear explanation in Settings, retention limit, provider listed in the privacy policy.

### NF-18 In-app feedback and bug report
**What:** a form in Me → Help with category, text, optional screenshot, and an optional debug bundle (app version, device model, permission states, last RPC errors). **Coordinates are excluded by default.**
**Delivery:** a `feedback` table and an email digest to you.

### NF-32 In-app review prompt and contact
**What:** a "Rate GhostRun" row in Settings and an occasional in-app review prompt after a positive moment (for example after winning or finishing a game), plus a "Contact us" row that opens an email to a support address.
**Scope v1:** Google Play in-app review API (verify current behaviour and quotas), prompt at most once per version and never during or right after a bad experience (a crash, a disconnect, being tagged first). "Contact us" prefills app version and device model only, with no coordinates.
**Why:** cheap, and ratings matter if the app ever goes on the store.

## 6. Wave 3: progression and retention (Priority B to C)

### NF-12 Remote push notifications (FCM)
**What:** reach phones when the app is closed: lobby invites, "game starting", scheduled game reminders. In-game alerts continue to use the existing local and realtime path.
**Scope v1:** Firebase project, Android FCM credentials in EAS, Expo push tokens stored per user (with consent), a server function or webhook to send. Users can disable categories.
**Privacy:** push token is personal data, deleted with the account.

### NF-13 Scheduled games and reminders
**What:** a host schedules a game for a date and time, invitees RSVP, reminders go out (push), and the lobby opens early. Optional calendar file (.ics) for sharing.
**Depends on:** NF-12.

### NF-14 Monthly leaderboards
**What:** opt-in monthly boards with a world view and a country view, top 100 only.
**Why:** SCRAM shows this drives repeat play, and its design has sound privacy ideas worth copying.
**Design rules (must-haves):**
- **Off until the player turns it on** (consent C5). Turn-off removes them immediately.
- Show only **username, points, rounds, wins and tags**. Never where or when someone played.
- Boards update **once a day**, using games that ended at least **6 hours** earlier, so nobody can infer that a player is out right now.
- **Eligibility gates:** minimum players and teams, minimum game length, most players moved a minimum distance, daily cap per player, no demo games, no games with mock-location flags.
- Season = calendar month, everyone restarts at zero.
- **One board for all modes.** Points must be balanced across roles and modes. Start with a simple formula (for example a time-survived point per few minutes, a win bonus, a tag bonus) and tune with data. Do not copy another product's numbers without testing.
- **Handles** are created in the new sign-up flow (`UI_RESTRUCTURE.md` 7.1). This feature adds the rules around them: uniqueness already enforced, a profanity filter, reserved names, and report and removal (depends on NF-08). Show handles only. Showing a **country flag** is a separate opt-in because it reveals nationality.
- **Display:** a season countdown label, an explicit opt-in card ("You're not on the boards yet" with a turn-on button), a table of position, handle and points with simple gold, silver and bronze position chips and a crown for first place. Keep the layout and copy GhostRun's own.
**Data:** `leaderboard_optin`, `season_scores`, a nightly aggregation RPC (pg_cron), and a read RPC returning only the allowed columns.
**Risks:** cheating (GPS spoofing, farming with friends), username abuse, minors' data. Keep it off by default and keep the age policy at 18+ or supervised.

### NF-15 Season recap ("Wrapped")
**What:** a monthly or yearly summary card: games, distance, favourite mode, best escape, closest call, badges. Shareable using the same privacy rules as NF-10.
**Depends on:** NF-11 and NF-10.

### NF-16 Crews and friend list
**What:** persistent groups (crew code or invite), crew stats and "invite crew to game".
**Risks:** a friend graph is sensitive data. Keep it minimal (crew membership only), deletable, and never expose members' location outside games.

### NF-30 Friends and hosting presence
**What:** add friends by handle, and see when a friend is hosting a lobby so you can join with one tap.
**Why:** it turns "get a code from a friend" into "see who is hosting", which helps groups form.
**Rules:**
- Friends are added by handle with a request and accept flow. Blocking (NF-08) removes the friendship.
- **Presence is opt-in** (a "Show friends when I'm hosting" toggle, **off by default**). Friends only see the lobby's code and mode, never any location.
- No presence outside a hosted lobby. No "last seen".
- Policy remains 18+ or guardian-supervised, so no special under-18 handling is built.
**Data:** `friendships(user_id, friend_id, status)`, `host_presence` (lobby code and mode, visible to accepted friends while the lobby is open). RLS limits both to the owner and accepted friends. Deleted with the account.
**Risks:** friend graphs are sensitive and invite harassment. Depends on report and block, and keep the graph minimal.

### NF-31 Season framework and promo banners
**What:** a small remote-config-driven system for seasons (monthly), countdown labels ("Season ends in 24 days") and one banner slot on the Play tab for announcements or events.
**Scope v1:** a `seasons` table, a `banners` table (text, link target, start and end time, audience), read-only RPCs, and hidden UI slots that the redesign already leaves empty. No cosmetics or purchases.
**Why:** it gives leaderboards (NF-14) and events (NF-23) a place to live and keeps the home screen fresh without an app update.
**Risks:** banners must never be used for ads or third-party tracking links.

## 7. Wave 4: reach and platform

### NF-19 Website
**Scope v1:** landing page, how it works, support/FAQ, privacy policy, terms and community rules, delete-account page, `/join/<CODE>` landing, App Links file, Open Graph images. Static site (Next.js, since it is already your stack).
**Later:** country-only leaderboard page, event enquiry form, blog or devlog.
**Why:** needed for deep links, store listings and trust. SCRAM's site is a major part of its funnel.

### NF-20 Localisation
**Scope:** i18n framework, extract all strings (already centralised by the entry criteria), pick 2 to 4 languages first (decide by your players), metric and imperial units, date formats, pluralisation, and right-to-left readiness. Translate rules text carefully. A bad translation of safety copy is a safety bug.
**Depends on:** stable copy after the UI restructure and the new identity.

### NF-21 iOS build
**Scope:** same Expo codebase. Research and plan: Apple developer account, "Always" location permission flow and its review rules, foreground behaviour differences, MapLibre on iOS, camera and audio permissions, TestFlight distribution, push (APNs through FCM or Expo). Plan first, then build.
**Risks:** background location behaviour and App Review. Test on real devices.

### NF-22 Discord integration
**Scope:** create a lobby from Discord, post recaps (without exact routes), link voice channels manually. Small separate service. See `MODES.md` 8.4.

### NF-25 Accessibility extras
**Scope:** colour-blind-safe palettes, large HUD mode, audio-only play cues for screen-off play, left-handed layouts, reduced-motion respect, TalkBack labels, high-contrast sunlight theme.

### NF-26 Admin console and remote config
**Scope:** small protected web page to toggle feature flags, view reports, view anonymous health stats, and disable a mode quickly if a bug is found. Uses an admin role in Postgres, never the service-role key in a browser.

## 8. Wave 5: scale and optional extras (Priority D)

### NF-23 Event mode for large games
**What:** support 50 to 150 players: organiser role, referees, team counts, roster import, a spectator dashboard (delayed), and capacity safeguards.
**Technical caution:** per-row **RLS-filtered `postgres_changes` does not scale well** as subscribers grow. For large games, move team position sharing to **Realtime Broadcast on private per-team channels** (or equivalent), keep the database as the authority, and **load-test with the simulator at 100+ players** before promising capacity. Verify current Supabase limits and plan quotas at that time.
**Related:** tournaments and streamer mode in `MODES.md` 8.1 and 8.2.

### NF-24 Wear OS companion
**What:** haptic ping alerts and a TAG or HEAT button on the wrist, for eyes-up play.
**Status:** research first. A smaller step with similar value is better phone haptic patterns and audio-only cues.

### NF-27 Replay video export
**What:** animated trail video (MP4 or GIF) for sharing. Larger effort than the static card. Same privacy rules as NF-10.

### NF-28 Hosting purchase (monetisation)
**What:** friends join free and the host pays once to unlock hosting.
**Reference observed in the comparable app:** a one-time purchase to host (about ₹470 in the India store), friends always join free, "no subscription" stated plainly, a Restore purchase link in both the paywall and Settings, and a limited-time founder badge for early buyers. If you ever do this, copy the **principles** (one-time, friends free, restore in two places, price shown in local currency) and design your own badge and copy.
**Decision, not a feature:** only worth doing for a public launch. It needs store accounts, a billing library, restore-purchase handling, refunds policy, tax and legal setup, and it creates support work. For a friends-only game, skip it.

## 9. Not recommended (and why)

| Idea | Why not |
|---|---|
| **In-app voice chat or push-to-talk** | Audio capture in the background, moderation difficulty, privacy and consent complexity. Players can use a phone call or a voice app. Revisit only after text chat and moderation are proven |
| **Public matchmaking with strangers or public lobbies** | Location-based game with strangers is a safety risk. Keep games private (code or link only) |
| **Cross-team free-text chat** | Breaks the information-asymmetry design and increases harassment risk |
| **Live location sharing outside games** | Not needed and a major privacy liability |
| **Ads or selling location data** | Conflicts with the privacy posture |
| **Real-money prizes or betting** | Legal exposure and cheating incentives |
| **User-generated scripted modes** | Security risk (see rule packs in `MODES.md` 8.5: data-only packs, never code) |
| **Features for children** | Policy is 18+ or supervised by a guardian. Child-directed features bring strict legal requirements |
| **Separate under-18 accounts with age-gated defaults** | The comparable app supports them, but it needs age assurance, parental consent flows and a stricter legal review. Not worth it for a friends game. Revisit only with legal advice |
| **Large social feeds or follower systems** | Heavy moderation burden for little gameplay value |

## 10. Cross-cutting requirements

### 10.1 Privacy and consent additions
| Feature | New consent or policy item |
|---|---|
| NF-07 Radio | Policy and terms mention chat, retention (7 days), reporting |
| NF-08 Reports | Policy describes report data and handling |
| NF-10 / NF-15 / NF-27 sharing | In-flow warning and preview, C3 respected |
| NF-12 Push | Push-token consent and per-category toggles |
| NF-14 Leaderboards | C5 consent, username rules, delayed updates |
| NF-16 Crews | Friend-graph disclosure, deletion |
| NF-17 Analytics | C7 consent, provider disclosed |
| NF-23 Events | Broadcast consent C6 per game |
| NF-29 Sign-in | Email stored for sign-in, marketing email consent separate and unchecked by default, linking guest to account explained |
| NF-30 Friends | Friend graph and presence disclosed, presence opt-in, deletion with the account |
| NF-31 Seasons | No new personal data, banners must not carry tracking links |
| NF-32 Review prompt | No data beyond app version and device model for contact |

Every new table gets a retention rule and a deletion path in `delete_my_data()`.

### 10.2 Safety
Keep SOS everywhere, no mechanic that rewards running near roads, no features that locate other people outside a game, a safety reminder at game creation, and curfew and check-ins as options.

### 10.3 Technical foundations to build once
1. **String table and i18n scaffolding** (before NF-20).
2. **Analytics and error reporting layer** with consent gating (NF-17).
3. **Push infrastructure** (NF-12).
4. **Image rendering pipeline** for cards (NF-10, NF-15).
5. **Username system and moderation tables** (NF-08, NF-14).
6. **Realtime scaling plan and load test harness** (NF-23).
7. **Admin RPCs and a minimal admin page** (NF-26).
8. **Auth upgrade** (Google and emailed code, account linking) with the human setup it needs (NF-29).
9. **Remote config for seasons and banners** (NF-31), which can share the admin tooling from NF-26.

### 10.4 Policy tasks (not code)
Terms of use, community rules, privacy policy updates for each wave, a report-handling procedure with a response target, a data-deletion procedure for emailed requests, and a legal review before public launch or any large event.

## 11. Suggested release waves

| Wave | Theme | Features |
|---|---|---|
| **0** | Delivered by the redesign (`UI_RESTRUCTURE.md`) | New sign-up flow, Briefing tour, hero home, code boxes, host wizard, tabs, case file, settings (units, appearance, map style) |
| **1** | Easy to start, hard to fail | NF-29 passwordless and Google sign-in (if approved), NF-04 Ready Check, NF-05 silent alerts, NF-06 safety check-in, NF-03 rematch, NF-02 invite links with minimal NF-19, NF-01 demo round |
| **2** | Social glue | NF-08 report and block, NF-07 Radio, NF-09 boundary options, NF-10 round card, NF-11 badges, NF-17 analytics, NF-18 feedback, NF-32 review prompt and contact |
| **3** | Retention | NF-12 push, NF-31 seasons and banners, NF-30 friends and presence, NF-13 scheduled games, NF-15 recap, NF-16 crews, NF-14 leaderboards (last, after moderation is proven) |
| **4** | Reach | NF-19 full website, NF-20 localisation, NF-21 iOS, NF-22 Discord, NF-25 accessibility extras, NF-26 admin console |
| **5** | Scale and extras | NF-23 event mode, NF-24 watch companion (research), NF-27 video export, NF-28 monetisation (only if going public) |

## 12. Decisions needed from me

| # | Decision | Recommendation |
|---|---|---|
| F-D1 | Is the target audience friends only, or a public release | Friends first. Public changes the weight of leaderboards, moderation, monetisation and legal review |
| F-D2 | Text chat: build it or not | Yes, after report and block exist |
| F-D3 | Voice chat | No |
| F-D4 | Leaderboards | Only after Wave 2, opt-in, with the design rules above |
| F-D5 | iOS timing | After Wave 3, unless several friends use iPhones |
| F-D6 | Analytics and crash provider | Pick one with opt-in controls and a data-processing agreement, and disclose it |
| F-D7 | Website stack and domain | Next.js static site, domain you own, App Links verified |
| F-D8 | Languages to support first | Decide from where your players are |
| F-D9 | Monetisation | Skip until a public launch |
| F-D10 | Age policy | Keep 18+ or supervised by a guardian |
| F-D11 | Auth approach for new players (NF-29) | Google, emailed code and guest for new users, existing email and password kept. Approve only with the Google setup done and a plan for email limits |
| F-D12 | Friends and presence (NF-30) | After report and block. Presence opt-in and off by default |
| F-D13 | Seasons and promo banners (NF-31) | Build with leaderboards or events, not before |
| F-D14 | In-app review prompt (NF-32) | Yes, once per version after a positive moment |

## 13. Definition of done (per feature)

- Spec approved, feature flag added, consent and policy updated first.
- Server logic in `SECURITY DEFINER` functions, RLS rows and simulator scenarios added and passing (pasted output).
- Strings in the string table, accessibility checked, no flashing visuals.
- Retention and deletion paths cover all new data.
- Documentation updated (`README.md`, `docs/DECISIONS.md`, `docs/PLAYTEST.md`).
- A field-test checklist exists. **I** decide when it ships.
