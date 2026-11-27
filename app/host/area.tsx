import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { TacticalRangeSelector } from '../../src/ui/TacticalRangeSelector';
import { useHostStore, LAST_LOCATION_KEY } from '../../src/stores/hostStore';
import { triggerHaptic } from '../../src/motion/haptics';
import {
  getInstantLocation,
  getFastestGpsCoords,
  updateCachedLocation,
  startLocationPrewarm,
} from '../../src/lib/locationCache';

const DAY_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const DARK_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_DARK_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';


const AREA_MAP_PADDING = { top: 275, bottom: 120, left: 24, right: 24 };

/**
 * Calculates optimal camera zoom level to fit a zone of radiusM within screen bounds.
 * Continuous logarithmic scaling ensures smooth, non-glitching transitions across 200m - 2000m.
 */
export function getZoomForRadius(radiusM: number): number {
  const safeR = Math.max(100, Math.min(2000, radiusM));
  const zoom = 14.6 - Math.log2(safeR / 300);
  return Math.round(zoom * 10) / 10;
}

export default function HostAreaScreen() {
  const { colors, spacing, radii, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const mapLoadedRef = useRef(false);
  const pendingCameraTargetRef = useRef<[number, number] | null>(null);

  const mode = useHostStore((s) => s.mode);
  const center = useHostStore((s) => s.center);
  const radius = useHostStore((s) => s.radius);
  const rules = useHostStore((s) => s.rules);
  const placements = useHostStore((s) => s.placements);
  const setCenter = useHostStore((s) => s.setCenter);
  const setRadius = useHostStore((s) => s.setRadius);
  const setModeParam = useHostStore((s) => s.setModeParam);
  const setPlacement = useHostStore((s) => s.setPlacement);
  const isPinpoint = mode === 'pinpoint';

  useEffect(() => {
    if (!isPinpoint) return;
    const clamped = Math.min(750, Math.max(150, radius));
    if (clamped !== radius) {
      setRadius(clamped);
    }
    setModeParam('pinpoint', 'radius_meters', clamped);
  }, [isPinpoint, radius, setRadius, setModeParam]);

  const [locating, setLocating] = useState(false);
  const [placementError, setPlacementError] = useState('');
  const [placementMode, setPlacementMode] = useState<'zone' | 'target' | 'jail'>('zone');

  const applyCameraCenter = useCallback((coords: [number, number], animate = false) => {
    pendingCameraTargetRef.current = coords;
    const currentRadius = useHostStore.getState().radius;
    const targetZoom = getZoomForRadius(currentRadius);
    if (mapLoadedRef.current && cameraRef.current) {
      if (animate) {
        cameraRef.current.easeTo({ center: coords, zoom: targetZoom, duration: 400, padding: AREA_MAP_PADDING });
      } else {
        cameraRef.current.jumpTo({ center: coords, zoom: targetZoom, padding: AREA_MAP_PADDING });
      }
    }
  }, []);

  // Smooth, glitch-free camera zoom adjustment when radius changes
  const lastAnimatedRadiusRef = useRef(radius);
  const zoomDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (lastAnimatedRadiusRef.current === radius) return;
    lastAnimatedRadiusRef.current = radius;

    if (zoomDebounceRef.current) {
      clearTimeout(zoomDebounceRef.current);
    }

    zoomDebounceRef.current = setTimeout(() => {
      if (!mapLoadedRef.current || !cameraRef.current) return;
      const targetZoom = getZoomForRadius(radius);
      const currentCenter = useHostStore.getState().center;
      cameraRef.current.easeTo({
        center: currentCenter,
        zoom: targetZoom,
        duration: 320,
        padding: AREA_MAP_PADDING,
        easing: 'ease',
      });
    }, 250);

    return () => {
      if (zoomDebounceRef.current) {
        clearTimeout(zoomDebounceRef.current);
      }
    };
  }, [radius]);

  // Mode placement requirements
  const needsTarget = mode === 'classic_chase';
  const needsJail = mode === 'jailbreak';

  // Automatically request foreground GPS and center map on mount
  useEffect(() => {
    let active = true;
    async function initLocation() {
      // Phase 1: 0ms instant placement from memory cache
      const instant = getInstantLocation();
      if (instant && active) {
        setCenter(instant, 'my_location');
        applyCameraCenter(instant, false);
      }

      try {
        const fastCoords = await getFastestGpsCoords();
        if (fastCoords && active && (!instant || instant[0] !== fastCoords[0] || instant[1] !== fastCoords[1])) {
          setCenter(fastCoords, 'my_location');
          applyCameraCenter(fastCoords, false);
        }

        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) {
          perm = await Location.requestForegroundPermissionsAsync();
        }

        if (perm.granted && active) {
          void startLocationPrewarm();

          // Background live GPS refinement
          const livePos = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);

          if (livePos?.coords && active) {
            const coords: [number, number] = [livePos.coords.longitude, livePos.coords.latitude];
            updateCachedLocation(coords);
            const currentCenter = useHostStore.getState().center;
            const dist = distanceM(
              { longitude: currentCenter[0], latitude: currentCenter[1] },
              { longitude: coords[0], latitude: coords[1] }
            );
            if (dist > 15) {
              setCenter(coords, 'my_location');
              applyCameraCenter(coords, true);
            }
          }
        }
      } catch {
        // Fallback to existing center
      }
    }
    void initLocation();
    return () => {
      active = false;
    };
  }, [setCenter, applyCameraCenter]);

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
        padding: AREA_MAP_PADDING,
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

    // Phase 1: 0ms INSTANT snap from memory or fastest cache
    const instant = getInstantLocation();
    let snapped = false;

    if (instant) {
      snapped = true;
      setCenter(instant, 'my_location');
      cameraRef.current?.easeTo({
        center: instant,
        zoom: getZoomForRadius(radius),
        duration: 250,
        padding: AREA_MAP_PADDING,
      });
      if (needsTarget) {
        setPlacement('target', [instant[0] + 0.0018, instant[1] + 0.0018]);
      }
      if (needsJail) {
        setPlacement('jail', [instant[0], instant[1] + 0.0018]);
      }
      triggerHaptic('tagConfirmed');
    }

    if (!snapped) {
      setLocating(true);
      const fastCoords = await getFastestGpsCoords();
      if (fastCoords) {
        snapped = true;
        setCenter(fastCoords, 'my_location');
        cameraRef.current?.easeTo({
          center: fastCoords,
          zoom: getZoomForRadius(radius),
          duration: 250,
          padding: AREA_MAP_PADDING,
        });
        if (needsTarget) {
          setPlacement('target', [fastCoords[0] + 0.0018, fastCoords[1] + 0.0018]);
        }
        if (needsJail) {
          setPlacement('jail', [fastCoords[0], fastCoords[1] + 0.0018]);
        }
        triggerHaptic('tagConfirmed');
      }
      setLocating(false);
    }

    // Phase 2: Silent background live GPS refinement (non-blocking, never locks UI)
    Location.getForegroundPermissionsAsync().then(async (perm) => {
      if (!perm.granted && perm.canAskAgain) {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (!perm.granted) {
        if (!snapped) {
          setPlacementError('Location permission required to recenter on GPS.');
          triggerHaptic('error');
        }
        return;
      }

      try {
        const livePos = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
        ]);

        if (livePos?.coords?.longitude && livePos?.coords?.latitude) {
          const coords: [number, number] = [livePos.coords.longitude, livePos.coords.latitude];
          updateCachedLocation(coords);

          // If no coordinate was known or distance drifted > 15m, smoothly ease camera
          const currentCenter = useHostStore.getState().center;
          const distDrift = distanceM(
            { longitude: currentCenter[0], latitude: currentCenter[1] },
            { longitude: coords[0], latitude: coords[1] }
          );

          if (!snapped || distDrift > 15) {
            setCenter(coords, 'my_location');
            const currentR = useHostStore.getState().radius;
            cameraRef.current?.easeTo({
              center: coords,
              zoom: getZoomForRadius(currentR),
              duration: 300,
              padding: AREA_MAP_PADDING,
            });
            if (needsTarget) {
              setPlacement('target', [coords[0] + 0.0018, coords[1] + 0.0018]);
            }
            if (needsJail) {
              setPlacement('jail', [coords[0], coords[1] + 0.0018]);
            }
          }
        }
      } catch (err: unknown) {
        if (!snapped) {
          setPlacementError(err instanceof Error ? err.message : 'Could not acquire GPS location.');
          triggerHaptic('error');
        }
      }
    }).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* MapLibre Canvas (no default compass on top right) */}
      <MapLibreMap
        attribution={false}
        compass={false}
        logo={false}
        mapStyle={isDark ? DARK_MAP_STYLE : DAY_MAP_STYLE}
        onDidFinishLoadingStyle={() => {
          mapLoadedRef.current = true;
          if (pendingCameraTargetRef.current && cameraRef.current) {
            cameraRef.current.jumpTo({
              center: pendingCameraTargetRef.current,
              zoom: getZoomForRadius(radius),
              padding: AREA_MAP_PADDING,
            });
            pendingCameraTargetRef.current = null;
          }
        }}
        onPress={handleMapPress}
        style={StyleSheet.absoluteFill}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center,
            zoom: getZoomForRadius(radius),
            padding: AREA_MAP_PADDING,
          }}
        />

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

          {/* Tactical Rangefinder Zone Selector (150-750m for Pinpoint, up to 2.0km otherwise) */}
          <TacticalRangeSelector
            radiusM={isPinpoint ? Math.min(750, Math.max(150, radius)) : radius}
            minRadiusM={isPinpoint ? 150 : 200}
            maxRadiusM={isPinpoint ? 750 : 2000}
            stepM={isPinpoint ? 50 : 100}
            onChange={(newRadius) => {
              setRadius(newRadius);
              if (isPinpoint) {
                setModeParam('pinpoint', 'radius_meters', newRadius);
              }
            }}
            style={{ marginTop: spacing.xs }}
          />

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
        {(() => {
          const isPinpointHostDrop =
            mode === 'pinpoint' &&
            useHostStore.getState().modeParams.pinpoint?.photo_source === 'host_drop';

          return (
            <Button
              title={isPinpointHostDrop ? 'Continue to Target Drops' : 'Continue to Review'}
              variant="primary"
              size="lg"
              onPress={() => {
                triggerHaptic('buttonTap');
                if (isPinpointHostDrop) {
                  router.push('/host/pinpoint-drops' as any);
                } else {
                  router.push('/host/review' as any);
                }
              }}
            />
          );
        })()}
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
