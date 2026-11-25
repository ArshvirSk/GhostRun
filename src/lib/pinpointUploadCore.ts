/**
 * GhostRun v3.0 Pinpoint UploadThing Pure Helpers
 */

export interface PinpointUploadResult {
  ok: boolean;
  publicUrl?: string;
  key?: string;
  error?: string;
}

/**
 * Validates that a string is a valid UploadThing CDN HTTPS URL.
 */
export function isValidUploadThingUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  return /^https:\/\/([a-z0-9-]+\.ufs\.sh\/f\/|utfs\.io\/f\/).+/i.test(url.trim());
}

/**
 * Builds a deterministic filename for Pinpoint captures.
 */
export function buildPinpointPhotoFilename(meta?: {
  gameId?: string;
  roundId?: string;
  kind?: 'scout' | 'submission';
}): string {
  const kind = meta?.kind || 'submission';
  const game = (meta?.gameId || 'match').slice(0, 8);
  const round = (meta?.roundId || 'rd').slice(0, 8);
  return `pinpoint-${kind}-${game}-${round}-${Date.now()}.jpg`;
}
