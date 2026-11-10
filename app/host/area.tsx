import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, type CameraRef } from '../../src/lib/map';
import { circleRing, distanceM } from '../../src/lib/geo';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { useHostStore } from '../../src/stores/hostStore';
import { triggerHaptic } from '../../src/motion/haptics';

const DAY_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const DARK_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_DARK_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';
const LAST_LOCATION_KEY = '@ghostrun:last_location_coords';

const RADII = [300, 600, 1000, 1500];

export default function HostAreaScreen() {
  const { colors, spacing, radii, isDark } = useTheme();
  const router = useRouter();
  const cameraRef = useRef<CameraRef>(null);

  const mode = useHostStore((s) => s.mode);
  const center = useHostStore((s) => s.center);
  const centerMode = useHostStore((s) => s.centerMode);
  const radius = useHostStore((s) => s.radius);
  const placements = useHostStore((s) => s.placements);
  const setCenter = useHostStore((s) => s.setCenter);
  const setRadius = useHostStore((s) => s.setRadius);
  const setPlacement = useHostStore((s) => s.setPlacement);

  const [locating, setLocating] = useState(false);
  const [placementError, setPlacementError] = useState('');

  // Mode placement requirements
  const needsTarget = mode === 'classic_chase';
  const needsJail = mode === 'jailbreak';

  // Request foreground location on mount if center is default
  useEffect(() => {
    let active = true;
    async function initLocation() {
      if (centerMode === 'custom') return;
      try {
        const stored = await AsyncStorage.getItem(LAST_LOCATION_KEY);
        if (stored && active) {
          const parsed = JSON.parse(stored) as [number, number];
          setCenter(parsed, 'my_location');
        }

        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted && active) {
          setLocating(true);
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (active) {
            const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
            setCenter(coords, 'my_location');
            void AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(coords));
          }
        }
      } catch {
        // Fallback to existing center
      } finally {
        if (active) setLocating(false);
      }
    }
    void initLocation();
    return () => {
      active = false;
    };
  }, [centerMode, setCenter]);

  // Set default target or jail if none exists
  useEffect(() => {
    if (needsTarget && !placements.target) {
      const offsetLng = center[0] + 0.002;
      const offsetLat = center[1] + 0.002;
      setPlacement('target', [offsetLng, offsetLat]);
    }
    if (needsJail && !placements.jail) {
      const offsetLat = center[1] + 0.002;
      setPlacement('jail', [center[0], offsetLat]);
    }
  }, [needsTarget, needsJail, center, placements.target, placements.jail, setPlacement]);

  const handleMapPress = (event: any) => {
    const coords = event.nativeEvent.lngLat;
    if (!coords || !Array.isArray(coords)) return;
    const [tapLng, tapLat] = coords as [number, number];

    const distFromCenter = distanceM(
      { longitude: center[0], latitude: center[1] },
      { longitude: tapLng, latitude: tapLat }
    );

    if (distFromCenter > radius) {
      setPlacementError('Placements must fall within the active play area boundary.');
      triggerHaptic('error');
      return;
    }

    setPlacementError('');
    triggerHaptic('buttonTap');

    if (needsTarget) {
      setPlacement('target', [tapLng, tapLat]);
    } else if (needsJail) {
      setPlacement('jail', [tapLng, tapLat]);
    } else {
      setCenter([tapLng, tapLat], 'custom');
    }
  };

  const handleUseMyLocation = async () => {
    setLocating(true);
    setPlacementError('');
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      setCenter(coords, 'my_location');
      triggerHaptic('buttonTap');
    } catch (err: unknown) {
      setPlacementError(err instanceof Error ? err.message : 'Could not get current location.');
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* MapLibre Canvas */}
      <MapLibreMap
        attribution
        mapStyle={isDark ? DARK_MAP_STYLE : DAY_MAP_STYLE}
        onPress={handleMapPress}
        style={StyleSheet.absoluteFill}
      >
        <Camera ref={cameraRef} initialViewState={{ center, zoom: 14 }} />

        {/* Boundary Area Ring */}
        <GeoJSONSource
          id="play-area"
          data={circleRing({ longitude: center[0], latitude: center[1] }, radius)}
        >
          <Layer
            id="play-area-fill"
            type="fill"
            paint={{ 'fill-color': colors.accent, 'fill-opacity': 0.08 }}
          />
          <Layer
            id="play-area-outline"
            type="line"
            paint={{ 'line-color': colors.accent, 'line-width': 2, 'line-dasharray': [2, 2] }}
          />
        </GeoJSONSource>

        {/* Center Point Marker */}
        <GeoJSONSource
          id="center-marker"
          data={{
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: center },
              },
            ],
          }}
        >
          <Layer
            id="center-marker-point"
            type="circle"
            paint={{
              'circle-radius': 7,
              'circle-color': colors.accent,
              'circle-stroke-width': 2.5,
              'circle-stroke-color': colors.background,
            }}
          />
        </GeoJSONSource>

        {/* Extraction Target Pin (Classic Chase) */}
        {needsTarget && placements.target && (
          <GeoJSONSource
            id="target-marker"
            data={{
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'Point', coordinates: placements.target },
                },
              ],
            }}
          >
            <Layer
              id="target-marker-point"
              type="circle"
              paint={{
                'circle-radius': 10,
                'circle-color': colors.radarScan,
                'circle-stroke-width': 3,
                'circle-stroke-color': colors.background,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Jail Location Pin (Jailbreak) */}
        {needsJail && placements.jail && (
          <GeoJSONSource
            id="jail-marker"
            data={{
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'Point', coordinates: placements.jail },
                },
              ],
            }}
          >
            <Layer
              id="jail-marker-point"
              type="circle"
              paint={{
                'circle-radius': 10,
                'circle-color': colors.warning,
                'circle-stroke-width': 3,
                'circle-stroke-color': colors.background,
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      {/* Top Floating Control Dock */}
      <View style={[styles.topControls, { top: spacing.xl, left: spacing.md, right: spacing.md }]}>
        <Card variant="default" style={{ padding: spacing.md, borderRadius: radii.card, elevation: 8 }}>
          <View style={styles.topBarRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => router.back()}
              style={[styles.iconButton, { backgroundColor: colors.surfaceElevated }]}
            >
              <Ionicons name="arrow-back" size={18} color={colors.textMuted} />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="label" style={{ color: colors.accent }}>
                STEP 4 OF 5: AREA & BOUNDARY
              </Text>
            </View>
            <View style={{ width: 36 }} />
          </View>

          {/* Location Mode & Radius Chips */}
          <View style={[styles.chipsRow, { marginTop: spacing.sm }]}>
            <Chip
              label={locating ? 'LOCATING…' : 'MY GPS'}
              selected={centerMode === 'my_location'}
              variant={centerMode === 'my_location' ? 'accent' : 'default'}
              size="sm"
              onPress={() => void handleUseMyLocation()}
            />
            {RADII.map((r) => {
              const isSelected = radius === r;
              return (
                <Chip
                  key={r}
                  label={`${r}m`}
                  selected={isSelected}
                  variant={isSelected ? 'accent' : 'default'}
                  size="sm"
                  onPress={() => {
                    triggerHaptic('buttonTap');
                    setRadius(r);
                  }}
                />
              );
            })}
          </View>

          {/* Placement Guide Message */}
          <View style={[styles.guideRow, { marginTop: spacing.sm }]}>
            <Ionicons
              name={needsTarget || needsJail ? 'flag-outline' : 'map-outline'}
              size={16}
              color={needsTarget ? colors.radarScan : needsJail ? colors.warning : colors.accent}
            />
            <Text variant="body" style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
              {needsTarget
                ? 'Classic Chase: Tap on the map to place the runner extraction target.'
                : needsJail
                ? 'Jailbreak: Tap on the map to place the detention jail facility.'
                : 'Tap map or use GPS to set the play area center.'}
            </Text>
          </View>

          {placementError !== '' && (
            <Text variant="body" style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>
              {placementError}
            </Text>
          )}
        </Card>
      </View>

      {/* Bottom Sticky Action Dock */}
      <View
        style={[
          styles.bottomDock,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            padding: spacing.lg,
          },
        ]}
      >
        <Button
          title="Continue to Review"
          variant="primary"
          size="lg"
          onPress={() => {
            triggerHaptic('buttonTap');
            router.push('/host/review' as any);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topControls: {
    position: 'absolute',
    zIndex: 10,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    zIndex: 10,
  },
});
