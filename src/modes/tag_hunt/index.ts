import { ModeModule } from '../types';

export const tagHuntMode: ModeModule = {
  id: 'tag_hunt',
  layer: 'base',
  name: 'Tag Hunt',
  tagline: 'Pure survival pursuit with no extraction target. Outlast the clock.',
  minPlayers: 2,
  idealPlayers: '4–16 players',
  difficulty: 1,
  complexity: 'low',
  safetyNotes: [
    'No extraction zone: stay inside the active play boundary.',
    'Pace your stamina for the full round duration.',
    'Emergency SOS pauses the match immediately.',
  ],
  featureFlag: 'feature.mode.tag_hunt',
  params: [],
  presets: {
    casual: { duration_minutes: 15, ping_interval_s: 180 },
    standard: { duration_minutes: 25, ping_interval_s: 120 },
    hardcore: { duration_minutes: 40, ping_interval_s: 60 },
  },
  placements: [],
  compatibleWith: ['noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'],
  rules: {
    summary:
      'Runners must survive until the round timer expires. Hunters must tag and eliminate every runner.',
    sections: [
      {
        title: 'Survival Protocol',
        body: 'There is no extraction target. If at least one active runner survives until the clock reaches zero, runners win.',
      },
      {
        title: 'Hunter Sweeps',
        body: 'Hunters rely exclusively on periodic radar pings to herd and corner runners inside the play area boundary.',
      },
    ],
  },
  briefing: {
    codename: 'RADAR SURVIVAL',
    intel: [
      'No fixed objective: terrain mastery is your only shield.',
      'Last runner standing secures the squad victory.',
    ],
  },
};
