/**
 * GhostRun v3.0 Flagship Mode — Outbreak Horde Mode
 *
 * Registered base mode module conforming to the ModeModule architecture.
 */

import { ModeModule } from '../types';
import { outbreakHordeWidgets } from './hud';

export const outbreakHordeMode: ModeModule = {
  id: 'outbreak_horde',
  layer: 'base',
  name: 'Outbreak Horde',
  tagline: 'PvP infection swarm with biological lifespan decay and drifting antidote zones.',
  minPlayers: 3,
  idealPlayers: '6–30 players',
  difficulty: 2,
  complexity: 'high',
  safetyNotes: [
    'Pure human PvP: watch out for real-world park obstacles and uneven ground.',
    'Keep your phone loudspeaker active to hear environmental traffic.',
    'Emergency SOS pauses the match immediately.',
  ],
  featureFlag: 'feature.mode.outbreak_horde',
  params: [
    {
      key: 'initial_health_s',
      label: 'Initial Bio-Lifespan',
      type: 'slider',
      defaultValue: 360,
      min: 180,
      max: 600,
      step: 30,
      unit: 's',
      description: 'Starting biological health pool for human survivors before infection takes hold.',
    },
    {
      key: 'antidote_boost_hp',
      label: 'Antidote Health Bonus',
      type: 'slider',
      defaultValue: 65,
      min: 30,
      max: 120,
      step: 5,
      unit: 'HP',
      description: 'Lifespan seconds injected when stepping inside an active Antidote station.',
    },
    {
      key: 'drift_velocity_mps',
      label: 'Zone Drift Speed',
      type: 'slider',
      defaultValue: 0.6,
      min: 0,
      max: 1.5,
      step: 0.1,
      unit: 'm/s',
      description: 'Movement speed of dynamic antidote centroids gliding across arena paths.',
    },
  ],
  presets: {
    casual: {
      initial_health_s: 420,
      antidote_boost_hp: 80,
      drift_velocity_mps: 0.0,
      duration_minutes: 15,
      ping_interval_s: 120,
    },
    standard: {
      initial_health_s: 360,
      antidote_boost_hp: 65,
      drift_velocity_mps: 0.6,
      duration_minutes: 25,
      ping_interval_s: 90,
    },
    hardcore: {
      initial_health_s: 240,
      antidote_boost_hp: 45,
      drift_velocity_mps: 1.2,
      duration_minutes: 35,
      ping_interval_s: 60,
    },
  },
  placements: [],
  compatibleWith: ['noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'],
  rules: {
    summary:
      'One operative starts as Patient Zero. Survivors must navigate dynamic Antidote drops and manage biological health decay. Tagged survivors convert into the Zombie swarm.',
    sections: [
      {
        title: 'The Infection Swarm',
        body: '1 human Patient Zero hunts live human Survivors. When a Runner is tagged, they instantly convert into the Zombie swarm and hunt their former allies.',
      },
      {
        title: 'Biological Lifespan Clock',
        body: 'Each Survivor begins with 360s of life, ticking down at -1 HP/s. If your health reaches 0, you automatically convert into a Zombie.',
      },
      {
        title: 'Antidote Healing Drops',
        body: 'Dynamic green Antidote stations spawn and drift across the park. Enter the geofence to inject +65 HP and extend your survival.',
      },
      {
        title: 'Health-as-Currency Abilities',
        body: 'Spend life seconds to purchase tactical advantages: Cloak (35s) hides you from Zombie radar for 20s; Haste (25s) boosts sprint evasion for 15s.',
      },
      {
        title: 'Victory Conditions',
        body: 'Zombies win if all Survivors are converted before time runs out. Survivors win if any operative outlasts the match duration.',
      },
    ],
  },
  briefing: {
    codename: 'OUTBREAK HORDE',
    intel: [
      'Pure human PvP: trust your squad and keep moving.',
      'Antidote stations are prime ambush grounds for patient zombies.',
      'Spending life seconds for Cloak can save you from a corner trap.',
    ],
  },
  hudWidgets: outbreakHordeWidgets,
};
