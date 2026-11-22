import React, { memo } from 'react';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { bearingDeg, distanceM, type LngLat } from '../../lib/geo';
import { Text } from '../../ui/Text';
import { triggerHaptic } from '../../motion/haptics';

export interface TacticalObjective {
  id: string;
  title: string;
  type: 'target' | 'extraction' | 'jail' | 'antidote' | 'drop' | 'sector' | 'threat';
  location: LngLat;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  distanceM?: number;
}

export interface OffScreenObjectiveReticlesProps {
  ownFix: LngLat | null;
  userHeading: number | null;
  isMapLocked?: boolean;
  objectives: TacticalObjective[];
  onSelectObjective?: (obj: TacticalObjective) => void;
}

function formatMeters(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

export const OffScreenObjectiveReticles = memo(function OffScreenObjectiveReticles({
  ownFix,
  userHeading = 0,
  isMapLocked = false,
  objectives,
  onSelectObjective,
}: OffScreenObjectiveReticlesProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  if (!ownFix || objectives.length === 0) return null;

  // Screen center
  const cx = width / 2;
  const cy = height / 2;

  // Inset boundary for clamping reticles to screen edges
  const minX = 75;
  const maxX = width - 75;
  const minY = Math.max(insets.top, 16) + 290; // Below expanded top HUD, territory dominance bar, banners & event feeds
  const maxY = height - Math.max(insets.bottom, 16) - 150; // Above bottom action bar & buttons

  const heading = userHeading !== null && userHeading !== undefined ? userHeading : 0;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {objectives.map((obj) => {
        const dist = obj.distanceM ?? Math.round(distanceM(ownFix, obj.location));
        // Don't render reticle if already at the objective
        if (dist < 40) return null;

        const absBearing = bearingDeg(ownFix, obj.location);
        // Map rotates with user heading while player is locked pointing UP (12 o'clock).
        // Relative screen angle is absolute bearing minus operative heading.
        const screenAngleDeg = (absBearing - heading + 360) % 360;

        const rad = (screenAngleDeg * Math.PI) / 180;
        const dx = Math.sin(rad);
        const dy = -Math.cos(rad);

        // Ray-box intersection to clamp to screen perimeter
        let t = Infinity;
        if (dx > 0) t = Math.min(t, (maxX - cx) / dx);
        if (dx < 0) t = Math.min(t, (minX - cx) / dx);
        if (dy > 0) t = Math.min(t, (maxY - cy) / dy);
        if (dy < 0) t = Math.min(t, (minY - cy) / dy);

        // If t is invalid or ray points nowhere, center fallback
        const px = Number.isFinite(t) ? cx + t * dx : cx;
        const py = Number.isFinite(t) ? cy + t * dy : cy;

        return (
          <Pressable
            key={obj.id}
            accessibilityRole="button"
            accessibilityLabel={`${obj.title}, ${formatMeters(dist)} away`}
            onPress={() => {
              triggerHaptic('buttonTap');
              onSelectObjective?.(obj);
            }}
            style={[
              styles.reticleBadge,
              {
                left: px,
                top: py,
                borderColor: `${obj.color}66`,
              },
            ]}
          >
            {/* Directional compass arrow */}
            <View
              style={[
                styles.arrowBox,
                {
                  transform: [{ rotate: `${screenAngleDeg}deg` }],
                  backgroundColor: `${obj.color}22`,
                },
              ]}
            >
              <Ionicons name="arrow-up" size={11} color={obj.color} />
            </View>

            {/* Objective icon & title */}
            <Ionicons name={obj.icon} size={12} color={obj.color} style={{ marginRight: 4 }} />
            <Text style={[styles.reticleTitle, { color: '#F8FAFC' }]} numberOfLines={1}>
              {obj.title}
            </Text>

            {/* Live distance readout */}
            <View style={[styles.distPill, { backgroundColor: `${obj.color}18` }]}>
              <Text style={[styles.distText, { color: obj.color }]}>
                {formatMeters(dist)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  reticleBadge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 15, 23, 0.94)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    transform: [{ translateX: -68 }, { translateY: -14 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 40,
    maxWidth: 200,
  },
  arrowBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  reticleTitle: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    letterSpacing: 0.2,
    flexShrink: 1,
    marginRight: 4,
  },
  distPill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  distText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    letterSpacing: 0.2,
  },
});
