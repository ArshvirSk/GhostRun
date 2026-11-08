import { ModeModule } from '../types';

export const hotColdModifier: ModeModule = {
  id: 'hot_cold',
  layer: 'modifier',
  name: 'Hot & Cold Hunt',
  tagline: 'Triples scheduled radar ping interval in exchange for on-demand proximity pulses.',
  minPlayers: 2,
  idealPlayers: 'All player counts',
  difficulty: 2,
  complexity: 'low',
  safetyNotes: [
    'Zero coordinate leakage: proximity returns only categorical temperature bands.',
  ],
  featureFlag: 'feature.modifier.hot_cold',
  params: [],
  compatibleWith: ['classic_chase', 'tag_hunt', 'jailbreak', 'relay_heist'],
  rules: {
    summary:
      'Hunters receive 6 shared HEAT charges. Activating HEAT pulses proximity to the nearest runner: Hot (<=75m), Warm (75–175m), Cold (>175m).',
    sections: [
      {
        title: 'Thermal Radar Pulses',
        body: 'HEAT probes reveal relative proximity without disclosing runner coordinates or headings. Scheduled pings are tripled to balance inference.',
      },
      {
        title: 'Runner Sensory Warning',
        body: 'Runners within 175m receive a subtle sensory pulse warning that a hunter has conducted a thermal scan.',
      },
    ],
  },
  briefing: {
    codename: 'THERMAL PROXIMITY',
    intel: [
      'Scheduled ping interval is tripled (3x).',
      'Shared pool of 6 HEAT charges with 10s personal cooldown.',
    ],
  },
};
