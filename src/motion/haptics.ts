import { Vibration } from 'react-native';

export type HapticEvent =
  | 'pingArrival'
  | 'tagConfirmed'
  | 'heatHot'
  | 'heatCold'
  | 'roleReveal'
  | 'buttonTap'
  | 'error'
  | 'sosTrigger'
  | 'noiseWarning';

const HAPTIC_PATTERNS: Record<HapticEvent, number[]> = {
  pingArrival: [0, 150, 100, 150],
  tagConfirmed: [0, 350],
  heatHot: [0, 100, 80, 100],
  heatCold: [0, 60],
  roleReveal: [0, 80, 80, 80, 120, 200],
  buttonTap: [0, 20],
  error: [0, 80, 50, 80],
  sosTrigger: [0, 500, 150, 500],
  noiseWarning: [0, 40],
};

let hapticsEnabled = true;

export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
}

export function isHapticsEnabled(): boolean {
  return hapticsEnabled;
}

export function triggerHaptic(event: HapticEvent): void {
  if (!hapticsEnabled) return;
  const pattern = HAPTIC_PATTERNS[event];
  if (pattern) {
    Vibration.vibrate(pattern);
  }
}
