import React, { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { GeoJSONSource, Layer } from '../../lib/map';
import { circleRing } from '../../lib/geo';
import type { HudWidget, HudWidgetProps } from '../types';

export const AssassinSafeZonesLayer = memo(function AssassinSafeZonesLayer({
  state,
}: HudWidgetProps) {
  const safeZones = state.assassin_ring?.safe_zones ?? [];
  if (safeZones.length === 0) return null;

  return (
    <>
      {safeZones.map((zone: any) => {
        const ring = circleRing(
          { longitude: zone.longitude, latitude: zone.latitude },
          zone.radius_m || 20
        );
        return (
          <GeoJSONSource key={zone.id} id={`safe-zone-${zone.id}`} data={ring}>
            <Layer
              id={`safe-zone-fill-${zone.id}`}
              type="fill"
              paint={{ 'fill-color': '#10B981', 'fill-opacity': 0.15 }}
            />
            <Layer
              id={`safe-zone-line-${zone.id}`}
              type="line"
              paint={{ 'line-color': '#10B981', 'line-width': 2, 'line-dasharray': [2, 2] }}
            />
          </GeoJSONSource>
        );
      })}
    </>
  );
});

export const AssassinTargetBanner = memo(function AssassinTargetBanner({
  state,
}: HudWidgetProps) {
  const ring = state.assassin_ring;
  if (!ring?.my_prey) return null;

  const prey = ring.my_prey;
  const prox = ring.hunter_proximity;

  return (
    <View style={styles.bannerContainer}>
      <View style={styles.targetCard}>
        <MaterialCommunityIcons color="#EF4444" name="crosshairs-gps" size={18} />
        <Text variant="mono" style={styles.targetLabel}>
          TARGET:
        </Text>
        <Text variant="title" style={[styles.targetName, { color: prey.color || '#FFFFFF' }]}>
          {prey.display_name}
        </Text>
        {ring.in_safe_zone && (
          <View style={styles.safeBadge}>
            <Text variant="label" style={styles.safeText}>
              SAFE ZONE
            </Text>
          </View>
        )}
      </View>

      {prox !== 'none' && (
        <View style={[styles.proxAlert, prox === 'close' && styles.proxAlertClose]}>
          <Ionicons
            color={prox === 'close' ? '#EF4444' : '#F59E0B'}
            name="warning"
            size={16}
          />
          <Text
            variant="label"
            style={{ color: prox === 'close' ? '#EF4444' : '#F59E0B', fontWeight: '800' }}
          >
            {prox === 'close'
              ? 'WARNING: HUNTER WITHIN 40m!'
              : 'CAUTION: HUNTER NEARBY (<100m)'}
          </Text>
        </View>
      )}
    </View>
  );
});

export const AssassinTagButton = memo(function AssassinTagButton({
  state,
  actions,
}: HudWidgetProps) {
  const [tagging, setTagging] = useState(false);
  const ring = state.assassin_ring;
  if (!ring?.my_prey || ring.in_safe_zone) return null;

  const handleTag = async () => {
    setTagging(true);
    await actions.attemptTag();
    setTagging(false);
  };

  return (
    <Pressable
      accessibilityLabel={`Eliminate prey ${ring.my_prey.display_name}`}
      accessibilityRole="button"
      disabled={tagging}
      onPress={handleTag}
      style={styles.tagButton}
    >
      {tagging ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <MaterialCommunityIcons color="#FFFFFF" name="sword-cross" size={18} />
          <Text variant="label" style={styles.tagText}>
            ELIMINATE PREY
          </Text>
        </>
      )}
    </Pressable>
  );
});

export const assassinRingWidgets: HudWidget[] = [
  {
    id: 'assassin_safe_zones_layer',
    slot: 'mapLayer',
    roles: ['runner', 'hunter', 'solo', 'spectator', 'operator'],
    phases: ['countdown', 'head_start', 'live', 'ended'],
    priority: 10,
    Component: AssassinSafeZonesLayer,
  },
  {
    id: 'assassin_target_banner',
    slot: 'banner',
    roles: ['runner', 'hunter', 'solo'],
    phases: ['live'],
    priority: 5,
    Component: AssassinTargetBanner,
  },
  {
    id: 'assassin_tag_button',
    slot: 'actions',
    roles: ['runner', 'hunter', 'solo'],
    phases: ['live'],
    priority: 1,
    Component: AssassinTagButton,
  },
];

const styles = StyleSheet.create({
  bannerContainer: {
    marginHorizontal: 16,
    gap: 6,
  },
  targetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  targetLabel: {
    fontSize: 11,
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  targetName: {
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  safeBadge: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  safeText: {
    fontSize: 10,
    color: '#10B981',
    fontWeight: '700',
  },
  proxAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  proxAlertClose: {
    borderColor: '#EF4444',
    backgroundColor: '#450A0A',
  },
  tagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  tagText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
