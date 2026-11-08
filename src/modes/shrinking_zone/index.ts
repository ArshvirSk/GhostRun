import { ModeModule } from '../types';

export const shrinkingZoneModifier: ModeModule = {
  id: 'shrinking_zone',
  layer: 'modifier',
  name: 'Shrinking Zone',
  tagline: 'Play area contracts progressively in the final third of the round, squeezing squads closer.',
  minPlayers: 2,
  idealPlayers: 'All player counts',
  difficulty: 2,
  complexity: 'low',
  safetyNotes: [
    'Boundary contractions are announced 60s in advance.',
    'Out of bounds gives a 15-second grace period before releasing a penalty ping.',
  ],
  featureFlag: 'feature.modifier.shrinking_zone',
  params: [],
  compatibleWith: ['classic_chase', 'tag_hunt', 'jailbreak', 'assassin_ring', 'relay_heist', 'territory_pulse', 'ghost_duel'],
  rules: {
    summary:
      'The boundary stays at 100% until the final third of the round, then contracts through stage radii [100%, 70%, 45%].',
    sections: [
      {
        title: 'Stage Contractions',
        body: 'Pre-announcements warn all players 60s before each shrink step. Center never shifts; only radius contracts inward.',
      },
      {
        title: 'Out of Bounds Penalty',
        body: 'Exiting the safe perimeter grants a 15-second grace window to return inside. Lingering beyond grace emits continuous position pings to hunters.',
      },
    ],
  },
  briefing: {
    codename: 'ZONE COMPRESSION',
    intel: [
      'Contraction occurs strictly in the final third of the round.',
      '15-second grace period to return inside safe perimeter.',
    ],
  },
};
