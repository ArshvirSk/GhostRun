import { ModeModule } from '../types';

export const classicChaseMode: ModeModule = {
  id: 'classic_chase',
  layer: 'base',
  name: 'Classic Chase',
  tagline: 'Outrun delayed radar pings and reach the secret extraction target.',
  minPlayers: 2,
  idealPlayers: '4–12 players',
  difficulty: 1,
  complexity: 'low',
  safetyNotes: [
    'Always remain alert to pedestrians and traffic.',
    'Keep your eyes on the real world while navigating.',
    'Never enter private property or construction zones.',
  ],
  featureFlag: 'feature.mode.classic_chase',
  params: [],
  presets: {
    casual: { duration_minutes: 20, ping_interval_s: 180 },
    standard: { duration_minutes: 30, ping_interval_s: 120 },
    hardcore: { duration_minutes: 45, ping_interval_s: 60 },
  },
  placements: [
    {
      kind: 'target',
      label: 'Secret Extraction Target',
      required: true,
      placedBy: 'host',
      visibleTo: 'team',
    },
  ],
  compatibleWith: ['noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'],
  rules: {
    summary:
      'Runners must reach the secret target before the timer expires. Hunters track runners using delayed periodic radar pings.',
    sections: [
      {
        title: 'The Extraction Objective',
        body: 'Runners know the secret extraction point location. Hunters do not. If any runner reaches the target zone, runners win.',
      },
      {
        title: 'Delayed Radar Pings',
        body: 'Every few minutes, the radar releases a snapshot of active runner positions. Pings only show where you were, not where you are.',
      },
      {
        title: 'Tagging & Elimination',
        body: 'Hunters tag runners within 20 meters. If all runners are eliminated before reaching the extraction point, hunters win.',
      },
    ],
  },
  briefing: {
    codename: 'EXTRACTION RUN',
    intel: [
      'Infiltration target is kept secret from hunting squad.',
      'Radar snapshots release every 120 seconds.',
      'Sprinting creates audible radar noise spikes.',
    ],
  },
};
