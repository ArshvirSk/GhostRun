/**
 * GhostRun Design Tokens — Direction A: "Night Radar" (Phase 2 Design System)
 *
 * Implements the verified Night Radar aesthetic:
 * Deep charcoal canvas (#050709), pitch-black card surfaces (#0D1117, #161B22),
 * phosphor mint for runners (#3DFFA2), tactical amber for hunters (#FF5C00),
 * heat wash (#FF4D3D / #3D8BFF), radar scan cyan (#38BDF8), and ghost purple (#A855F7).
 */

export const colors = {
  // Screen & Surface (Night Radar dark canvas)
  background: '#050709',
  backgroundDark: '#020406',
  surface: '#0D1117',
  surfaceDark: '#080B0E',
  surfaceElevated: '#161B22',
  surfaceMuted: '#1F242C',
  surfaceAlt: '#161B22',

  // Borders
  border: '#21262D',
  borderDark: '#30363D',
  borderLight: '#161B22',
  borderAccent: 'rgba(61, 255, 162, 0.4)',
  borderHunter: 'rgba(255, 92, 0, 0.4)',

  // Text
  text: '#E8F0EC',
  textLight: '#FFFFFF',
  textMuted: '#8A9AA3',
  textSubtle: '#58656E',

  // Primary & Team Actions
  primary: '#3DFFA2',
  primaryHover: '#2CE08C',
  primaryLight: 'rgba(61, 255, 162, 0.12)',
  accent: '#3DFFA2',
  runner: '#3DFFA2',
  hunter: '#FF5C00',
  hunterHover: '#E05200',
  hunterText: '#1F0B00',
  warning: '#FFB020',

  // Feedback & Tactical
  success: '#3DFFA2',
  successText: '#052917',
  danger: '#FF4D3D',
  dangerHover: '#E03D2E',
  dangerText: '#FFE5E3',
  dangerSurface: '#240C0B',
  dangerBorder: '#5C1D1A',
  dangerDisabled: '#3D1513',
  shadow: '#000000',

  // Tactical Overlays (Hot & Cold, Radar, Echo)
  heatHot: '#FF4D3D',
  heatCold: '#3D8BFF',
  radarScan: '#38BDF8',
  ghostTrail: '#A855F7',
  ripple: 'rgba(56, 189, 248, 0.25)',
  fogHaze: 'rgba(255, 255, 255, 0.08)',

  // 8-Color Player Palette (Welcome screen & player pins)
  palette: [
    '#38BDF8', // Cyan
    '#F43F5E', // Rose
    '#3DFFA2', // Phosphor Mint
    '#FFB020', // Amber
    '#A855F7', // Purple
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
  colors,
  spacing,
  radii,
  motion,
  typography,
} as const;

export type ThemeTokens = typeof tokens;
