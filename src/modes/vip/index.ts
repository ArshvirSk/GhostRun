import { ModeModule } from '../types';

export const vipRole: ModeModule = {
  id: 'vip',
  layer: 'role',
  name: 'VIP Escort',
  tagline: 'Protect the high-value asset. Tagging bodyguards triggers temporary freeze.',
  minPlayers: 4,
  idealPlayers: '6–16 players',
  difficulty: 2,
  complexity: 'high',
  safetyNotes: [
    'Physical clustering around the VIP is tactical: maintain safe running distances.',
    'Bodyguard freeze mechanic prevents tackles: 60s freeze immobilizes digitally.',
  ],
  featureFlag: 'feature.role.vip',
  params: [],
  compatibleWith: ['classic_chase', 'tag_hunt'],
  rules: {
    summary:
      'Runners squad designates 1 VIP and 1+ Bodyguards. Hunter tags against Bodyguards trigger a 60s freeze without elimination. Tagging the VIP ends the game for hunters.',
    sections: [
      {
        title: 'Bodyguard Shield',
        body: 'When a hunter tags a Bodyguard, the bodyguard is frozen for 60s and cannot move. Tagging an already frozen bodyguard is invalid.',
      },
      {
        title: 'Tactical Role Swap',
        body: 'The VIP and an active Bodyguard within 5m can initiate an in-game role swap (120s cooldown), confusing visual hunter tracking.',
      },
      {
        title: 'VIP Extraction',
        body: 'In Classic Chase, only the VIP reaching extraction triggers a runner victory.',
      },
    ],
  },
  briefing: {
    codename: 'HIGH VALUE ASSET',
    intel: [
      'VIP identity is concealed from hunters until match end.',
      'Bodyguards absorb tags with a 60-second freeze state.',
      'Role swaps permitted every 120 seconds within 5m.',
    ],
  },
};
