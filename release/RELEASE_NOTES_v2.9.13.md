# GhostRun Release Notes - Wave v2.9.13

**Version**: `2.9.13`
**Build Code**: `28`
**Target Platforms**: Android (Tested simultaneously on Samsung physical targets `RZCWA2BC80T` [TEST101] and `RZGL30WT2EJ` [ALPHAOP])
**Database**: Supabase PostgreSQL `db.jgpbxsvgpewjvauozrzq.supabase.co`

---

## 1. Executive Summary & Wave Objectives
Wave v2.9.13 fulfills the privacy overhaul request:
1. **Full Privacy Defaults on Account Creation**: All privacy options (`show_presence`, `allow_friend_requests`, `share_echo`, `profile_visibility='public'`, and consents `ghost`, `leaderboard_name`, `diagnostics`, `show_presence`, `share_echo`) default to active/true for every newly created account.
2. **Existing 4 Users Migrated**: All 4 registered operatives (`ALPHAOP`, `JASHDAMANIA`, `GAY`, `TEST101`) have been migrated with all privacy features and consents turned on in PostgreSQL.
3. **Tactical Privacy Defaults Modal**: Created a dedicated high-contrast modal dialog explaining that all privacy settings are active by default for streamlined matchmaking and live radar synchronization, reassuring users that they can customize or disable any setting at any time in Settings > Privacy, complete with an `[ OK, UNDERSTOOD ]` dismissal button.
4. **Multi-Device Live Verification**: Installed and verified across both physical phones.

---

## 2. Technical Implementations

### Database Migration (`20261121200000_fl_privacy_defaults_on.sql`)
- Altered column defaults on `public.profiles`:
  - `show_presence SET DEFAULT true`
  - `allow_friend_requests SET DEFAULT true`
  - `share_echo SET DEFAULT true`
  - `profile_visibility SET DEFAULT 'public'`
- Updated existing 4 users:
  - `UPDATE public.profiles SET show_presence = true, allow_friend_requests = true, share_echo = true, profile_visibility = 'public';`
  - Inserted granted records in `public.consents` (`ghost`, `leaderboard_name`, `diagnostics`, `show_presence`, `share_echo`) for all 4 profiles at `policy_version = 4`.
- Updated `public.upsert_profile(name, color)` stored procedure to automatically initialize new profiles with all privacy toggles set to `true`.

### Client Account Creation (`app/(onboarding)/signup/before-you-play.tsx`)
- Updated `handleCompleteSetup`:
  - Automatically records granted consents for all 6 categories (`policy_ack`, `ghost`, `leaderboard_name`, `diagnostics`, `show_presence`, `share_echo`).
  - Sets profile columns to `show_presence=true`, `allow_friend_requests=true`, `share_echo=true`, `profile_visibility='public'`.
  - Persists local AsyncStorage consent flags (`@ghostrun:consent_*` and `@ghostrun:allow_friend_requests`).

### Tactical Modal Component (`src/components/PrivacyDefaultsModal.tsx`)
- High-contrast Obsidian design matching the Tactical HUD theme.
- Features:
  - Header: Shield emblem and `TACTICAL HUD // PRIVACY DIRECTIVE` badge.
  - Active feature badges: Live Presence & Radar (ON), Friend Requests & Invites (ON), Ghost Route Contributions (ON), Echo Score & Leaderboards (ON).
  - Tactical Control Callout: Reassures operatives they retain complete operational control and can customize any option in Settings > Privacy.
  - Prominent dismissal button: `[ OK, UNDERSTOOD ]` with haptic feedback.
  - Persistent state saved to `@ghostrun:privacy_defaults_ack_v1` in `AsyncStorage`.

### Animation Engine Hardening (`src/motion/useSheetModalAnimation.ts`)
- Fixed initial-render exit animation race condition where asynchronous state updates within the first 180ms were prematurely unmounted by queued exit animation callbacks.

---

## 3. Multi-Device Verification
- Device 1 (`RZCWA2BC80T`): Modal presented on launch; verified scrolling, layout fidelity, and dismissal with `[ OK, UNDERSTOOD ]`.
- Device 2 (`RZGL30WT2EJ`): Modal presented on launch; verified dismissal via header close button.
- Both devices verified in live operative state with v2.9.13 release APK installed.
