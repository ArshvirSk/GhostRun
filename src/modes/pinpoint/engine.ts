/**
 * GhostRun v3.0 Pinpoint Engine
 *
 * Implements OpenGuessr 5,000 pts scoring matrix and progressive clue timeline:
 * - Proximity Error: 0 - 4,000 pts (Exponential decay with 100m scale factor)
 * - Heading Alignment: 0 - 500 pts (Cosine orientation delta)
 * - Speed Bonus: 0 - 500 pts (Linear elapsed time bonus)
 * - Clue Multiplier: 1.0x (Level 0) -> 0.9x (Sonar) -> 0.8x (Sector) -> 0.7x (Azimuth)
 */

import { distanceM, bearingDeg, LngLat } from '../../lib/geo';
import {
  PinpointClueLevel,
  PinpointClueState,
  PinpointScoreBreakdown,
  PinpointTarget,
} from './types';

export const PINPOINT_K_FACTOR = 100.0;
export const PINPOINT_BULLSEYE_THRESHOLD_M = 3.0;
export const PINPOINT_ZERO_SCORE_DISTANCE_M = 400.0;

/**
 * Calculates normalized angular delta between two compass headings (0-180 degrees).
 */
export function calculateHeadingDelta(headingA: number, headingB: number): number {
  const diff = Math.abs(headingA - headingB) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Evaluates the 5,000 points OpenGuessr scoring breakdown for a submitted shot.
 */
export function evaluatePinpointScore(params: {
  target: PinpointTarget;
  submissionLat: number;
  submissionLng: number;
  submissionHeading: number;
  cluesUnlocked: PinpointClueLevel;
  elapsedSec: number;
  roundDurationSec?: number;
}): PinpointScoreBreakdown {
  const roundDuration = params.roundDurationSec ?? 180;
  const targetCoord: LngLat = {
    latitude: params.target.latitude,
    longitude: params.target.longitude,
  };
  const subCoord: LngLat = {
    latitude: params.submissionLat,
    longitude: params.submissionLng,
  };

  // 1. Distance & Proximity Score (0 - 4000 pts)
  const distanceErrorM = Math.round(distanceM(subCoord, targetCoord) * 10) / 10;
  let scoreProximity = 0;
  if (distanceErrorM <= PINPOINT_BULLSEYE_THRESHOLD_M) {
    scoreProximity = 4000;
  } else if (distanceErrorM <= PINPOINT_ZERO_SCORE_DISTANCE_M) {
    scoreProximity = Math.round(4000.0 * Math.exp(-1.0 * distanceErrorM / PINPOINT_K_FACTOR));
  }

  // 2. Heading Error & Alignment Score (0 - 500 pts)
  const headingErrorDeg = Math.round(calculateHeadingDelta(params.submissionHeading, params.target.heading) * 10) / 10;
  let scoreHeading = 0;
  if (headingErrorDeg < 90.0) {
    const rad = (headingErrorDeg * Math.PI) / 180.0;
    scoreHeading = Math.round(500.0 * Math.cos(rad));
  }

  // 3. Speed Bonus (0 - 500 pts)
  const timeFraction = Math.min(1.0, Math.max(0, params.elapsedSec / roundDuration));
  const scoreSpeed = Math.max(0, Math.round(500.0 * (1.0 - timeFraction)));

  // 4. Clue Multiplier
  let clueMultiplier = 1.0;
  if (params.cluesUnlocked === 1) clueMultiplier = 0.9;
  else if (params.cluesUnlocked === 2) clueMultiplier = 0.8;
  else if (params.cluesUnlocked >= 3) clueMultiplier = 0.7;

  // 5. Total Score (0 - 5000 pts)
  const rawTotal = scoreProximity + scoreHeading + scoreSpeed;
  const totalScore = Math.min(5000, Math.round(rawTotal * clueMultiplier));

  return {
    distanceErrorM,
    headingErrorDeg,
    scoreProximity,
    scoreHeading,
    scoreSpeed,
    clueMultiplier,
    totalScore,
  };
}

/**
 * Calculates current progressive clue state based on elapsed round time and current operative location.
 */
export function evaluatePinpointClues(params: {
  elapsedSec: number;
  roundDurationSec?: number;
  currentLat: number;
  currentLng: number;
  targetLat: number;
  targetLng: number;
  centerLat: number;
  centerLng: number;
}): PinpointClueState {
  const duration = params.roundDurationSec ?? 180;
  const elapsed = Math.max(0, params.elapsedSec);

  // Progressive clue unlock thresholds: T+0:45 (25%), T+1:30 (50%), T+2:15 (75%)
  let level: PinpointClueLevel = 0;
  let scoreMultiplier = 1.0;

  if (elapsed >= duration * 0.75) {
    level = 3;
    scoreMultiplier = 0.7;
  } else if (elapsed >= duration * 0.50) {
    level = 2;
    scoreMultiplier = 0.8;
  } else if (elapsed >= duration * 0.25) {
    level = 1;
    scoreMultiplier = 0.9;
  }

  // Distance to target
  const currentCoord: LngLat = { latitude: params.currentLat, longitude: params.currentLng };
  const targetCoord: LngLat = { latitude: params.targetLat, longitude: params.targetLng };
  const distM = distanceM(currentCoord, targetCoord);

  // Level 1: Hot & Cold Sonar pulse interval & aura color
  let sonarPingIntervalMs: number | null = null;
  let sonarAuraColor: string | null = null;
  if (level >= 1) {
    if (distM > 300) {
      sonarPingIntervalMs = 4000;
      sonarAuraColor = '#38BDF8'; // Frost Blue
    } else if (distM > 150) {
      sonarPingIntervalMs = 2500;
      sonarAuraColor = '#00F0FF'; // Tactical Cyan
    } else if (distM > 50) {
      sonarPingIntervalMs = 1200;
      sonarAuraColor = '#10B981'; // Emerald Warm
    } else if (distM > 15) {
      sonarPingIntervalMs = 600;
      sonarAuraColor = '#F59E0B'; // Amber Hot
    } else {
      sonarPingIntervalMs = 250;
      sonarAuraColor = '#EF4444'; // Plasma Boiling
    }
  }

  // Level 2: Sector Quadrant Triangulation
  let sectorQuadrant: 'NW' | 'NE' | 'SW' | 'SE' | null = null;
  if (level >= 2) {
    const isNorth = params.targetLat >= params.centerLat;
    const isEast = params.targetLng >= params.centerLng;
    if (isNorth && isEast) sectorQuadrant = 'NE';
    else if (isNorth && !isEast) sectorQuadrant = 'NW';
    else if (!isNorth && isEast) sectorQuadrant = 'SE';
    else sectorQuadrant = 'SW';
  }

  // Level 3: Direct compass bearing to target
  let bearingToTargetDeg: number | null = null;
  if (level >= 3) {
    bearingToTargetDeg = Math.round(bearingDeg(currentCoord, targetCoord) * 10) / 10;
  }

  return {
    level,
    elapsedSec: elapsed,
    roundDurationSec: duration,
    sonarPingIntervalMs,
    sonarAuraColor,
    sectorQuadrant,
    bearingToTargetDeg,
    scoreMultiplier,
  };
}

export type PinpointGrade = 'bullseye_master' | 'excellent_scout' | 'tactical_recon' | 'off_target';

export interface PinpointBadgeInfo {
  grade: PinpointGrade;
  title: string;
  color: string;
  accentColor: string;
  summary: string;
}

/**
 * Returns celebratory badge classification based on 5,000 points scoring system.
 */
export function getPinpointGradeBadge(totalScore: number): PinpointBadgeInfo {
  if (totalScore >= 4500) {
    return {
      grade: 'bullseye_master',
      title: 'BULLSEYE MASTER',
      color: '#C8FF00', // Neon Lime
      accentColor: 'rgba(200, 255, 0, 0.15)',
      summary: 'Precision triangulation and surgical perspective alignment.',
    };
  }
  if (totalScore >= 3500) {
    return {
      grade: 'excellent_scout',
      title: 'EXCELLENT SCOUT',
      color: '#00F0FF', // Tactical Cyan
      accentColor: 'rgba(0, 240, 255, 0.15)',
      summary: 'Accurate landmark acquisition within tight proximity margin.',
    };
  }
  if (totalScore >= 2000) {
    return {
      grade: 'tactical_recon',
      title: 'TACTICAL RECON',
      color: '#F59E0B', // Tactical Amber
      accentColor: 'rgba(245, 158, 11, 0.15)',
      summary: 'Landmark zone identified with moderate angular variance.',
    };
  }
  return {
    grade: 'off_target',
    title: 'OFF-TARGET',
    color: '#94A3B8', // Muted Slate
    accentColor: 'rgba(148, 163, 184, 0.15)',
    summary: 'Coordinate divergence exceeded operational parameters.',
  };
}

/**
 * Converts true-north compass degrees (0-360) into standard cardinal quadrant string.
 */
export function getHeadingCompassLabel(headingDeg: number): string {
  const normalized = ((headingDeg % 360) + 360) % 360;
  const rounded = Math.round(normalized) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return `N (${rounded} DEG)`;
  if (normalized < 67.5) return `NE (${rounded} DEG)`;
  if (normalized < 112.5) return `E (${rounded} DEG)`;
  if (normalized < 157.5) return `SE (${rounded} DEG)`;
  if (normalized < 202.5) return `S (${rounded} DEG)`;
  if (normalized < 247.5) return `SW (${rounded} DEG)`;
  if (normalized < 292.5) return `W (${rounded} DEG)`;
  return `NW (${rounded} DEG)`;
}
