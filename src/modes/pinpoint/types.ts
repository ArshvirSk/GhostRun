/**
 * GhostRun v3.0 Flagship Mode — PINPOINT ("IRL OpenGuessr")
 *
 * Real-world geospatial scavenger hunt mode:
 * Operatives deduce physical locations from target photographs, navigate the terrain,
 * align their viewpoint using onion-skin viewfinder, and submit precision captures
 * for up to 5,000 points per round.
 */

export type PinpointPhotoSource = 'scout_and_swap' | 'host_drop' | 'map_poi';

export type PinpointClueLevel = 0 | 1 | 2 | 3;

export type PinpointRoundPhase = 'scouting' | 'active' | 'scoring' | 'completed';

export interface PinpointTarget {
  id: string;
  roundNumber: number;
  photoUrl: string;
  latitude: number;
  longitude: number;
  heading: number; // 0.0 - 359.9 degrees (True North)
  scoutedByTeam?: string | null;
  status: PinpointRoundPhase;
  startedAt?: number;
  endsAt?: number;
}

export interface PinpointSubmission {
  id?: string;
  roundId: string;
  playerId: string;
  team: string;
  submissionPhotoUrl?: string;
  latitude: number;
  longitude: number;
  heading: number;
  cluesUnlocked: PinpointClueLevel;
  submittedAt: number;
}

export interface PinpointScoreBreakdown {
  distanceErrorM: number;
  headingErrorDeg: number;
  scoreProximity: number; // 0 - 4,000 pts (exponential decay)
  scoreHeading: number;   // 0 - 500 pts (cosine orientation curve)
  scoreSpeed: number;     // 0 - 500 pts (linear time bonus)
  clueMultiplier: number; // 1.0x -> 0.9x -> 0.8x -> 0.7x
  totalScore: number;     // 0 - 5,000 pts
}

export interface PinpointClueState {
  level: PinpointClueLevel;
  elapsedSec: number;
  roundDurationSec: number;
  sonarPingIntervalMs: number | null; // null if level < 1
  sonarAuraColor: string | null;       // null if level < 1
  sectorQuadrant: 'NW' | 'NE' | 'SW' | 'SE' | null; // null if level < 2
  bearingToTargetDeg: number | null;   // null if level < 3
  scoreMultiplier: number;
}

export interface PinpointConfig {
  radiusMeters: number;
  photoSource: PinpointPhotoSource;
  totalRounds: number;
  roundDurationSeconds: number;
}

export interface PinpointHostDrop {
  id: string;
  roundNumber: number;
  title: string;
  photoUrl?: string;
  latitude: number;
  longitude: number;
  heading: number; // 0.0 - 359.9 degrees True North
}

export type PinpointGrade = 'bullseye_master' | 'excellent_scout' | 'tactical_recon' | 'off_target';

export interface PinpointBadgeInfo {
  grade: PinpointGrade;
  title: string;
  color: string;
  accentColor: string;
  summary: string;
}

export interface PinpointRoundResult {
  roundNumber: number;
  totalRounds: number;
  targetPhotoUrl: string;
  targetTitle?: string;
  targetHeading?: number;
  submissionPhotoUrl?: string;
  submissionHeading?: number;
  distanceErrorM: number;
  headingErrorDeg: number;
  scoreBreakdown: PinpointScoreBreakdown;
  scoutedBy?: string;
}
