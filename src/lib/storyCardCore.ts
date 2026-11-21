import { distanceM, type LngLat } from './geo';
import { trimTrailPrivacy, PRIVACY_TRIM_METERS, MIN_SHAREABLE_DISTANCE_METERS } from './roundCard';
import { normalizePathToViewport, type RelativePoint } from './replayExportCore';

/**
 * Pillar 4: Story Card & 2D Animated Replay Telemetry Core
 *
 * Strict Privacy & Mathematical Invariants:
 * 1. Aspect Ratio: Strict 9:16 vertical ratio (0.5625) for Instagram Stories, Snapchat, WhatsApp Status.
 * 2. Privacy Buffer: Strict 150m start/end buffer trimming (NF-10). Never leak raw GPS coords.
 * 3. Multi-speed scrubber: Smooth cycle sequence [1, 2, 5, 10].
 * 4. Tag climaxes navigation: Instant seek calculation to next/prev tag timestamps.
 */

export const REPLAY_SPEED_STEPS = [1, 2, 5, 10] as const;
export type ReplaySpeed = (typeof REPLAY_SPEED_STEPS)[number];

export interface GloryHeadlineParams {
  mode: string;
  role: string;
  outcome: 'victorious' | 'completed' | 'tagged' | 'evaded' | 'defeated';
  durationSeconds: number;
  distanceMeters: number;
  opponentCount?: number;
  capturesCount?: number;
  isPatientZero?: boolean;
}

export interface GloryHeadlineResult {
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
}

export interface StoryMetricsParams {
  distanceMeters: number;
  durationSeconds: number;
  peakSpeedMps?: number;
}

export interface StorySvgResult {
  hasValidTrail: boolean;
  reason?: string;
  svgPath: string;
  points: RelativePoint[];
  startPoint: RelativePoint | null;
  endPoint: RelativePoint | null;
  originalDistanceM: number;
  trimmedDistanceM: number;
}

export interface StoryShareTextParams {
  headline: string;
  subtitle: string;
  modeName: string;
  role: string;
  durationSeconds: number;
  distanceMeters: number;
  code?: string;
  roomUrl?: string;
}

/**
 * Cycles through replay speeds: 1x -> 2x -> 5x -> 10x -> 1x
 */
export function cycleReplaySpeed(currentSpeed: number): ReplaySpeed {
  const currentIndex = REPLAY_SPEED_STEPS.indexOf(currentSpeed as ReplaySpeed);
  if (currentIndex === -1) {
    return 1;
  }
  return REPLAY_SPEED_STEPS[(currentIndex + 1) % REPLAY_SPEED_STEPS.length];
}

/**
 * Formats seconds into clock string "MM:SS" or "Xm Ys"
 */
export function formatClockMinutesSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}M ${secs}S`;
}

/**
 * Formats duration as MM:SS
 */
export function formatDurationMMSS(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Computes punchy, high-contrast tactical glory badges and headlines
 */
export function computeGloryHeadline(params: GloryHeadlineParams): GloryHeadlineResult {
  const isVictory = params.outcome === 'victorious' || params.outcome === 'evaded';
  const timeFormatted = formatClockMinutesSeconds(params.durationSeconds);
  const distKm = (params.distanceMeters / 1000).toFixed(1);
  const opponents = Math.max(1, params.opponentCount ?? 1);
  const captures = params.capturesCount ?? 0;
  const isOutbreak = params.mode.toLowerCase().includes('outbreak') || params.mode.toLowerCase().includes('horde');
  const roleLower = params.role.toLowerCase();

  // Outbreak Horde
  if (isOutbreak) {
    if (roleLower === 'hunter' || roleLower === 'zombie' || params.isPatientZero) {
      if (params.isPatientZero) {
        return {
          title: `PATIENT ZERO // ${captures} INFECTED`,
          subtitle: `SWARM VECTOR UNLEASHED OVER ${distKm} KM`,
          badge: 'OUTBREAK APEX',
          badgeColor: '#EF4444',
        };
      }
      return {
        title: `HORDE ASCENDANT // ${captures} INFECTED`,
        subtitle: `PURSUED FOR ${timeFormatted} ACROSS ${distKm} KM`,
        badge: isVictory ? 'HORDE VICTORY' : 'HORDE AGENT',
        badgeColor: '#EF4444',
      };
    } else {
      // Survivor / Runner
      if (isVictory) {
        return {
          title: `SURVIVED ${timeFormatted}`,
          subtitle: `EVADED ${opponents} INFECTED • EXTRACTED`,
          badge: 'IMMUNE EXTRACTION',
          badgeColor: '#10B981',
        };
      }
      return {
        title: `VALIANT FALL // ${timeFormatted}`,
        subtitle: `HELD THE LINE OVER ${distKm} KM BEFORE CONVERSION`,
        badge: 'SURVIVOR RECLUSE',
        badgeColor: '#F59E0B',
      };
    }
  }

  // Classic Chase / Tag Hunt
  if (roleLower === 'runner' || roleLower === 'solo') {
    if (isVictory) {
      return {
        title: `EXTRACTED • ${distKm} KM EVADED`,
        subtitle: `SURVIVED ${timeFormatted} OUTRUNNING ${opponents} HUNTERS`,
        badge: 'MISSION ACCOMPLISHED',
        badgeColor: '#10B981',
      };
    }
    return {
      title: `APEX EVASION • ${timeFormatted}`,
      subtitle: `RELENTLESS MOBILITY OVER ${distKm} KM`,
      badge: 'INTERCEPTED',
      badgeColor: '#F59E0B',
    };
  }

  if (roleLower === 'hunter') {
    if (isVictory || captures > 0) {
      return {
        title: `APEX PREDATOR • ${captures} CAPTURES`,
        subtitle: `INTERCEPT DOMINANCE OVER ${distKm} KM IN ${timeFormatted}`,
        badge: 'SECTOR SECURED',
        badgeColor: '#EF4444',
      };
    }
    return {
      title: `TACTICAL PURSUIT • ${distKm} KM`,
      subtitle: `PRESSURE TRACKING FOR ${timeFormatted}`,
      badge: 'OPERATION EXPIRED',
      badgeColor: '#6B7280',
    };
  }

  // Fallback
  return {
    title: `TACTICAL GLORY // ${distKm} KM`,
    subtitle: `OPERATION COMPLETED IN ${timeFormatted}`,
    badge: isVictory ? 'VICTORIOUS' : 'COMPLETED',
    badgeColor: isVictory ? '#10B981' : '#00F0FF',
  };
}

/**
 * Formats 3 primary tactical metrics
 */
export function formatStoryCardMetrics(params: StoryMetricsParams): {
  distanceFormatted: string;
  durationFormatted: string;
  speedFormatted: string;
} {
  const distKm = (params.distanceMeters / 1000).toFixed(1);
  const time = formatDurationMMSS(params.durationSeconds);
  const topSpeed = params.peakSpeedMps ? (params.peakSpeedMps * 3.6).toFixed(1) : '—';

  return {
    distanceFormatted: `${distKm} KM`,
    durationFormatted: time,
    speedFormatted: topSpeed !== '—' ? `${topSpeed} KM/H` : '—',
  };
}

/**
 * Generates privacy-trimmed 9:16 SVG vector path and relative viewport coordinates
 */
export function generateStorySvgPath(
  rawPath: LngLat[],
  width: number = 280,
  height: number = 280,
  padding: number = 24
): StorySvgResult {
  if (!rawPath || rawPath.length < 2) {
    return {
      hasValidTrail: false,
      reason: 'No trajectory recorded.',
      svgPath: '',
      points: [],
      startPoint: null,
      endPoint: null,
      originalDistanceM: 0,
      trimmedDistanceM: 0,
    };
  }

  // 1. Strict 150m privacy start/finish buffer trim
  const { trimmedPath, originalDistanceM, trimmedDistanceM } = trimTrailPrivacy(
    rawPath,
    PRIVACY_TRIM_METERS
  );

  if (trimmedPath.length < 2 || originalDistanceM < MIN_SHAREABLE_DISTANCE_METERS) {
    return {
      hasValidTrail: false,
      reason: 'Trail length below 350m privacy buffer threshold.',
      svgPath: '',
      points: [],
      startPoint: null,
      endPoint: null,
      originalDistanceM,
      trimmedDistanceM,
    };
  }

  // 2. Normalize to local canvas viewport (ZERO absolute GPS leaks)
  const relativePoints = normalizePathToViewport(trimmedPath, width, height, padding);
  if (relativePoints.length < 2) {
    return {
      hasValidTrail: false,
      reason: 'Insufficient normalized points.',
      svgPath: '',
      points: [],
      startPoint: null,
      endPoint: null,
      originalDistanceM,
      trimmedDistanceM,
    };
  }

  // 3. Construct SVG path command
  const first = relativePoints[0];
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < relativePoints.length; i++) {
    d += ` L ${relativePoints[i].x} ${relativePoints[i].y}`;
  }

  return {
    hasValidTrail: true,
    svgPath: d,
    points: relativePoints,
    startPoint: relativePoints[0],
    endPoint: relativePoints[relativePoints.length - 1],
    originalDistanceM,
    trimmedDistanceM,
  };
}

/**
 * Navigates to next tag event timestamp in timeline seconds
 */
export function findNextTagTime(
  tags: { tagged_at: string }[],
  currentCursorS: number,
  liveAtMs: number,
  totalDurationS?: number
): number | null {
  if (!tags || tags.length === 0 || !Number.isFinite(liveAtMs)) return null;

  const tagTimes = tags
    .map((t) => (Date.parse(t.tagged_at) - liveAtMs) / 1000)
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b);

  const next = tagTimes.find((t) => t > currentCursorS + 0.5);
  if (next !== undefined) {
    return totalDurationS ? Math.min(totalDurationS, next) : next;
  }
  return null;
}

/**
 * Navigates to previous tag event timestamp in timeline seconds
 */
export function findPrevTagTime(
  tags: { tagged_at: string }[],
  currentCursorS: number,
  liveAtMs: number
): number {
  if (!tags || tags.length === 0 || !Number.isFinite(liveAtMs)) return 0;

  const tagTimes = tags
    .map((t) => (Date.parse(t.tagged_at) - liveAtMs) / 1000)
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b);

  const prev = [...tagTimes].reverse().find((t) => t < currentCursorS - 0.5);
  return prev !== undefined ? Math.max(0, prev) : 0;
}

/**
 * Calculates 9:16 vertical card container dimensions
 */
export function calculateStoryCardDimensions(
  availableWidth: number,
  availableHeight: number,
  maxHeight: number = 640
): { width: number; height: number; scale: number } {
  const targetAspect = 9 / 16; // 0.5625
  const boundedHeight = Math.min(availableHeight * 0.85, maxHeight);
  const desiredWidth = Math.round(boundedHeight * targetAspect);

  if (desiredWidth <= availableWidth * 0.95) {
    return {
      width: desiredWidth,
      height: boundedHeight,
      scale: boundedHeight / 640,
    };
  }

  // Constrained by width
  const boundedWidth = Math.round(availableWidth * 0.92);
  const calculatedHeight = Math.round(boundedWidth / targetAspect);
  return {
    width: boundedWidth,
    height: calculatedHeight,
    scale: calculatedHeight / 640,
  };
}

/**
 * Formats high-impact story copy for system share sheets
 */
export function generateStoryShareText(params: StoryShareTextParams): string {
  const distKm = (params.distanceMeters / 1000).toFixed(1);
  const time = formatClockMinutesSeconds(params.durationSeconds);
  const invite = params.roomUrl || (params.code ? `https://ghostrun.app/join/${params.code}` : 'https://ghostrun.app');

  const lines = [
    `GHOSTRUN // ${params.headline}`,
    params.subtitle,
    '',
    `Mode: ${params.modeName.toUpperCase()}`,
    `Role: ${params.role.toUpperCase()}`,
    `Telemetry: ${distKm} KM | ${time}`,
    `Privacy: 150m origin & destination buffer protected (NF-10)`,
    '',
    `Infiltrate the lobby: ${invite}`,
  ];

  return lines.join('\n');
}
