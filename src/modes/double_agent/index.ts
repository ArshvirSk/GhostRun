import { ModeModule } from '../types';

export const doubleAgentRole: ModeModule = {
  id: 'double_agent',
  layer: 'role',
  name: 'Double Agent',
  tagline: 'A secret saboteur in the hunter squad working to assist runners.',
  minPlayers: 4,
  idealPlayers: '6–16 players',
  difficulty: 3,
  complexity: 'high',
  safetyNotes: [
    'Social deduction element: accusations occur via in-game Tribunal voting only.',
  ],
  featureFlag: 'feature.role.double_agent',
  params: [],
  compatibleWith: ['classic_chase', 'tag_hunt', 'jailbreak', 'relay_heist'],
  rules: {
    summary:
      'One hunter is secretly assigned as a saboteur. The agent possesses Whisper (quadrant reveal) and Scramble (shifts next ping by 200m). Hunters can convene an emergency Tribunal to eject a suspect.',
    sections: [
      {
        title: 'Secret Role Secrecy',
        body: 'The Double Agent card is strictly private. Peers view the agent as a standard loyal hunter on rosters and radar.',
      },
      {
        title: 'Sabotage Powers',
        body: 'Whisper reveals the secret extraction quadrant to runners once per match. Scramble displaces a chosen runner next scheduled ping by 150–250m.',
      },
      {
        title: 'Hunter Tribunal',
        body: 'Hunters can trigger a majority vote against a suspect. Correctly ejecting the agent grants an immediate bonus ping; false ejection delays the next ping.',
      },
    ],
  },
  briefing: {
    codename: 'INTERNAL SABOTEUR',
    intel: [
      'Whisper reveals extraction quadrant once.',
      'Scramble shifts radar ping 150–250m.',
      'Tribunal vote requires majority hunter consensus.',
    ],
  },
};
