/**
 * GhostRun Design Tokens — Afterimage Visual Direction
 * Approved per docs/UI_RESTRICTIONS.md & docs/UI_RESTRUCTURE.md §4.2.
 *
 * Warm paper-like light surfaces, ink-dark night surfaces, spectral violet
 * for brand/ping identity, restrained acid lime for runners & primary actions,
 * and hunter coral for hunters and urgent warnings.
 */

export const darkColors = {
  // Screen & Surface (Afterimage ink-dark night surfaces)
  background: '#101014',
  backgroundDark: '#09090C',
  surface: '#1B1A22',
  surfaceDark: '#14131A',
  surfaceElevated: '#24232D',
  surfaceMuted: '#2F2E3A',
  surfaceAlt: '#24232D',

  // Borders
  border: '#393743',
  borderDark: '#4E4B5B',
  borderLight: '#282732',
  borderAccent: 'rgba(199, 243, 107, 0.4)',
  borderHunter: 'rgba(255, 138, 117, 0.4)',

  // Text
  text: '#F1EEE8',
  textLight: '#FFFFFF',
  textPrimary: '#F1EEE8',
  textMuted: '#B7B2BF',
  textSecondary: '#B7B2BF',
  textSubtle: '#7E7988',

  // Primary & Team Actions
  primary: '#C7F36B',
  primaryHover: '#B5E357',
  primaryLight: 'rgba(199, 243, 107, 0.12)',
  primaryText: '#101014',
  accent: '#B8A3FF',
  runner: '#C7F36B',
  runnerHover: '#B5E357',
  runnerText: '#101014',
  hunter: '#FF8A75',
  hunterHover: '#E87864',
  hunterText: '#1F0B00',
  warning: '#FBBF24',

  // Brand & Ping (Spectral Violet)
  brandViolet: '#B8A3FF',
  pingViolet: '#B8A3FF',

  // Feedback & Tactical
  success: '#C7F36B',
  successText: '#101014',
  danger: '#FF8A75',
  dangerHover: '#E87864',
  dangerText: '#1F0B00',
  dangerSurface: '#2D1614',
  dangerBorder: '#5C2E29',
  dangerDisabled: '#3D1F1C',
  shadow: '#000000',

  // Tactical Overlays (Hot & Cold, Radar, Echo)
  heatHot: '#FF8A75',
  heatCold: '#60A5FA',
  radarScan: '#B8A3FF',
  ghostTrail: '#B8A3FF',
  ripple: 'rgba(184, 163, 255, 0.25)',
  fogHaze: 'rgba(255, 255, 255, 0.08)',

  // 8-Color Player Palette (Welcome screen & player pins)
  palette: [
    '#B8A3FF', // Spectral Violet
    '#C7F36B', // Acid Lime
    '#FF8A75', // Hunter Coral
    '#38BDF8', // Radar Cyan
    '#FBBF24', // Amber
    '#EC4899', // Pink
    '#06B6D4', // Sky
    '#A855F7', // Deep Violet
  ],
} as const;

export const lightColors = {
  // Screen & Surface (Afterimage warm paper-like light surfaces)
  background: '#F3F0E8',
  backgroundDark: '#E5E0D5',
  surface: '#FFFFFF',
  surfaceDark: '#F7F5EE',
  surfaceElevated: '#E9E5DC',
  surfaceMuted: '#DDD8CC',
  surfaceAlt: '#E9E5DC',

  // Borders
  border: '#D8D3C9',
  borderDark: '#BCB6A9',
  borderLight: '#E8E4DA',
  borderAccent: 'rgba(85, 122, 34, 0.4)',
  borderHunter: 'rgba(185, 75, 58, 0.4)',

  // Text
  text: '#202124',
  textLight: '#101014',
  textPrimary: '#202124',
  textMuted: '#5D5A62',
  textSecondary: '#5D5A62',
  textSubtle: '#8C8794',

  // Primary & Team Actions
  primary: '#557A22',
  primaryHover: '#45641B',
  primaryLight: 'rgba(85, 122, 34, 0.12)',
  primaryText: '#FFFFFF',
  accent: '#6650A4',
  runner: '#557A22',
  runnerHover: '#45641B',
  runnerText: '#FFFFFF',
  hunter: '#B94B3A',
  hunterHover: '#9E3E30',
  hunterText: '#FFFFFF',
  warning: '#D97706',

  // Brand & Ping (Spectral Violet)
  brandViolet: '#6650A4',
  pingViolet: '#6650A4',

  // Feedback & Tactical
  success: '#557A22',
  successText: '#FFFFFF',
  danger: '#B94B3A',
  dangerHover: '#9E3E30',
  dangerText: '#FFFFFF',
  dangerSurface: '#FEE2E2',
  dangerBorder: '#FCA5A5',
  dangerDisabled: '#F87171',
  shadow: '#000000',

  // Tactical Overlays (Hot & Cold, Radar, Echo)
  heatHot: '#B94B3A',
  heatCold: '#2563EB',
  radarScan: '#6650A4',
  ghostTrail: '#6650A4',
  ripple: 'rgba(102, 80, 164, 0.25)',
  fogHaze: 'rgba(0, 0, 0, 0.08)',

  // 8-Color Player Palette
  palette: [
    '#6650A4', // Spectral Violet
    '#557A22', // Acid Lime
    '#B94B3A', // Hunter Coral
    '#0284C7', // Sky
    '#D97706', // Amber
    '#DB2777', // Pink
    '#0891B2', // Cyan
    '#7E22CE', // Deep Violet
  ],
} as const;

export type ColorTokens = {
  [K in keyof typeof darkColors]: K extends 'palette' ? readonly string[] : string;
};

export const colors: ColorTokens = darkColors as unknown as ColorTokens;

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  button: 12,
  lg: 20,
  card: 28, // Cards use 28dp per §4.2
  pill: 24,
  full: 9999,
} as const;

export const motion = {
  feedback: 120, // Button taps, toggles
  transition: 240, // Screen transitions, sheets
  reveal: 600, // Role reveal, result reveal
  ambient: 1500, // Radar sweep, breathing glow
} as const;

export const typography = {
  fontSizes: {
    caption: 11,
    sub: 13,
    body: 15,
    subtitle: 16,
    heading: 18,
    title: 20,
    headline: 24,
    display: 28,
    hero: 34,
  },
  fontWeights: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    heavy: '800',
    black: '900',
  },
  lineHeights: {
    tight: 16,
    sub: 18,
    body: 22,
    heading: 26,
    display: 34,
    hero: 42,
  },
  letterSpacing: {
    normal: 0,
    wide: 0.5,
    caps: 1.2,
    mono: 1.5,
  },
} as const;

export const tokens = {
  colors: darkColors as unknown as ColorTokens,
  spacing,
  radii,
  motion,
  typography,
} as const;

export type ThemeTokens = {
  colors: ColorTokens;
  spacing: typeof spacing;
  radii: typeof radii;
  motion: typeof motion;
  typography: typeof typography;
};

export function getThemeTokens(mode: 'light' | 'dark'): ThemeTokens {
  return {
    colors: mode === 'light' ? (lightColors as unknown as ColorTokens) : (darkColors as unknown as ColorTokens),
    spacing,
    radii,
    motion,
    typography,
  };
}
