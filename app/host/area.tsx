import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

/**
 * Calculates optimal camera zoom level to fit a zone of radiusM within screen bounds.
 */
export function getZoomForRadius(radiusM: number): number {
  if (radiusM <= 350) return 15.2;
  if (radiusM <= 650) return 14.3;
  if (radiusM <= 1100) return 13.5;
  return 12.8;
}

export default function HostAreaScreen() {
  const { colors, spacing, radii, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);

  const mode = useHostStore((s) => s.mode);
  const center = useHostStore((s) => s.center);
  const radius = useHostStore((s) => s.radius);
  const placements = useHostStore((s) => s.placements);
  const setCenter = useHostStore((s) => s.setCenter);
  const setRadius = useHostStore((s) => s.setRadius);
  const setPlacement = useHostStore((s) => s.setPlacement);

  const [locating, setLocating] = useState(false);
  const [placementError, setPlacementError] = useState('');
  const [placementMode, setPlacementMode] = useState<'zone' | 'target' | 'jail'>('zone');

  // Smooth zoom in/out transition when zone size is changed
  const prevRadiusRef = useRef(radius);
  useEffect(() => {
    if (prevRadiusRef.current !== radius) {
      prevRadiusRef.current = radius;
      const targetZoom = getZoomForRadius(radius);
      cameraRef.current?.easeTo({
        center,
        zoom: targetZoom,
        duration: 500,
      });
    }
  }, [radius, center]);

  // Mode placement requirements
  const needsTarget = mode === 'classic_chase';
  const needsJail = mode === 'jailbreak';

  // Automatically request foreground GPS and center map on mount
  useEffect(() => {
    let active = true;
    async function initLocation() {
      try {
        setLocating(true);
        // 1. Try cached recent location for immediate responsive camera
        const stored = await AsyncStorage.getItem(LAST_LOCATION_KEY);
        if (stored && active) {
          const parsed = JSON.parse(stored) as [number, number];
          setCenter(parsed, 'my_location');
          cameraRef.current?.jumpTo({
            center: parsed,
            zoom: 14,
          });
        }

        // 2. Request live GPS fix
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) {
          perm = await Location.requestForegroundPermissionsAsync();
        }

        if (perm.granted && active) {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (active) {
            const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
            setCenter(coords, 'my_location');
            if (stored) {
              cameraRef.current?.flyTo({
                center: coords,
                zoom: 14,
                duration: 500,
              });
            } else {
              cameraRef.current?.jumpTo({
                center: coords,
                zoom: 14,
              });
            }
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
  }, [setCenter]);

  // Ensure default target or jail exists and stays inside the zone
  useEffect(() => {
    if (needsTarget && !placements.target) {
      const offsetLng = center[0] + 0.0018;
      const offsetLat = center[1] + 0.0018;
      setPlacement('target', [offsetLng, offsetLat]);
    }
    if (needsJail && !placements.jail) {
      const offsetLat = center[1] + 0.0018;
      setPlacement('jail', [center[0], offsetLat]);
    }
  }, [needsTarget, needsJail, center, placements.target, placements.jail, setPlacement]);

  // Handle map tap anywhere
  const handleMapPress = (event: any) => {
    const coords = event.nativeEvent.lngLat;
    if (!coords || !Array.isArray(coords)) return;
    const [tapLng, tapLat] = coords as [number, number];

    // Case 1: Placing the Zone Center (User can tap ANYWHERE on the map!)
    if (placementMode === 'zone' || (!needsTarget && !needsJail)) {
      setCenter([tapLng, tapLat], 'custom');
      cameraRef.current?.easeTo({
        center: [tapLng, tapLat],
        duration: 300,
      });

      // If target or jail exists, check if it falls outside new radius and adjust if needed
      if (needsTarget && placements.target) {
        const d = distanceM(
          { longitude: tapLng, latitude: tapLat },
          { longitude: placements.target[0], latitude: placements.target[1] }
        );
        if (d > radius * 0.85) {
          // Keep target safely inside the new zone
          setPlacement('target', [tapLng + 0.0015, tapLat + 0.0015]);
        }
      }

      if (needsJail && placements.jail) {
        const d = distanceM(
          { longitude: tapLng, latitude: tapLat },
          { longitude: placements.jail[0], latitude: placements.jail[1] }
        );
        if (d > radius * 0.85) {
          setPlacement('jail', [tapLng, tapLat + 0.0015]);
        }
      }

      setPlacementError('');
      triggerHaptic('buttonTap');
      return;
    }

    // Case 2: Placing Target or Jail (must fall within active zone boundary)
    const distFromCenter = distanceM(
      { longitude: center[0], latitude: center[1] },
      { longitude: tapLng, latitude: tapLat }
    );

    if (distFromCenter > radius) {
      setPlacementError(
        placementMode === 'target'
          ? 'Extraction target must be inside the play area boundary.'
          : 'Jail facility must be inside the play area boundary.'
      );
      triggerHaptic('error');
      return;
    }

    setPlacementError('');
    triggerHaptic('tagConfirmed');

    if (placementMode === 'target') {
      setPlacement('target', [tapLng, tapLat]);
    } else if (placementMode === 'jail') {
      setPlacement('jail', [tapLng, tapLat]);
    }
  };

  // Google Maps-style Recenter GPS Action (Instantaneous 0ms snap)
  const handleRecenterGps = async () => {
    triggerHaptic('buttonTap');
    setPlacementError('');

    // Phase 1: Instant 0ms snap from last known / cached location
    try {
      const lastPos = await Location.getLastKnownPositionAsync();
      if (lastPos) {
        const instantCoords: [number, number] = [lastPos.coords.longitude, lastPos.coords.latitude];
        setCenter(instantCoords, 'my_location');
        cameraRef.current?.jumpTo({
          center: instantCoords,
          zoom: 14,
        });
        if (needsTarget) {
          setPlacement('target', [instantCoords[0] + 0.0018, instantCoords[1] + 0.0018]);
        }
        if (needsJail) {
          setPlacement('jail', [instantCoords[0], instantCoords[1] + 0.0018]);
        }
      } else {
        const stored = await AsyncStorage.getItem(LAST_LOCATION_KEY);
        if (stored) {
          const cachedCoords = JSON.parse(stored) as [number, number];
          setCenter(cachedCoords, 'my_location');
          cameraRef.current?.jumpTo({
            center: cachedCoords,
            zoom: 14,
          });
        }
      }
    } catch {
      // Non-fatal, proceed to live GPS
    }

    // Phase 2: Live GPS lock in background
    try {
      setLocating(true);
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (!perm.granted) {
        setPlacementError('Location permission required to recenter on GPS.');
        triggerHaptic('error');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];

      setCenter(coords, 'my_location');
      cameraRef.current?.jumpTo({
        center: coords,
        zoom: 14,
      });

      // Keep target/jail aligned with user location
      if (needsTarget) {
        setPlacement('target', [coords[0] + 0.0018, coords[1] + 0.0018]);
      }
      if (needsJail) {
        setPlacement('jail', [coords[0], coords[1] + 0.0018]);
      }

      void AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(coords));
      triggerHaptic('tagConfirmed');
    } catch (err: unknown) {
      setPlacementError(err instanceof Error ? err.message : 'Could not acquire GPS location.');
      triggerHaptic('error');
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* MapLibre Canvas (no default compass on top right) */}
      <MapLibreMap
        attribution={false}
        compass={false}
        logo={false}
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
            paint={{ 'line-color': colors.accent, 'line-width': 2.5, 'line-dasharray': [2, 2] }}
          />
        </GeoJSONSource>

        {/* Tactical Zone Center Pin */}
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
            id="center-marker-halo"
            type="circle"
            paint={{
              'circle-radius': 16,
              'circle-color': colors.primary,
              'circle-opacity': 0.25,
            }}
          />
          <Layer
            id="center-marker-point"
            type="circle"
            paint={{
              'circle-radius': 8,
              'circle-color': colors.primary,
              'circle-stroke-width': 3,
              'circle-stroke-color': '#FFFFFF',
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
              id="target-marker-halo"
              type="circle"
              paint={{
                'circle-radius': 18,
                'circle-color': colors.radarScan,
                'circle-opacity': 0.3,
              }}
            />
            <Layer
              id="target-marker-point"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': colors.radarScan,
                'circle-stroke-width': 3,
                'circle-stroke-color': '#FFFFFF',
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
              id="jail-marker-halo"
              type="circle"
              paint={{
                'circle-radius': 18,
                'circle-color': colors.warning,
                'circle-opacity': 0.3,
              }}
            />
            <Layer
              id="jail-marker-point"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': colors.warning,
                'circle-stroke-width': 3,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      {/* Top Floating Control Dock */}
      <View style={[styles.topControls, { top: Math.max(insets.top, 16) + 8, left: spacing.md, right: spacing.md }]}>
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

          {/* Mode Selector (When mode has secondary targets like classic chase or jailbreak) */}
          {(needsTarget || needsJail) && (
            <View style={[styles.placementToggleRow, { marginTop: spacing.sm }]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  triggerHaptic('buttonTap');
                  setPlacementMode('zone');
                }}
                style={[
                  styles.placementToggleBtn,
                  placementMode === 'zone' && {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Ionicons
                  name="navigate"
                  size={14}
                  color={placementMode === 'zone' ? colors.primaryText : colors.textMuted}
                />
                <Text
                  variant="caption"
                  style={{
                    fontWeight: '700',
                    marginLeft: 4,
                    color: placementMode === 'zone' ? colors.primaryText : colors.textMuted,
                  }}
                >
                  MOVE ZONE
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  triggerHaptic('buttonTap');
                  setPlacementMode(needsTarget ? 'target' : 'jail');
                }}
                style={[
                  styles.placementToggleBtn,
                  placementMode !== 'zone' && {
                    backgroundColor: needsTarget ? colors.radarScan : colors.warning,
                    borderColor: needsTarget ? colors.radarScan : colors.warning,
                  },
                ]}
              >
                <Ionicons
                  name={needsTarget ? 'flag' : 'shield'}
                  size={14}
                  color={placementMode !== 'zone' ? '#FFFFFF' : colors.textMuted}
                />
                <Text
                  variant="caption"
                  style={{
                    fontWeight: '700',
                    marginLeft: 4,
                    color: placementMode !== 'zone' ? '#FFFFFF' : colors.textMuted,
                  }}
                >
                  {needsTarget ? 'PLACE TARGET' : 'PLACE JAIL'}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Radius Selection Chips (Clean and without MY GPS button) */}
          <View style={[styles.chipsRow, { marginTop: spacing.sm }]}>
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
                    const targetZoom = getZoomForRadius(r);
                    cameraRef.current?.easeTo({
                      center,
                      zoom: targetZoom,
                      duration: 500,
                    });
                  }}
                />
              );
            })}
          </View>

          {/* Placement Guide Message */}
          <View style={[styles.guideRow, { marginTop: spacing.sm }]}>
            <Ionicons
              name={placementMode === 'zone' ? 'location-outline' : 'flag-outline'}
              size={16}
              color={placementMode === 'zone' ? colors.primary : colors.radarScan}
            />
            <Text variant="body" style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
              {placementMode === 'zone'
                ? 'Tap anywhere on the map to place the zone center.'
                : needsTarget
                ? 'Tap inside the boundary ring to place the extraction target.'
                : 'Tap inside the boundary ring to place the jail facility.'}
            </Text>
          </View>

          {placementError !== '' && (
            <Text variant="body" style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>
              {placementError}
            </Text>
          )}
        </Card>
      </View>

      {/* Floating Recenter GPS FAB (Google Maps style right above bottom dock) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Recenter map to my GPS location"
        onPress={() => void handleRecenterGps()}
        style={({ pressed }) => [
          styles.recenterFab,
          {
            bottom: Math.max(insets.bottom, 16) + 116,
            right: spacing.lg,
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.borderDark,
          },
          pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
        ]}
      >
        {locating ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="locate" size={24} color={colors.primary} />
        )}
      </Pressable>

      {/* Bottom Sticky Action Dock */}
      <View
        style={[
          styles.bottomDock,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
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
  placementToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  placementToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#393743',
    backgroundColor: '#1B1A22',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recenterFab: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    zIndex: 20,
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
