import { ModeModule } from '../types';

export const jailbreakMode: ModeModule = {
  id: 'jailbreak',
  layer: 'base',
  name: 'Jailbreak',
  tagline: 'Tagged runners are locked in jail. Infiltrate and execute a stealth rescue.',
  minPlayers: 5,
  idealPlayers: '6–16 players',
  difficulty: 2,
  complexity: 'high',
  safetyNotes: [
    'Jail placement must be in an open, safe public park area away from traffic.',
    'No physical contact required: rescues and tags are 100% digital proximity.',
  ],
  featureFlag: 'feature.mode.jailbreak',
  params: [
    {
      key: 'jail_radius_m',
      label: 'Jail Perimeter Radius',
      type: 'number',
      defaultValue: 15,
      min: 10,
      max: 50,
      step: 5,
      unit: 'm',
      description: 'Radius of the physical containment area.',
    },
    {
      key: 'auto_release_s',
      label: 'Passive Auto-Release Timer',
      type: 'number',
      defaultValue: 300,
      min: 60,
      max: 600,
      step: 30,
      unit: 's',
      description: 'Maximum prison dwell before automated release.',
    },
    {
      key: 'release_hold_s',
      label: 'Rescue Hold Duration',
      type: 'number',
      defaultValue: 10,
      min: 5,
      max: 30,
      step: 1,
      unit: 's',
      description: 'Continuous hold required within 10m to free prisoners.',
    },
    {
      key: 'release_radius_m',
      label: 'Rescue Trigger Distance',
      type: 'number',
      defaultValue: 10,
      min: 5,
      max: 25,
      step: 1,
      unit: 'm',
      description: 'Proximity required to initiate a stealth rescue.',
    },
  ],
  placements: [
    {
      kind: 'jail',
      label: 'Central Prison Camp',
      required: true,
      placedBy: 'host',
      visibleTo: 'all',
    },
  ],
  compatibleWith: ['noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'],
  rules: {
    summary:
      'When tagged, runners are sent to jail instead of being eliminated. Free runners can stage a 10-second stealth rescue at the jail perimeter.',
    sections: [
      {
        title: 'Jail Containment',
        body: 'Tagged runners must proceed to the physical jail zone. Jailed players do not emit radar pings.',
      },
      {
        title: 'Stealth Rescue',
        body: 'A free runner within 10m of the jail initiates a rescue. Holding position for 10 seconds silently frees all prisoners without alerting hunters.',
      },
      {
        title: 'Victory Conditions',
        body: 'Hunters win if all active runners are jailed simultaneously. Runners win if any runner survives when time expires.',
      },
    ],
  },
  briefing: {
    codename: 'PENAL INFILTRATION',
    intel: [
      'Jail location is visible to both squads from match start.',
      'Rescue attempts are 100% silent: hunters receive zero alert.',
      'Auto-release triggers automatically after 5 minutes.',
    ],
  },
};
