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
  label?: string;
  isEcho?: boolean;
  isTagged?: boolean;
  isOutsideZone?: boolean;
}

export interface TourOverlay {
  type: 'radarSweep' | 'pingRipple' | 'heatWashHot' | 'heatWashCold' | 'zoneShrink';
  x?: number;
  y?: number;
}

export interface TourCamera {
  zoom: number;
  center: [number, number]; // [x, y] percentage
}

export interface TourBeat {
  id: string;
  beatNumber: number; // 1-8
  label: string; // e.g. "THE GROUND"
  title: string;
  subtitle: string;
  viewMode: 'runners' | 'hunters';
  durationMs: number;
  timeLeftSeconds?: number;
  nextPingSeconds?: number;
  camera: TourCamera;
  markers: TourMarker[];
  overlays: TourOverlay[];
  callToAction?: 'continue' | 'finish';
}

export interface TourScript {
  id: string;
  title: string;
  beats: TourBeat[];
}
