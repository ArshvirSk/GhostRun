import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let reducedMotionOverride: boolean | null = null;
const listeners = new Set<(reduced: boolean) => void>();

export function setReducedMotionOverride(override: boolean | null): void {
  reducedMotionOverride = override;
  const active = isReducedMotionActiveSync();
  listeners.forEach((listener) => listener(active));
}

export function getReducedMotionOverride(): boolean | null {
  return reducedMotionOverride;
}

let systemReducedMotion = false;

// Initial query
if (typeof AccessibilityInfo?.isReduceMotionEnabled === 'function') {
  AccessibilityInfo.isReduceMotionEnabled()
    .then((enabled) => {
      systemReducedMotion = enabled;
      listeners.forEach((l) => l(isReducedMotionActiveSync()));
    })
    .catch(() => {
      // Ignore fallback in test environments
    });

  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled: boolean) => {
    systemReducedMotion = enabled;
    listeners.forEach((l) => l(isReducedMotionActiveSync()));
  });
}

function isReducedMotionActiveSync(): boolean {
  if (reducedMotionOverride !== null) {
    return reducedMotionOverride;
  }
  return systemReducedMotion;
}

export function isReducedMotionActive(): boolean {
  return isReducedMotionActiveSync();
}

/**
 * Hook returning whether reduced motion is currently active (system or manual toggle).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => isReducedMotionActiveSync());

  useEffect(() => {
    const handler = (newVal: boolean) => setReduced(newVal);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return reduced;
}
