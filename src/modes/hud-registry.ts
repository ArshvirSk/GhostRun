import type { HudWidget } from './types';
import { classicChaseWidgets } from './classic_chase/hud';
import { tagHuntWidgets } from './tag_hunt/hud';
import { jailbreakWidgets } from './jailbreak/hud';
import { assassinRingWidgets } from './assassin_ring/hud';
import { relayHeistWidgets } from './relay_heist/hud';
import { territoryPulseWidgets } from './territory_pulse/hud';
import { ghostDuelWidgets } from './ghost_duel/hud';
import { noiseMeterWidgets } from './noise_meter/hud';
import { deadDropsWidgets } from './dead_drops/hud';
import { hotColdWidgets } from './hot_cold/hud';
import { shrinkingZoneWidgets } from './shrinking_zone/hud';
import { aiGmWidgets } from './ai_gm/hud';
import { doubleAgentWidgets } from './double_agent/hud';
import { vipWidgets } from './vip/hud';
import { operatorWidgets } from './operator/hud';

export const HUD_WIDGETS_BY_MODE: Record<string, HudWidget[]> = {
  // Base modes
  classic_chase: classicChaseWidgets,
  tag_hunt: tagHuntWidgets,
  jailbreak: jailbreakWidgets,
  assassin_ring: assassinRingWidgets,
  relay_heist: relayHeistWidgets,
  territory_pulse: territoryPulseWidgets,
  ghost_duel: ghostDuelWidgets,

  // Modifiers
  noise_meter: noiseMeterWidgets,
  dead_drops: deadDropsWidgets,
  hot_cold: hotColdWidgets,
  shrinking_zone: shrinkingZoneWidgets,
  ai_gm: aiGmWidgets,

  // Roles
  double_agent: doubleAgentWidgets,
  vip: vipWidgets,
  operator: operatorWidgets,
};

/**
 * Collect all registered HUD widgets for active mode, modifiers, and roles.
 */
export function getActiveHudWidgets(
  modeId: string,
  modifiers: string[] = [],
  roles: string[] = []
): HudWidget[] {
  const widgets: HudWidget[] = [];

  const baseWidgets = HUD_WIDGETS_BY_MODE[modeId];
  if (baseWidgets) {
    widgets.push(...baseWidgets);
  }

  for (const modId of modifiers) {
    const modWidgets = HUD_WIDGETS_BY_MODE[modId];
    if (modWidgets) {
      widgets.push(...modWidgets);
    }
  }

  for (const roleId of roles) {
    const roleWidgets = HUD_WIDGETS_BY_MODE[roleId];
    if (roleWidgets) {
      widgets.push(...roleWidgets);
    }
  }

  return widgets;
}
