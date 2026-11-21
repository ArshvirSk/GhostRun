# GhostRun Release Notes — v2.9.12

**Release Date:** November 21, 2026  
**Build:** v2.9.12 (Version Code: 27)  
**Binary:** [GhostRun-v2.9.12.apk](./GhostRun-v2.9.12.apk)  

---

## Executive Summary

GhostRun **v2.9.12** resolves the cross-device Friend Request and Acceptance synchronization bug discovered during multi-device field testing. Both incoming/outgoing friend requests, QR scans, and friend acceptance events now propagate instantaneously in real-time across devices via Supabase WebSocket replication, with multi-tab pull-to-refresh and automatic background state refreshing.

---

## Root Cause Analysis & Fixes

1. **Missing Supabase Realtime Publication (`public.friendships` & `public.host_presence`)**:
   - **Root Cause**: While game and lobby tables were published to `supabase_realtime`, the `friendships` and `host_presence` tables were omitted from the PostgreSQL replication publication. As a result, PostgreSQL never published WebSocket broadcast events when friend requests were inserted or accepted.
   - **Fix**: Executed database migration [supabase/migrations/20261121194500_fl_realtime_friendships.sql](file:///c:/ASK_Main/ASK/Projects/GhostRun/supabase/migrations/20261121194500_fl_realtime_friendships.sql) to add `public.friendships` and `public.host_presence` to `supabase_realtime` and enabled `REPLICA IDENTITY FULL`.

2. **Real-time Client Subscription in [app/friends.tsx](file:///c:/ASK_Main/ASK/Projects/GhostRun/app/friends.tsx)**:
   - **Fix**: Added an active WebSocket channel listener on `friendships` and `host_presence`. Any incoming friend request, acceptance, decline, or live radar update now triggers an immediate silent reload in under 100ms on the other device without screen flashing or unmounting.

3. **Background Silent Refresh & Auto-Fetch on Tab Navigation**:
   - **Fix**: Updated `loadData(silent)` so background and real-time updates do not flash the full-screen `ActivityIndicator`.
   - Updated `handleTabChange` and `handlePagerScrollEnd` to automatically fetch fresh network state whenever swiping or tapping between `FRIENDS`, `REQUESTS`, and `ADD`.

4. **Multi-Tab Pull-to-Refresh Support**:
   - Replaced plain `<ScrollView>` on the **REQUESTS** and **ADD OPERATIVE** tabs with `<TacticalPullRefreshScrollView>` so users can pull down to refresh directly on any tab.

---

## Verification & Deployment
- Applied database migration [scripts/apply-fl-realtime.js](file:///c:/ASK_Main/ASK/Projects/GhostRun/scripts/apply-fl-realtime.js) to live Supabase database.
- Verified `supabase_realtime` publication now includes `friendships` and `host_presence`.
- `npm run test:horde`: 11/11 tests passing.
- `npx tsc --noEmit`: 0 TypeScript errors.
- Installed and launched v2.9.12 release binary on both connected physical devices (`RZCWA2BC80T` and `RZGL30WT2EJ`).
