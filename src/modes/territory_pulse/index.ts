import { ModeModule } from '../types';

export const territoryPulseMode: ModeModule = {
  id: 'territory_pulse',
  layer: 'base',
  name: 'Territory Pulse',
  tagline: 'Control 7 radial sectors across synchronous pulse ticks. Dominance or points victory.',
  minPlayers: 2,
  idealPlayers: '6–18 players',
  difficulty: 3,
  complexity: 'high',
  safetyNotes: [
    'Fast-paced sector movement: watch terrain elevation and street curbs.',
    'Contest tagging applies a 60s freeze without physical elimination.',
  ],
  featureFlag: 'feature.mode.territory_pulse',
  params: [
    {
      key: 'zone_count',
      label: 'Sector Count',
      type: 'number',
      defaultValue: 7,
      min: 3,
      max: 7,
      step: 2,
      description: 'Number of radial sectors procedurally generated.',
    },
    {
      key: 'dominance_pct',
      label: 'Dominance Threshold (%)',
      type: 'number',
      defaultValue: 70,
      min: 50,
      max: 100,
      step: 10,
      unit: '%',
      description: 'Percentage of sectors required to trigger instant dominance win.',
    },
    {
      key: 'zone_radius_m',
      label: 'Sector Zone Radius',
      type: 'number',
      defaultValue: 60,
      min: 30,
      max: 120,
      step: 5,
      unit: 'm',
      description: 'Radius of each circular capture zone.',
    },
    {
      key: 'pulse_interval_s',
      label: 'Pulse Tick Cadence',
      type: 'number',
      defaultValue: 90,
      min: 30,
      max: 180,
      step: 15,
      unit: 's',
      description: 'Seconds between synchronized territory score evaluations.',
    },
  ],
  placements: [
    {
      kind: 'zone',
      label: 'Territory Sectors',
      required: true,
      placedBy: 'server',
      visibleTo: 'all',
    },
  ],
  compatibleWith: ['dead_drops', 'shrinking_zone', 'ai_gm'],
  rules: {
    summary:
      'Seven sectors tessellate the play area. Teams compete for numerical player majority evaluated at discrete pulse intervals.',
    sections: [
      {
        title: 'Synchronous Pulse Evaluation',
        body: 'Sectors capture on pulse ticks (every 90 seconds). Neutral zones flip immediately on majority. Flipping an opponent held sector requires 2 consecutive pulses.',
      },
      {
        title: 'Contest Tags',
        body: 'Physical tags do not eliminate players. Tagged players enter a 60-second incapacitation where they cannot contribute to sector presence.',
      },
      {
        title: 'Dominance & Points',
        body: 'Holding >= 70% of sectors (5 of 7) across 2 pulses triggers instant Dominance victory. Otherwise, team with highest points at timeout wins.',
      },
    ],
  },
  briefing: {
    codename: 'SECTOR DOMINANCE',
    intel: [
      'Central Core sector anchored by 6 outer radial sectors.',
      'Majority evaluated every 90 seconds.',
      'Tags incapacitate presence for 60 seconds.',
    ],
  },
};
