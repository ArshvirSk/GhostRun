/**
 * NF-25: Accessibility Extras Core Engine
 *
 * Provides:
 * 1. Specialized colorblind-safe palettes (Protanopia, Deuteranopia, Tritanopia).
 * 2. High-contrast outdoor sunlight token overrides.
 * 3. Large HUD scale multipliers.
 * 4. TalkBack / VoiceOver tactical narration formatters.
 */

export type ColorblindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export const COLORBLIND_MODE_LABELS: Record<ColorblindMode, string> = {
  none: 'Standard Vision (Default)',
  protanopia: 'Protanopia (Red-Weak)',
  deuteranopia: 'Deuteranopia (Green-Weak)',
  tritanopia: 'Tritanopia (Blue-Weak)',
};

export interface TacticalRadarPalette {
  runner: string;
  hunter: string;
  radarPing: string;
  safeZone: string;
  dangerZone: string;
}

export const RADAR_PALETTES: Record<ColorblindMode, TacticalRadarPalette> = {
  none: {
    runner: '#C7F36B', // Acid lime
    hunter: '#FF8A75', // Hunter coral
    radarPing: '#B8A3FF', // Spectral violet
    safeZone: 'rgba(199, 243, 107, 0.25)',
    dangerZone: 'rgba(255, 138, 117, 0.25)',
  },
  protanopia: {
    // Red-blind: replaces red/green with blue/amber
    runner: '#60A5FA', // Bright tactical blue
    hunter: '#FBBF24', // Amber gold
    radarPing: '#FFFFFF', // High-contrast white
    safeZone: 'rgba(96, 165, 250, 0.3)',
    dangerZone: 'rgba(251, 191, 36, 0.3)',
  },
  deuteranopia: {
    // Green-blind: replaces red/green with cyan/orange
    runner: '#38BDF8', // Cyan blue
    hunter: '#FB923C', // Deep orange
    radarPing: '#C084FC', // Light purple
    safeZone: 'rgba(56, 189, 248, 0.3)',
    dangerZone: 'rgba(251, 146, 60, 0.3)',
  },
  tritanopia: {
    // Blue-blind: distinct green vs magenta
    runner: '#4ADE80', // Mint green
    hunter: '#F43F5E', // Rose crimson
    radarPing: '#F8FAFC', // Pure white
    safeZone: 'rgba(74, 222, 128, 0.3)',
    dangerZone: 'rgba(244, 63, 94, 0.3)',
  },
};

export type HudScale = 'standard' | 'large' | 'extra_large';

export const HUD_SCALE_LABELS: Record<HudScale, string> = {
  standard: 'Standard (1.0x)',
  large: 'Large (1.25x)',
  extra_large: 'Extra Large (1.5x)',
};

export const HUD_SCALE_MULTIPLIERS: Record<HudScale, number> = {
  standard: 1.0,
  large: 1.25,
  extra_large: 1.5,
};

/**
 * Get active palette colors based on user's colorblind preference
 */
export function getRadarPalette(mode: ColorblindMode = 'none'): TacticalRadarPalette {
  return RADAR_PALETTES[mode] || RADAR_PALETTES.none;
}

/**
 * Returns high-contrast outdoor sunlight styling overrides
 */
export function getHighContrastOverlay(isSunlightMode: boolean): {
  backgroundOverlay: string;
  textContrast: string;
  borderStrokeWidth: number;
} {
  if (!isSunlightMode) {
    return {
      backgroundOverlay: 'rgba(5, 7, 9, 0.85)',
      textContrast: '#F8FAFC',
      borderStrokeWidth: 1,
    };
  }

  return {
    backgroundOverlay: '#000000',
    textContrast: '#FFFFFF',
    borderStrokeWidth: 2,
  };
}

/**
 * Formats an accessible TalkBack / VoiceOver audio briefing for assigned tactical role
 */
export function formatA11yRoleBriefing(
  role: 'runner' | 'hunter' | 'spectator' | 'operator',
  modeName: string
): string {
  switch (role) {
    case 'runner':
      return `Mission deployed: ${modeName}. You are a Runner. Evade hunters, use cover, and extract safely.`;
    case 'hunter':
      return `Mission deployed: ${modeName}. You are a Hunter. Track radar pings, pursue runners, and secure physical tags.`;
    case 'operator':
      return `Mission deployed: ${modeName}. You are an Overwatch Operator. Mark targets, scan zones, and support your squad remotely.`;
    default:
      return `Mission deployed: ${modeName}. You are a Spectator observing tactical field movements.`;
  }
}

/**
 * Format accessible VoiceOver / TalkBack announcements for tactical HUD events
 */
export function formatA11yHudAnnouncement(event: {
  type: 'ping' | 'distance' | 'tag_warning' | 'zone_warning';
  distanceMeters?: number;
  directionClock?: number; // 1 to 12
  zoneDistanceMeters?: number;
}): string {
  switch (event.type) {
    case 'ping': {
      const dist = event.distanceMeters !== undefined ? `${event.distanceMeters} meters away` : 'nearby';
      const clock = event.directionClock ? ` at ${event.directionClock} o'clock` : '';
      return `Radar ping detected: opponent ${dist}${clock}.`;
    }
    case 'distance':
      return `Target distance: ${event.distanceMeters ?? 0} meters.`;
    case 'tag_warning':
      return `Alert: Hunter closing in, ${event.distanceMeters ?? 0} meters. Sprint to evade.`;
    case 'zone_warning':
      return `Boundary warning: ${event.zoneDistanceMeters ?? 0} meters to perimeter edge. Turn back towards center.`;
    default:
      return 'Tactical update received.';
  }
}
