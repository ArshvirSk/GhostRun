import { ModeModule } from '../types';

export const relayHeistMode: ModeModule = {
  id: 'relay_heist',
  layer: 'base',
  name: 'Relay Heist',
  tagline: 'Carry and pass contraband between runners to reach extraction before hunters intercept.',
  minPlayers: 3,
  idealPlayers: '6–14 players',
  difficulty: 2,
  complexity: 'high',
  safetyNotes: [
    'Package handoffs require close proximity (<5m): avoid abrupt stops.',
    'Extraction zone must maintain a safe buffer from roads.',
  ],
  featureFlag: 'feature.mode.relay_heist',
  params: [],
  placements: [
    {
      kind: 'extraction',
      label: 'Extraction Point',
      required: true,
      placedBy: 'host',
      visibleTo: 'all',
    },
  ],
  compatibleWith: ['noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'],
  rules: {
    summary:
      'Runners must escort a high-value package to extraction. The package can be passed between runners within 5m. If the carrier is tagged, the package drops.',
    sections: [
      {
        title: 'The Courier Chain',
        body: 'One runner starts as carrier. The package identity is hidden from hunters while carried. When within 5m of a teammate, the carrier can execute a handoff.',
      },
      {
        title: 'Package Interception',
        body: 'Tagging the carrier causes the package to drop and illuminate as a public beacon on hunter maps. Hunters must secure it with a 20s hold.',
      },
      {
        title: 'Carrier Extraction',
        body: 'If any active runner holding the package reaches the extraction point, runners secure the win.',
      },
    ],
  },
  briefing: {
    codename: 'CONTRABAND RELAY',
    intel: [
      'Carried package emits 1.5x frequent radar pings.',
      'Dropped package beacon is broadcast publicly to all players.',
      'Mutual 5m proximity required for handoff confirmation.',
    ],
  },
};
