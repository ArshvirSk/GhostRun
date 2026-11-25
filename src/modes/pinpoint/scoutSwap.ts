/**
 * GhostRun v3.0 Pinpoint Method A: Scout & Swap Round Orchestrator
 *
 * Implements the 2-phase peer-scouting round flow:
 * - Phase 1 (Scouting): Teams scatter inside the geofence to snap a deceptive landmark.
 * - Phase 2 (Hunt): Target photos are swapped across opposing teams (Team A <-> Team B).
 */

import type { LivePinpointRound } from './liveHelpers';

export interface ScoutedDrop {
  team: string;
  playerId: string;
  latitude: number;
  longitude: number;
  heading: number;
  photoUrl: string;
  title?: string;
  scoutedAtMs: number;
}

const DEFAULT_OPPONENT_SCOUT_PHOTO =
  'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=600&q=80';

/**
 * Generates an opponent team's scouted target inside the arena boundary
 * when playing solo or when the opposing squad's scout drop is simulated.
 */
export function buildSimulatedOpponentScoutDrop(params: {
  myTeam: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  roundNumber: number;
}): ScoutedDrop {
  const oppTeam = params.myTeam === 'hunter' ? 'runner' : 'hunter';
  const offsetM = Math.min(params.radiusM * 0.5, 180);
  const angleRad = ((params.roundNumber * 135 + 20) * Math.PI) / 180;
  const cosLat = Math.max(0.2, Math.cos((params.centerLat * Math.PI) / 180));

  return {
    team: oppTeam,
    playerId: `sim-${oppTeam}`,
    latitude: params.centerLat + (offsetM * Math.cos(angleRad)) / 111111,
    longitude: params.centerLng + (offsetM * Math.sin(angleRad)) / (111111 * cosLat),
    heading: (params.roundNumber * 75 + 15) % 360,
    photoUrl: DEFAULT_OPPONENT_SCOUT_PHOTO,
    title: `Rival Scout Drop #${params.roundNumber}`,
    scoutedAtMs: Date.now(),
  };
}

/**
 * Performs the Scout & Swap exchange:
 * Given a list of scouted drops from participating teams, returns the target
 * round assigned to `myTeam` (guaranteed not to be `myTeam`'s own drop when
 * an opponent drop is available).
 */
export function resolveSwappedTargetForTeam(params: {
  myTeam: string;
  scoutDrops: ScoutedDrop[];
  roundNumber: number;
  durationSec: number;
  centerLat: number;
  centerLng: number;
  radiusM: number;
}): LivePinpointRound {
  const opponentDrop = params.scoutDrops.find((d) => d.team !== params.myTeam);
  const chosen =
    opponentDrop ??
    buildSimulatedOpponentScoutDrop({
      myTeam: params.myTeam,
      centerLat: params.centerLat,
      centerLng: params.centerLng,
      radiusM: params.radiusM,
      roundNumber: params.roundNumber,
    });

  return {
    id: `swap-rd-${params.roundNumber}-${chosen.team}`,
    roundNumber: params.roundNumber,
    title: chosen.title || `Team ${chosen.team.toUpperCase()} Scout Drop`,
    targetPhotoUrl: chosen.photoUrl,
    latitude: chosen.latitude,
    longitude: chosen.longitude,
    heading: chosen.heading,
    durationSec: params.durationSec,
  };
}
