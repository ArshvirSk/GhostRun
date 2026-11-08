import { ModeModule } from '../types';

export const assassinRingMode: ModeModule = {
  id: 'assassin_ring',
  layer: 'base',
  name: 'Assassin Ring',
  tagline: 'Solo contract hunt. Every agent hunts their target while evading an unknown pursuer.',
  minPlayers: 3,
  idealPlayers: '6–16 players',
  difficulty: 3,
  complexity: 'high',
  safetyNotes: [
    'Solo free-for-all: play in daylight or well-lit public pedestrian areas.',
    'Safe zones provide temporary immunity from tagging.',
    'Maintain safe distance at all times: zero physical contact.',
  ],
  featureFlag: 'feature.mode.assassin_ring',
  params: [],
  placements: [
    {
      kind: 'safe_zone',
      label: 'Safe Zones',
      required: true,
      placedBy: 'server',
      visibleTo: 'all',
    },
  ],
  compatibleWith: ['noise_meter', 'dead_drops', 'shrinking_zone', 'ai_gm'],
  rules: {
    summary:
      'A continuous closed ring of contracts. You are assigned one prey to track and tag, while an unknown hunter is tracking you.',
    sections: [
      {
        title: 'Single-Cycle Contract Ring',
        body: 'Each player receives periodic radar pings of their assigned prey only. You never know who is hunting you.',
      },
      {
        title: 'Sensory Proximity Warnings',
        body: 'When your unknown pursuer closes within 100m, your device hums with a directionless proximity pulse. Within 40m, the alert intensifies.',
      },
      {
        title: 'Safe Zones & Relinking',
        body: 'Tagging inside designated Safe Zones is disabled. Tagging your target eliminates them and instantly re-assigns their prey to you.',
      },
      {
        title: 'Last Survivor',
        body: 'Eliminations continue until the ring contracts to 1 final survivor, who claims victory.',
      },
    ],
  },
  briefing: {
    codename: 'SHADOW CONTRACT',
    intel: [
      'Prey identity is revealed exclusively to you.',
      'Proximity hum indicates your hunter is within 40–100m.',
      'Safe zones grant complete tag immunity.',
    ],
  },
};
