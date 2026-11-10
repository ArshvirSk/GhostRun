/**
 * Tour Script interfaces (§7.2)
 *
 * Defines the scripted-state data model driving TourPlayer and the debug preview.
 * Fully deterministic, offline, and free of network or device location dependencies.
 */

export interface TourMarker {
  id: string;
  role: 'runner' | 'hunter' | 'target';
  x: number; // percentage coordinates (0-100) on simulated map canvas
  y: number;
  targetX?: number; // animated destination coordinates
  targetY?: number;
  label?: string;
  sublabel?: string;
  labelPosition?: 'top' | 'bottom' | 'right';
  isEcho?: boolean;
  isTagged?: boolean;
  isOutsideZone?: boolean;
}

export interface TourOverlay {
  type: 'radarSweep' | 'pingRipple' | 'heatWashHot' | 'heatWashCold' | 'zoneShrink' | 'pingPulse';
  x?: number;
  y?: number;
}

export interface TourCamera {
  zoom: number; // 1.0 (wide) to 1.6 (zoomed in)
  center: [number, number]; // [x, y] percentage
}

export interface TourBeat {
  id: string;
  beatNumber: number; // 1-8
  label: string; // e.g. "THE GROUND", "HEAD START", "DARK", "THE PING", "ECHO", "THE SQUEEZE", "TAG AND HEAT", "YOUR TURN"
  category?: string; // Optional display category tag
  title: string;
  subtitle: string;
  viewMode: 'runners' | 'hunters';
  badgeText?: string; // e.g. "HUNTERS' MAP"
  hudLeftLabel?: string; // e.g. "Time left", "Head start", "Round"
  hudLeftValue?: string; // e.g. "25:00", "2:04", "0:00", "28:38"
  hudRightLabel?: string; // e.g. "Next ping"
  hudRightValue?: string; // e.g. "2:00", "0:38", "Now", "—"
  hudRightProgress?: number; // 0 to 1 for ping progress bar
  hudRightSubtext?: string; // e.g. "Hunters see every runner"
  durationMs: number;
  timeLeftSeconds?: number;
  nextPingSeconds?: number;
  camera: TourCamera;
  zoneRadiusPct?: number; // 0 to 100 percentage of width (e.g. 76 for normal, 50 for squeezed)
  markers: TourMarker[];
  overlays: TourOverlay[];
  callToAction?: 'continue' | 'finish';
}

export interface TourScript {
  id: string;
  title: string;
  beats: TourBeat[];
}
