/**
 * GhostRun v3.0 Flagship Mode — PINPOINT ("IRL OpenGuessr")
 *
 * Registered base mode module conforming to the ModeModule architecture.
 */

import { ModeModule } from '../types';

export const pinpointMode: ModeModule = {
  id: 'pinpoint',
  layer: 'base',
  name: 'Pinpoint',
  tagline: 'Geospatial OpenGuessr scavenger: deduce real-world landmarks and match camera perspectives.',
  minPlayers: 1,
  idealPlayers: '2–16 players',
  difficulty: 2,
  complexity: 'high',
  safetyNotes: [
    'Always keep eyes on the real-world terrain while scouting and sprinting.',
    'Never cross into private property, construction zones, or off-trail park areas.',
    'Do not walk with eyes locked onto the screen; look up at traffic intersections.',
    'Emergency SOS pauses the match countdown immediately.',
  ],
  featureFlag: 'feature.mode.pinpoint',
  params: [
    {
      key: 'radius_meters',
      label: 'Arena Geofence Radius',
      type: 'slider',
      defaultValue: 500,
      min: 150,
      max: 750,
      step: 50,
      unit: 'm',
      description: 'Maximum search boundary radius (up to 750m / 1.77 sq km).',
    },
    {
      key: 'photo_source',
      label: 'Photo Sourcing Method',
      type: 'enum',
      defaultValue: 'scout_and_swap',
      options: [
        { value: 'scout_and_swap', label: 'Method A: Scout & Swap (Turn-Based Peer Scouting)' },
        { value: 'host_drop', label: 'Method B: Host Pre-Drop (Curated Event Landmarks)' },
        { value: 'map_poi', label: 'Method C: Map POI Auto-Drop (Autonomous OSM POIs)' },
      ],
      description: 'Choose how target drop photographs are generated for each round.',
    },
    {
      key: 'total_rounds',
      label: 'Total Rounds',
      type: 'slider',
      defaultValue: 3,
      min: 1,
      max: 5,
      step: 1,
      unit: 'rds',
      description: 'Number of deduction rounds played before final scores are tallied.',
    },
    {
      key: 'round_duration_s',
      label: 'Round Time Limit',
      type: 'slider',
      defaultValue: 180,
      min: 120,
      max: 300,
      step: 30,
      unit: 's',
      description: 'Seconds allowed per round before the buzzer locks final submissions.',
    },
  ],
  presets: {
    casual: {
      duration_minutes: 15,
      ping_interval_s: 180,
      radius_meters: 250,
      round_duration_s: 240,
      total_rounds: 3,
    },
    standard: {
      duration_minutes: 20,
      ping_interval_s: 120,
      radius_meters: 500,
      round_duration_s: 180,
      total_rounds: 3,
    },
    hardcore: {
      duration_minutes: 25,
      ping_interval_s: 60,
      radius_meters: 750,
      round_duration_s: 120,
      total_rounds: 5,
    },
  },
  placements: [],
  compatibleWith: ['noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'],
  rules: {
    summary:
      'Players deduce physical real-world landmarks from target photos, navigate to the exact spot, align their perspective, and snap precision captures for up to 5,000 points.',
    sections: [
      {
        title: 'The OpenGuessr Deduction Challenge',
        body: 'Each round reveals a target photograph taken within the arena geofence. Operatives deduce the location from architectural cues, path layouts, sun shadows, and background landmarks.',
      },
      {
        title: 'Progressive Clue Timeline',
        body: 'Searching blind is never required: Hot & Cold acoustic sonar pulses unlock at T+0:45 (0.9x multiplier), sector quadrant triangulation at T+1:30 (0.8x multiplier), and directional compass vectors at T+2:15 (0.7x multiplier).',
      },
      {
        title: 'Onion-Skin Viewfinder Alignment',
        body: 'Use the live camera viewfinder with the semi-transparent target ghost overlay to match the original viewpoint. Snapping within 3 meters and 10 degrees orientation yields maximum points.',
      },
      {
        title: '5,000 Points Scoring Matrix',
        body: 'Scores decay with distance error (up to 4,000 pts), heading alignment (up to 500 pts), and elapsed sprint speed (up to 500 pts). The highest cumulative score takes victory.',
      },
    ],
  },
  briefing: {
    codename: 'PINPOINT',
    intel: [
      'Scout deceptive landmarks with recognizable features (plaques, brickwork, distinctive trees).',
      'If stuck during early search, listen for the acoustic sonar pulses unlocking at 45 seconds.',
      'Adjust the ghost opacity slider in the viewfinder to line up structural edges before shooting.',
    ],
  },
};
