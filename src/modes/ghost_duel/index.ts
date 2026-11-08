import { ModeModule } from '../types';

export const ghostDuelMode: ModeModule = {
  id: 'ghost_duel',
  layer: 'base',
  name: 'Ghost Duel',
  tagline: 'Solo asynchronous race against a recorded ghost runner on real outdoor paths.',
  minPlayers: 1,
  idealPlayers: '1 player',
  difficulty: 2,
  complexity: 'low',
  safetyNotes: [
    'Solo runner mode: maintain situational awareness in outdoor parks.',
    'Privacy trimming: first and last 150m of paths are automatically trimmed.',
  ],
  featureFlag: 'feature.mode.ghost_duel',
  params: [
    {
      key: 'variant',
      label: 'Duel Challenge Variant',
      type: 'enum',
      defaultValue: 'time_trial',
      options: [
        { value: 'time_trial', label: 'Time Trial (Beat Ghost Pace)' },
        { value: 'evade', label: 'Evade (Outrun Pursuing Ghost)' },
        { value: 'mirror_chase', label: 'Mirror Chase (Hunt Ghost Runner)' },
      ],
      description: 'Asynchronous challenge rules against recorded ghost tracks.',
    },
  ],
  placements: [],
  compatibleWith: ['noise_meter', 'shrinking_zone', 'ai_gm'],
  rules: {
    summary:
      'Challenge an authentic runner route from the community ghost library. Compete against an animated ghost marker representing their exact recorded trail.',
    sections: [
      {
        title: 'Time Trial Variant',
        body: 'Race against the ghost to the finish target. Scores reward route efficiency and time delta.',
      },
      {
        title: 'Evade Variant',
        body: 'The ghost plays hunter and pursues your live GPS dot. Evade contact within 20m until reaching extraction.',
      },
      {
        title: 'Mirror Chase Variant',
        body: 'You play hunter chasing the ghost runner. Close within 10m and tap Tag Ghost to intercept.',
      },
    ],
  },
  briefing: {
    codename: 'SOLO GHOST PROTOCOL',
    intel: [
      'Ghost tracks replay real runner pacing and trail history.',
      'Solo min_players = 1 allows single-player outdoor training.',
      'Local leaderboard scores ranked by efficiency.',
    ],
  },
};
