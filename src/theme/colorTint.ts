/**
 * GhostRun Dynamic Monochromatic Theme Generator
 * Inspired by PlayCulture's player-driven adaptive color system.
 *
 * Dynamically computes a deeply saturated, eye-friendly monochromatic
 * dark palette (and light palette) from the operative's selected profile accent color.
 */

import { darkColors, lightColors, ColorTokens } from './tokens';

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    return {
      r: parseInt(cleanHex[0] + cleanHex[0], 16),
      g: parseInt(cleanHex[1] + cleanHex[1], 16),
      b: parseInt(cleanHex[2] + cleanHex[2], 16),
    };
  }
  const num = parseInt(cleanHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Derives a complete tinted dark palette from an accent color.
 * Uses mathematical color mixing with deep carbon/obsidian bases
 * to ensure high contrast, zero eye fatigue, and vibrant visual pop.
 */
export function getTintedDarkColors(accentHex: string): ColorTokens {
  const { r, g, b } = hexToRgb(accentHex);

  // Background: Deep dark tinted obsidian (mixing 5-8% accent into #08080C)
  const bgR = Math.round(8 + r * 0.05);
  const bgG = Math.round(8 + g * 0.05);
  const bgB = Math.round(11 + b * 0.05);
  const background = rgbToHex(bgR, bgG, bgB);

  // Background Dark (deeper still for status bar and canvas underlays)
  const backgroundDark = rgbToHex(bgR * 0.65, bgG * 0.65, bgB * 0.65);

  // Surface: Tinted dark card surface (mixing 11-14% accent into #13131A)
  const surfR = Math.round(15 + r * 0.11);
  const surfG = Math.round(15 + g * 0.11);
  const surfB = Math.round(19 + b * 0.11);
  const surface = rgbToHex(surfR, surfG, surfB);
  const surfaceDark = rgbToHex(surfR * 0.85, surfG * 0.85, surfB * 0.85);

  // Elevated Surface (popovers, active cards, floating docks)
  const elevR = Math.round(22 + r * 0.16);
  const elevG = Math.round(22 + g * 0.16);
  const elevB = Math.round(26 + b * 0.16);
  const surfaceElevated = rgbToHex(elevR, elevG, elevB);

  // Muted Surface (chips, unselected tabs)
  const mutR = Math.round(28 + r * 0.20);
  const mutG = Math.round(28 + g * 0.20);
  const mutB = Math.round(32 + b * 0.20);
  const surfaceMuted = rgbToHex(mutR, mutG, mutB);

  // Luminous Borders
  const border = hexToRgba(accentHex, 0.26);
  const borderDark = hexToRgba(accentHex, 0.44);
  const borderLight = hexToRgba(accentHex, 0.15);
  const borderAccent = hexToRgba(accentHex, 0.65);

  return {
    ...darkColors,
    background,
    backgroundDark,
    surface,
    surfaceDark,
    surfaceElevated,
    surfaceMuted,
    surfaceAlt: surfaceElevated,

    border,
    borderDark,
    borderLight,
    borderAccent,

    // Primary accent matches chosen color
    primary: accentHex,
    primaryHover: rgbToHex(r * 0.9, g * 0.9, b * 0.9),
    primaryLight: hexToRgba(accentHex, 0.16),
    primaryText: '#08080A',

    accent: accentHex,
    runner: accentHex,
    runnerHover: rgbToHex(r * 0.9, g * 0.9, b * 0.9),
    runnerText: '#08080A',

    textMuted: hexToRgba('#FFFFFF', 0.68),
    textSecondary: hexToRgba('#FFFFFF', 0.68),
    textSubtle: hexToRgba('#FFFFFF', 0.45),
  };
}

/**
 * Derives a complete tinted light palette from an accent color.
 */
export function getTintedLightColors(accentHex: string): ColorTokens {
  const { r, g, b } = hexToRgb(accentHex);

  const bgR = Math.min(255, Math.round(242 + r * 0.02));
  const bgG = Math.min(255, Math.round(239 + g * 0.02));
  const bgB = Math.min(255, Math.round(232 + b * 0.02));
  const background = rgbToHex(bgR, bgG, bgB);

  const elevR = Math.min(255, Math.round(233 + r * 0.03));
  const elevG = Math.min(255, Math.round(229 + g * 0.03));
  const elevB = Math.min(255, Math.round(220 + b * 0.03));
  const surfaceElevated = rgbToHex(elevR, elevG, elevB);

  return {
    ...lightColors,
    background,
    surfaceElevated,
    surfaceAlt: surfaceElevated,
    primary: accentHex,
    runner: accentHex,
    borderAccent: hexToRgba(accentHex, 0.35),
    primaryLight: hexToRgba(accentHex, 0.12),
  };
}
