/**
 * GhostRun v3.0 Outbreak Horde Mode — Tactical HUD Widgets
 *
 * Implements:
 * 1. BioHealthBarWidget: Lifespan countdown bar with emerald/amber/crimson danger auras and distress alerts.
 * 2. AbilityDrawerWidget: Persistent dock for 1-tap bio-currency purchases (Cloak, Haste, Decoy).
 * 3. ZombieInfectButtonWidget: Red tactile action button for Zombie players to infect nearby survivors.
 * 4. AntidoteNearbyBannerWidget: Tactical overlay guiding runners toward nearby antidote drops.
 */

import React, { memo, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { useTheme } from '../../theme/ThemeProvider';
import { triggerHaptic } from '../../motion/haptics';
import { GeoJSONSource, Layer } from '../../lib/map';
import { circleRing, type PointCollection } from '../../lib/geo';
import type { HudWidget, HudWidgetProps } from '../types';
import { AbilityType, OUTBREAK_ABILITIES } from './types';

/**
 * 1. BioHealthBarWidget (Top Banner Slot)
 * Displays real-time bio-lifespan countdown and biological distress status.
 */
export const BioHealthBarWidget = memo(function BioHealthBarWidget({
  state,
}: HudWidgetProps) {
  const { colors, radii } = useTheme();

  // Extract outbreak state or fallback to default
  const modeData = (state?.game as any)?.mode_data;
  const bioHealthSeconds = modeData?.bio_health_seconds ?? 300;
  const maxHealth = modeData?.max_health_seconds ?? 360;
  const healthPercent = Math.min(100, Math.max(0, (bioHealthSeconds / maxHealth) * 100));

  const isDistressed = bioHealthSeconds < 60;
  const isCritical = bioHealthSeconds < 30;

  const barColor = isCritical
    ? colors.danger
    : isDistressed
      ? colors.warning
      : colors.accent;

  return (
    <View
      style={[
        styles.healthBanner,
        {
          backgroundColor: colors.surface,
          borderColor: isCritical ? colors.danger : colors.borderDark,
          borderRadius: radii.md,
        },
      ]}
    >
      <View style={styles.healthHeader}>
        <View style={styles.healthLabelRow}>
          <Ionicons
            name={isDistressed ? 'warning-outline' : 'shield-checkmark-outline'}
            size={14}
            color={barColor}
          />
          <Text
            variant="label"
            style={[styles.healthTitle, { color: barColor }]}
          >
            {isDistressed ? 'BIO-DISTRESS ACTIVE' : 'BIO-LIFESPAN'}
          </Text>
        </View>
        <Text
          variant="label"
          style={[styles.healthValue, { color: colors.text }]}
        >
          {Math.ceil(bioHealthSeconds)}s
        </Text>
      </View>

      <View
        style={[
          styles.gaugeTrack,
          { backgroundColor: colors.surfaceElevated, borderRadius: radii.full },
        ]}
      >
        <View
          style={[
            styles.gaugeFill,
            {
              width: `${healthPercent}%`,
              backgroundColor: barColor,
              borderRadius: radii.full,
            },
          ]}
        />
      </View>

      {isDistressed && (
        <Text
          variant="caption"
          style={[styles.distressNotice, { color: colors.danger }]}
        >
          Distress ping broadcasting to nearby zombies. Find an antidote station.
        </Text>
      )}
    </View>
  );
});

/**
 * 2. AbilityDrawerWidget (Actions Slot)
 * Quick-trigger dock for buying survival abilities with bio-lifespan seconds.
 */
export const AbilityDrawerWidget = memo(function AbilityDrawerWidget({
  state,
  actions,
}: HudWidgetProps) {
  const { colors, radii } = useTheme();
  const [activeAbility, setActiveAbility] = useState<AbilityType | null>(null);

  const modeData = (state?.game as any)?.mode_data;
  const currentHealth = modeData?.bio_health_seconds ?? 300;

  const handleAbilityTap = (abilityType: AbilityType) => {
    const ability = OUTBREAK_ABILITIES[abilityType];
    if (currentHealth <= ability.costHp) {
      triggerHaptic('error');
      return;
    }

    triggerHaptic('buttonTap');
    if (typeof (actions as any)?.deductBioHealth === 'function') {
      (actions as any).deductBioHealth(ability.costHp);
    }
    setActiveAbility(abilityType);
    setTimeout(() => {
      setActiveAbility(null);
    }, ability.durationS * 1000);
  };

  return (
    <View style={styles.abilitiesContainer}>
      {/* Cloak Button */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Activate Cloak for 35 health seconds"
        disabled={currentHealth <= 35 || activeAbility === 'cloak'}
        onPress={() => handleAbilityTap('cloak')}
        style={[
          styles.abilityButton,
          {
            backgroundColor:
              activeAbility === 'cloak'
                ? 'rgba(168, 85, 247, 0.25)'
                : currentHealth <= 35
                  ? colors.surfaceElevated
                  : colors.surface,
            borderColor: activeAbility === 'cloak' ? colors.primary : colors.borderDark,
            borderRadius: radii.pill,
          },
        ]}
      >
        <Ionicons
          name="eye-off-outline"
          size={14}
          color={activeAbility === 'cloak' ? colors.primary : colors.textMuted}
        />
        <Text
          variant="label"
          style={[
            styles.abilityText,
            {
              color:
                activeAbility === 'cloak'
                  ? colors.primary
                  : currentHealth <= 35
                    ? colors.textMuted
                    : colors.text,
            },
          ]}
        >
          {activeAbility === 'cloak' ? 'CLOAKED' : 'CLOAK -35s'}
        </Text>
      </Pressable>

      {/* Haste Button */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Activate Haste for 25 health seconds"
        disabled={currentHealth <= 25 || activeAbility === 'haste'}
        onPress={() => handleAbilityTap('haste')}
        style={[
          styles.abilityButton,
          {
            backgroundColor:
              activeAbility === 'haste'
                ? 'rgba(16, 185, 129, 0.25)'
                : currentHealth <= 25
                  ? colors.surfaceElevated
                  : colors.surface,
            borderColor: activeAbility === 'haste' ? colors.accent : colors.borderDark,
            borderRadius: radii.pill,
          },
        ]}
      >
        <Ionicons
          name="flash-outline"
          size={14}
          color={activeAbility === 'haste' ? colors.accent : colors.textMuted}
        />
        <Text
          variant="label"
          style={[
            styles.abilityText,
            {
              color:
                activeAbility === 'haste'
                  ? colors.accent
                  : currentHealth <= 25
                    ? colors.textMuted
                    : colors.text,
            },
          ]}
        >
          {activeAbility === 'haste' ? 'HASTED' : 'HASTE -25s'}
        </Text>
      </Pressable>

      {/* Decoy Button */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Deploy Decoy Ping for 20 health seconds"
        disabled={currentHealth <= 20 || activeAbility === 'decoy'}
        onPress={() => handleAbilityTap('decoy')}
        style={[
          styles.abilityButton,
          {
            backgroundColor:
              activeAbility === 'decoy'
                ? 'rgba(245, 158, 11, 0.25)'
                : currentHealth <= 20
                  ? colors.surfaceElevated
                  : colors.surface,
            borderColor: activeAbility === 'decoy' ? colors.warning : colors.borderDark,
            borderRadius: radii.pill,
          },
        ]}
      >
        <Ionicons
          name="radio-outline"
          size={14}
          color={activeAbility === 'decoy' ? colors.warning : colors.textMuted}
        />
        <Text
          variant="label"
          style={[
            styles.abilityText,
            {
              color:
                activeAbility === 'decoy'
                  ? colors.warning
                  : currentHealth <= 20
                    ? colors.textMuted
                    : colors.text,
            },
          ]}
        >
          {activeAbility === 'decoy' ? 'DECOY SENT' : 'DECOY -20s'}
        </Text>
      </Pressable>
    </View>
  );
});

/**
 * 3. ZombieInfectButtonWidget (Actions Slot)
 * Zombie swarm attack button to tag and convert live survivors.
 */
export const ZombieInfectButtonWidget = memo(function ZombieInfectButtonWidget({
  actions,
}: HudWidgetProps) {
  const [infecting, setInfecting] = useState(false);

  const handleInfect = async () => {
    setInfecting(true);
    triggerHaptic('tagConfirmed');
    await actions.attemptTag();
    setInfecting(false);
  };

  return (
    <Pressable
      accessibilityLabel="Infect nearby human survivor"
      accessibilityRole="button"
      disabled={infecting}
      onPress={handleInfect}
      style={styles.infectButton}
    >
      {infecting ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <Ionicons name="skull-outline" size={18} color="#FFFFFF" />
          <Text variant="label" style={styles.infectText}>
            INFECT SURVIVOR
          </Text>
        </>
      )}
    </Pressable>
  );
});

/**
 * 4. AntidoteNearbyBannerWidget (Overlay Slot)
 * Shows proximity notification when approaching an Antidote station.
 */
export const AntidoteNearbyBannerWidget = memo(function AntidoteNearbyBannerWidget({
  state,
}: HudWidgetProps) {
  const { colors, radii } = useTheme();
  const modeData = (state?.game as any)?.mode_data;
  const nearestAntidoteDistM = modeData?.nearest_antidote_m ?? null;

  if (nearestAntidoteDistM === null || nearestAntidoteDistM > 60) {
    return null;
  }

  return (
    <View
      style={[
        styles.antidoteBanner,
        {
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          borderColor: colors.accent,
          borderRadius: radii.md,
        },
      ]}
    >
      <Ionicons name="medkit-outline" size={16} color={colors.accent} />
      <Text variant="label" style={[styles.antidoteText, { color: colors.accent }]}>
        ANTIDOTE STATION NEARBY • {Math.round(nearestAntidoteDistM)}M
      </Text>
    </View>
  );
});

/**
 * 5. OutbreakZonesMapLayer (MapLayer Slot)
 * Renders procedural Antidote and Drop Pod zones on the MapLibre tactical canvas.
 */
export const OutbreakZonesMapLayer = memo(function OutbreakZonesMapLayer({
  state,
}: HudWidgetProps) {
  const dynamicZones: any[] = (state?.game as any)?.mode_data?.dynamic_zones || [];
  if (dynamicZones.length === 0) return null;

  return (
    <>
      {dynamicZones.map((z, idx) => {
        const ring = circleRing({ longitude: z.longitude, latitude: z.latitude }, z.radius_m || 20);
        const point: PointCollection = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [z.longitude, z.latitude],
              },
              properties: {},
            },
          ],
        };
        const color = z.type === 'antidote' ? '#10B981' : '#00F0FF';
        const keyPrefix = `outbreak-zone-${z.id || idx}`;

        return (
          <React.Fragment key={keyPrefix}>
            <GeoJSONSource id={`${keyPrefix}-ring`} data={ring}>
              <Layer
                id={`${keyPrefix}-fill`}
                type="fill"
                paint={{ 'fill-color': color, 'fill-opacity': 0.15 }}
              />
              <Layer
                id={`${keyPrefix}-line`}
                type="line"
                paint={{ 'line-color': color, 'line-width': 2, 'line-dasharray': [2, 2] }}
              />
            </GeoJSONSource>
            <GeoJSONSource id={`${keyPrefix}-point`} data={point}>
              <Layer
                id={`${keyPrefix}-circle`}
                type="circle"
                paint={{
                  'circle-radius': 7,
                  'circle-color': color,
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#FFFFFF',
                }}
              />
            </GeoJSONSource>
          </React.Fragment>
        );
      })}
    </>
  );
});

export const outbreakHordeWidgets: HudWidget[] = [
  {
    id: 'outbreak_bio_health',
    slot: 'banner',
    roles: ['runner'],
    phases: ['live'],
    priority: 1,
    Component: BioHealthBarWidget,
  },
  {
    id: 'outbreak_ability_drawer',
    slot: 'actions',
    roles: ['runner'],
    phases: ['live'],
    priority: 1,
    Component: AbilityDrawerWidget,
  },
  {
    id: 'outbreak_zombie_infect',
    slot: 'actions',
    roles: ['hunter'],
    phases: ['live'],
    priority: 1,
    Component: ZombieInfectButtonWidget,
  },
  {
    id: 'outbreak_antidote_proximity',
    slot: 'overlay',
    roles: ['runner'],
    phases: ['live'],
    priority: 2,
    Component: AntidoteNearbyBannerWidget,
  },
  {
    id: 'outbreak_zones_map_layer',
    slot: 'mapLayer',
    roles: ['runner', 'hunter'],
    phases: ['head_start', 'live'],
    priority: 1,
    Component: OutbreakZonesMapLayer,
  },
];

const styles = StyleSheet.create({
  healthBanner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    marginHorizontal: 12,
    marginTop: 6,
  },
  healthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  healthLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  healthTitle: {
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  healthValue: {
    fontWeight: '900',
    fontSize: 14,
  },
  gaugeTrack: {
    height: 6,
    width: '100%',
    overflow: 'hidden',
  },
  gaugeFill: {
    height: '100%',
  },
  distressNotice: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: '700',
  },
  abilitiesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  abilityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
  },
  abilityText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  infectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    elevation: 4,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  infectText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 1,
  },
  antidoteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  antidoteText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
