/**
 * GhostRun Design Tokens — Phase 1 Foundations (Today's Values)
 *
 * Captures the existing palette, typography scale, spacing, and radii currently in use.
 * Phase 2 will refine these to the "Night Radar" visual direction.
 */

export const colors = {
  // Screen & Surface
  background: '#E2E8F0',
  backgroundDark: '#0B1120',
  surface: '#FFFFFF',
  surfaceDark: '#1E293B',
  surfaceMuted: '#F8FAFC',
  surfaceAlt: '#1E293B',

  // Borders
  border: '#CBD5E1',
  borderDark: '#334155',
  borderLight: '#F1F5F9',

  // Text
  text: '#0F172A',
  textLight: '#FFFFFF',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',

  // Primary & Team Actions
  primary: '#1D4ED8',
  primaryHover: '#1E40AF',
  primaryLight: '#EFF6FF',
  accent: '#00FF66',
  runner: '#10B981',
  hunter: '#F59E0B',
  warning: '#F59E0B',

  // Feedback & Tactical
  success: '#10B981',
  successText: '#065F46',
  danger: '#DC2626',
  dangerText: '#991B1B',
  dangerSurface: '#FEF2F2',
  dangerBorder: '#FECACA',
  dangerDisabled: '#FCA5A5',

  // Tactical Overlays (Hot & Cold, Radar)
  heatHot: '#FF4D3D',
  heatCold: '#3D8BFF',
  radarScan: '#38BDF8',
  ghostTrail: '#8B5CF6',

  // 8-Color Player Palette (Welcome screen)
  palette: [
    '#38BDF8', // Cyan
    '#F43F5E', // Rose
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#8B5CF6', // Purple
    '#EC4899', // Pink
    '#06B6D4', // Sky
    '#84CC16', // Lime
  ],
} as const;

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
  md: 10,
  lg: 12,
  button: 12,
  card: 16,
  pill: 24,
  full: 9999,
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
    hero: 32,
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
  },
} as const;

export const tokens = {
  colors,
  spacing,
  radii,
  typography,
} as const;

export type ThemeTokens = typeof tokens;
