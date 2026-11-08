import { ModeModule } from '../types';

export const noiseMeterModifier: ModeModule = {
  id: 'noise_meter',
  layer: 'modifier',
  name: 'Noise Meter',
  tagline: 'Moving too quickly spikes acoustic loudness, triggering emergency hunter pings.',
  minPlayers: 2,
  idealPlayers: 'All player counts',
  difficulty: 1,
  complexity: 'low',
  safetyNotes: [
    'Encourages stealth and deliberate movement over continuous all-out sprinting.',
  ],
  featureFlag: 'feature.modifier.noise_meter',
  params: [],
  compatibleWith: ['classic_chase', 'tag_hunt', 'jailbreak', 'assassin_ring', 'relay_heist', 'ghost_duel'],
  rules: {
    summary:
      'Runner movement speed drives a noise meter bar. Walking generates light noise; sprinting spikes the bar to 100, immediately releasing a noise-spark ping to hunters.',
    sections: [
      {
        title: 'Acoustic Loudness Meter',
        body: 'Exponential moving average of runner speed. Passing 60 warns the runner with subtle haptics. Hitting 100 instantly emits an alert ping.',
      },
      {
        title: 'Camping Penalty',
        body: 'Staying within a 15m radius for more than 4 minutes emits an advisory camping ping to hunters.',
      },
    ],
  },
  briefing: {
    codename: 'SONIC DETECTOR',
    intel: [
      'Speed exceeding 2.8 m/s spikes the meter rapidly.',
      'Crossing 100 triggers an instant hunter alert.',
    ],
  },
};
