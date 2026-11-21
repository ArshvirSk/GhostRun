# GhostRun Release Notes — Wave v2.9.17

**Release:** `v2.9.17`  
**Version Code:** `32`  
**Milestone:** v3.0 Wave 17 (Pillar 5: Outdoor Battery & Field Resilience)  
**Target Environment:** Dual-device physical real-world field deployment (`RZCWA2BC80T` & `RZGL30WT2EJ`)  
**Commit Status:** Verified across unit, dead-zone simulation, and full TypeScript diagnostics.

---

## Executive Summary

Wave v2.9.17 implements **Pillar 5: Outdoor Battery & Field Resilience**, protecting phone battery life and eliminating telemetry data loss during real-world outdoor operations. It introduces an **Adaptive GPS Battery Guard** that scales polling rates according to operative movement dynamics, an **AsyncStorage-backed Durable Dead-Zone Queue** that buffers GPS fixes during cellular dead drops, and live **Tactical Link Diagnostics** on the match HUD and Settings.

---

## Core Capabilities Delivered

### 1. Adaptive GPS Battery Guard (`batteryResilienceCore.ts` & `location.ts`)
- **Velocity-Aware Power Scaling**:
  - **Sprint Tier** ($v \ge 2.0\text{ m/s}$): Engages continuous 1Hz high-precision GPS polling (`1,000ms`, `1m` filter) for pin-point capture vectors during chases.
  - **Tactical Stalking Tier** ($0.5\text{ m/s} \le v < 2.0\text{ m/s}$): Scales to balanced tracking (`2,500ms`, `3m` filter) during steady movement.
  - **Ambush Hold Tier** ($v < 0.5\text{ m/s}$ for $\ge 15\text{s}$): Automatically shifts to low-power GPS sleep cycles (`6,000ms`, `8m` filter) when camping in stealth hiding spots.
  - **Instant Sprint Wake**: Operative acceleration immediately breaks Ambush Hold and restores 1Hz precision with zero lag.
- **Critical Battery Sentinel ($\le 15\%$)**:
  - Automatically overrides high-drain polling with low-power cycles to safeguard against mid-match device shutdown.

### 2. Durable Dead-Zone Telemetry Queue (`offlineTelemetryQueue.ts`)
- **Zero Data Loss in Dead Zones**:
  - When cellular data drops (in park valleys, under tree canopies, or building shadows), in-flight GPS fixes are automatically enqueued into a durable FIFO local storage buffer.
  - Strictly bounded capacity (max 500 fixes ~ 15-20 minutes of offline movement) with FIFO eviction and timestamp deduplication.
- **Automatic Drainage & Reconnect Sync**:
  - As soon as cellular connection is restored or a position upload succeeds, background drain workers batch-flush buffered dead-zone fixes to Supabase with pacing and error backoff.
- **Offline Match Replay Cache**:
  - Caches completed match trajectory data locally, allowing post-match replays and story card generation even when completely disconnected from cellular service.

### 3. Live Field Network HUD Diagnostics (`TrackingStatus.tsx` & `GameShell.tsx`)
- **Real-Time Dead-Zone Indicator**:
  - When entering a dead-zone, the HUD displays an amber banner: `DEAD-ZONE ACTIVE: Buffering telemetry (N fixes queued)`.
  - Informs operatives that their tactical evasion route is safe and being preserved.
- **Critical Battery Alert**:
  - Displays `BATTERY GUARD ENGAGED (<= 15%)` when power conservation takes effect.

### 4. Settings Configuration (`app/settings.tsx`)
- Added **FIELD ENDURANCE & BATTERY RESILIENCE** section to Settings:
  - Toggle: **Adaptive GPS Battery Guard** (enabled by default).
  - Toggle: **Offline Dead-Zone Queue** (enabled by default).
  - Diagnostics: Live buffered fixes counter and one-tap **Clear Dead-Zone Buffer** control.

---

## Verification & Test Results

1. **Test Suite `scripts/test-battery-resilience.ts`**:
   - Sprint tier, Ambush Hold tier, instant wake transitions.
   - Critical battery overrides and user toggle bypass.
   - Dead-zone queue deduplication, FIFO limits, batch drainage.
   - 10/10 tests passed (100% pass rate).
2. **Cumulative Regression Suite**:
   - `test:resilience` (10/10 passed)
   - `test:story` (7/7 passed)
   - `test:audio` (56/56 passed)
   - `test:horde` (11/11 passed)
   - **84/84 tests passing with zero errors**.
3. **TypeScript Strict Type Check**:
   - `npx tsc --noEmit` exited 0.
