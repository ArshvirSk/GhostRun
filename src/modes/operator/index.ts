import { ModeModule } from '../types';

export const operatorRole: ModeModule = {
  id: 'operator',
  layer: 'role',
  name: 'Operator',
  tagline: 'Remote tactical coordinator guiding squad field operatives from desktop or home.',
  minPlayers: 3,
  idealPlayers: '6–18 players',
  difficulty: 2,
  complexity: 'high',
  safetyNotes: [
    'Remote role: no outdoor GPS movement required.',
    'Immune to in-game tagging; cannot tag field operatives.',
  ],
  featureFlag: 'feature.role.operator',
  params: [],
  compatibleWith: ['classic_chase', 'tag_hunt', 'jailbreak', 'relay_heist', 'territory_pulse'],
  rules: {
    summary:
      'One player per squad may designate as a remote Operator. Operators do not share location or run outdoors. They place tactical markers, scan enemy sectors, and broadcast tactical radio comms.',
    sections: [
      {
        title: 'Tactical Markers',
        body: 'Operators place up to 3 concurrent tactical markers on the map. Markers are strictly isolated to squad teammates.',
      },
      {
        title: 'Tactical Recon Scans',
        body: 'Runner Operator triggers a 150m fuzzed sweep envelope around the nearest hunter (90s cooldown). Hunter Operator conducts a boundary census returning runner count.',
      },
    ],
  },
  briefing: {
    codename: 'REMOTE TACTICAL CONSOLE',
    intel: [
      'At most 1 remote Operator per squad.',
      'Placing up to 3 tactical waypoint markers.',
      'Runner scan: 150m envelope. Hunter scan: proximity census count.',
    ],
  },
};
