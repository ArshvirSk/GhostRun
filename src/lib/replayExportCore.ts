/**
 * NF-27: Replay Trail Animation & Video Export Core
 *
 * Privacy Invariants:
 * 1. Enforces Consent C3 (share_trail): If false, export is refused.
 * 2. Enforces 150m privacy start/finish trimming (NF-10).
 * 3. Strips all absolute GPS coordinates: transforms path into relative [0, width] x [0, height] screen coordinates.
 */

import { trimTrailPrivacy, PRIVACY_TRIM_METERS, MIN_SHAREABLE_DISTANCE_METERS } from './roundCard';
import type { LngLat } from './geo';

export interface RelativePoint {
  x: number; // 0 to width
  y: number; // 0 to height
}

export interface ReplayFrame {
  frameIndex: number;
  timeSec: number;
  activePoint: RelativePoint;
  trailHistory: RelativePoint[];
}

export interface ReplayExportResult {
  allowed: boolean;
  reason?: string;
  totalFrames: number;
  frames: ReplayFrame[];
  svgAnimationMarkup?: string;
}

function resolveCoord(pt: any): { longitude: number; latitude: number } {
  return {
    longitude: pt.longitude ?? pt.lng ?? 0,
    latitude: pt.latitude ?? pt.lat ?? 0,
  };
}

/**
 * Normalizes GPS coordinates into relative screen coordinates within [0, width] x [0, height]
 */
export function normalizePathToViewport(
  path: (LngLat | { lng: number; lat: number })[],
  width: number = 400,
  height: number = 400,
  padding: number = 30
): RelativePoint[] {
  if (path.length === 0) return [];

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const rawPt of path) {
    const pt = resolveCoord(rawPt);
    if (pt.longitude < minLng) minLng = pt.longitude;
    if (pt.longitude > maxLng) maxLng = pt.longitude;
    if (pt.latitude < minLat) minLat = pt.latitude;
    if (pt.latitude > maxLat) maxLat = pt.latitude;
  }

  const deltaLng = maxLng - minLng || 0.0001;
  const deltaLat = maxLat - minLat || 0.0001;

  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  return path.map((rawPt) => {
    const pt = resolveCoord(rawPt);
    const normX = (pt.longitude - minLng) / deltaLng;
    // Invert Y for screen coordinates (latitude increases upwards, screen Y increases downwards)
    const normY = 1 - (pt.latitude - minLat) / deltaLat;

    return {
      x: Math.round(padding + normX * usableWidth),
      y: Math.round(padding + normY * usableHeight),
    };
  });
}

/**
 * Builds an animated keyframe sequence for tactical route playback
 */
export function buildReplayFrames(
  rawPath: (LngLat | { lng: number; lat: number })[],
  durationSeconds: number,
  shareTrailConsent: boolean,
  frameCount: number = 20,
  viewport: { width: number; height: number } = { width: 400, height: 400 }
): ReplayExportResult {
  // 1. Consent C3 check
  if (!shareTrailConsent) {
    return {
      allowed: false,
      reason: 'Route export disabled: Consent C3 (share_trail) is revoked.',
      totalFrames: 0,
      frames: [],
    };
  }

  // Normalize path to canonical LngLat format
  const canonicalPath: LngLat[] = rawPath.map(resolveCoord);

  // 2. Privacy trim (150m start & finish)
  const { trimmedPath, originalDistanceM } = trimTrailPrivacy(canonicalPath, PRIVACY_TRIM_METERS);

  if (trimmedPath.length < 2 || originalDistanceM < MIN_SHAREABLE_DISTANCE_METERS) {
    return {
      allowed: false,
      reason: 'Route too short for safe privacy trimming (< 350m).',
      totalFrames: 0,
      frames: [],
    };
  }

  // 3. Normalize coordinates (zero GPS leakage)
  const relativePoints = normalizePathToViewport(trimmedPath, viewport.width, viewport.height);

  // 4. Generate keyframes
  const frames: ReplayFrame[] = [];
  const pointsPerFrame = (relativePoints.length - 1) / Math.max(frameCount - 1, 1);

  for (let f = 0; f < frameCount; f++) {
    const ptIndex = Math.min(Math.round(f * pointsPerFrame), relativePoints.length - 1);
    const activePoint = relativePoints[ptIndex];
    const trailHistory = relativePoints.slice(0, ptIndex + 1);
    const timeSec = Math.round((f / (frameCount - 1)) * durationSeconds);

    frames.push({
      frameIndex: f,
      timeSec,
      activePoint,
      trailHistory,
    });
  }

  // 5. Generate self-contained animated SVG markup
  const polylinePoints = relativePoints.map((p) => `${p.x},${p.y}`).join(' ');
  const svgMarkup = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewport.width} ${viewport.height}" width="${viewport.width}" height="${viewport.height}" style="background:#101014;border-radius:16px;">
  <!-- Privacy Trimmed GhostRun Trail -->
  <polyline fill="none" stroke="#2F2E3A" stroke-width="4" stroke-linecap="round" points="${polylinePoints}" />
  <polyline fill="none" stroke="#C7F36B" stroke-width="3" stroke-linecap="round" stroke-dasharray="1000" stroke-dashoffset="1000" points="${polylinePoints}">
    <animate attributeName="stroke-dashoffset" from="1000" to="0" dur="4s" repeatCount="indefinite" />
  </polyline>
</svg>`.trim();

  return {
    allowed: true,
    totalFrames: frames.length,
    frames,
    svgAnimationMarkup: svgMarkup,
  };
}
