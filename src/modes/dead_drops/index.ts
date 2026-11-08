import { ModeModule } from '../types';

export const deadDropsModifier: ModeModule = {
  id: 'dead_drops',
  layer: 'modifier',
  name: 'Dead Drops',
  tagline: 'Claim physical supply beacons hidden on the field for tactical utility charges.',
  minPlayers: 2,
  idealPlayers: 'All player counts',
  difficulty: 2,
  complexity: 'high',
  safetyNotes: [
    'Supply drops spawn inside a 60m buffer from outer play area perimeters.',
    'Claims require a 4-second continuous hold within 15 meters.',
  ],
  featureFlag: 'feature.modifier.dead_drops',
  params: [],
  compatibleWith: ['classic_chase', 'tag_hunt', 'jailbreak', 'assassin_ring', 'relay_heist', 'territory_pulse'],
  rules: {
    summary:
      'Hidden tactical drops spawn throughout the play area. Players within 40m reveal the beacon and can hold position for 4s to claim an item.',
    sections: [
      {
        title: 'Tactical Item Drops',
        body: 'Runners claim Veil (suppresses next scheduled ping), Decoy (emits false ping), or Burn (clears recent trail). Hunters claim Ping (forces instant ping), Jam, or Sweep.',
      },
    ],
  },
  briefing: {
    codename: 'DEAD DROP CACHES',
    intel: [
      'Drops reveal only when within 40 meters.',
      'Claim hold requires 4 seconds within 15 meters.',
    ],
  },
};
