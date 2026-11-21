/**
 * GhostRun v3.0 Tactical Audio Core
 * Pure calculation logic, types, and constants decoupled from native audio drivers.
 */

export type SoundName =
  | 'ping'
  | 'heat_hot'
  | 'heat_cold'
  | 'tag'
  | 'whisper'
  | 'victory'
  | 'defeat'
  | 'countdown'
  | 'scan_success'
  | 'heartbeat_slow'
  | 'heartbeat_fast'
  | 'alarm_danger'
  | 'siren_release'
  | 'infection_screech';

export type ProximityTier = 'none' | 'slow' | 'fast' | 'danger';

export const STORAGE_KEY_MUTED = '@ghostrun:sfx_muted';
export const STORAGE_KEY_PROXIMITY_AUDIO = '@ghostrun:proximity_audio_enabled';

/**
 * Pedestrian Safety Mandate:
 * GhostRun audio cues are specifically calibrated for device loudspeakers
 * to avoid in-ear occlusion and maintain active real-world situational awareness.
 */
export const LOUDSPEAKER_SAFETY_MANDATE =
  'Pedestrian Audio Safety: GhostRun audio cues are calibrated for your device loudspeaker so your ears stay open to real-world traffic and hazards. In-ear earbuds are discouraged during outdoor sprinting.';

/**
 * Calculates current proximity tier based on metric distance to nearest opponent:
 * - >= 50m: none (silent)
 * - 25m - 50m: slow heartbeat (70 bpm)
 * - 10m - 25m: fast heartbeat (130 bpm)
 * - < 10m: danger alarm (rapid acoustic pulse)
 */
export function calculateProximityTier(distanceM: number | null): ProximityTier {
  if (distanceM === null || distanceM >= 50) return 'none';
  if (distanceM < 10) return 'danger';
  if (distanceM < 25) return 'fast';
  return 'slow';
}
