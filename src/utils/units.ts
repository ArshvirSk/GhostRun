import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export type UnitSystem = 'metric' | 'imperial';

export const UNIT_SYSTEM_KEY = '@ghostrun:unit_system';

let cachedUnitSystem: UnitSystem = 'metric';

export async function getStoredUnitSystem(): Promise<UnitSystem> {
  try {
    const stored = await AsyncStorage.getItem(UNIT_SYSTEM_KEY);
    if (stored === 'imperial' || stored === 'metric') {
      cachedUnitSystem = stored;
      return stored;
    }
  } catch {
    // fallback to metric
  }
  return cachedUnitSystem;
}

export async function saveUnitSystem(units: UnitSystem): Promise<void> {
  cachedUnitSystem = units;
  try {
    await AsyncStorage.setItem(UNIT_SYSTEM_KEY, units);
  } catch {
    // silent fallback
  }
}

export function formatDistance(meters: number, unitSystem: UnitSystem = cachedUnitSystem): string {
  if (isNaN(meters) || meters === null || meters === undefined) return '--';

  if (unitSystem === 'imperial') {
    const feet = meters * 3.28084;
    if (feet < 1320) {
      // Less than 1/4 mile: show feet
      return `${Math.round(feet)} ft`;
    }
    const miles = meters / 1609.344;
    return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
  }

  // Metric
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return `${km.toFixed(km >= 10 ? 0 : 1)} km`;
}

export function formatSpeed(mps: number, unitSystem: UnitSystem = cachedUnitSystem): string {
  if (isNaN(mps) || mps === null || mps === undefined) return '--';

  if (unitSystem === 'imperial') {
    const mph = mps * 2.23694;
    return `${mph.toFixed(1)} mph`;
  }

  const kmh = mps * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

export function useUnits() {
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>(cachedUnitSystem);

  useEffect(() => {
    let mounted = true;
    void getStoredUnitSystem().then((u) => {
      if (mounted) setUnitSystemState(u);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const setUnitSystem = useCallback(async (newUnits: UnitSystem) => {
    setUnitSystemState(newUnits);
    await saveUnitSystem(newUnits);
  }, []);

  const formatDist = useCallback(
    (meters: number) => formatDistance(meters, unitSystem),
    [unitSystem],
  );

  const formatSpd = useCallback(
    (mps: number) => formatSpeed(mps, unitSystem),
    [unitSystem],
  );

  return {
    unitSystem,
    setUnitSystem,
    formatDistance: formatDist,
    formatSpeed: formatSpd,
  };
}
