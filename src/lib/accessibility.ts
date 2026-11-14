/**
 * NF-25: Accessibility Settings & Persistence Module
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ColorblindMode,
  HudScale,
  getRadarPalette,
  formatA11yHudAnnouncement,
} from './accessibilityCore';

export * from './accessibilityCore';

const COLORBLIND_STORAGE_KEY = '@ghostrun:a11y_colorblind';
const HUD_SCALE_STORAGE_KEY = '@ghostrun:a11y_hud_scale';

/**
 * Retrieve saved colorblind mode preference
 */
export async function getColorblindPreference(): Promise<ColorblindMode> {
  try {
    const val = await AsyncStorage.getItem(COLORBLIND_STORAGE_KEY);
    if (val === 'protanopia' || val === 'deuteranopia' || val === 'tritanopia') {
      return val;
    }
    return 'none';
  } catch {
    return 'none';
  }
}

/**
 * Save colorblind mode preference
 */
export async function setColorblindPreference(mode: ColorblindMode): Promise<void> {
  try {
    await AsyncStorage.setItem(COLORBLIND_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

/**
 * Retrieve saved HUD scale preference
 */
export async function getHudScalePreference(): Promise<HudScale> {
  try {
    const val = await AsyncStorage.getItem(HUD_SCALE_STORAGE_KEY);
    if (val === 'large' || val === 'extra_large') {
      return val;
    }
    return 'standard';
  } catch {
    return 'standard';
  }
}

/**
 * Save HUD scale preference
 */
export async function setHudScalePreference(scale: HudScale): Promise<void> {
  try {
    await AsyncStorage.setItem(HUD_SCALE_STORAGE_KEY, scale);
  } catch {
    // ignore
  }
}
