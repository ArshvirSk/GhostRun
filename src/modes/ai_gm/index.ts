import { ModeModule } from '../types';

export const aiGmModifier: ModeModule = {
  id: 'ai_gm',
  layer: 'modifier',
  name: 'AI Game Master',
  tagline: 'Deterministic server radio dispatcher injecting tactical dynamic events during play.',
  minPlayers: 2,
  idealPlayers: 'All player counts',
  difficulty: 2,
  complexity: 'low',
  safetyNotes: [
    'Zero external API dependencies: 100% deterministic Postgres logic.',
    'Atmospheric fog overlay reduces radar visibility without disabling safety beacons.',
  ],
  featureFlag: 'feature.modifier.ai_gm',
  params: [
    {
      key: 'max_events',
      label: 'Maximum Match Events',
      type: 'number',
      defaultValue: 12,
      min: 3,
      max: 20,
      step: 1,
      description: 'Maximum dynamic events the Game Master may inject per round.',
    },
    {
      key: 'event_interval_s',
      label: 'Event Trigger Cadence',
      type: 'number',
      defaultValue: 180,
      min: 60,
      max: 600,
      step: 30,
      unit: 's',
      description: 'Minimum duration between consecutive Game Master interventions.',
    },
  ],
  compatibleWith: ['classic_chase', 'tag_hunt', 'jailbreak', 'assassin_ring', 'relay_heist', 'territory_pulse', 'ghost_duel'],
  rules: {
    summary:
      'The automated Game Master analyzes public game pace and triggers 5 event types: Supply Drop, Double Ping, Radar Fog, Directional Rumour, and Perimeter Contraction.',
    sections: [
      {
        title: 'Tactical Interventions',
        body: 'Events appear on the in-game Radio Dispatch banner accompanied by audio cues. Hard cap of 12 events per match.',
      },
      {
        title: 'Secrecy Guarantee',
        body: 'The Game Master reads only public statistics and coarse quadrants. It never accesses secret roles or unmasked runner tracks.',
      },
    ],
  },
  briefing: {
    codename: 'RADIO DISPATCH',
    intel: [
      'Supply drops, fog, rumours, and emergency contractions.',
      'Cap of 12 interventions per game.',
    ],
  },
};
