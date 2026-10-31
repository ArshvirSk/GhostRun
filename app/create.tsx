import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, type CameraRef } from '../src/lib/map';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { circleRing } from '../src/lib/geo';
import { supabase } from '../src/lib/supabase';

type Mode = 'classic_chase' | 'tag_hunt';
type BoundaryPenalty = 'warn' | 'extra_ping';

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_CENTER: [number, number] = [-97, 38];
const RADII = [300, 600, 1000, 1500];

let createSheetDragStartY = 0;

// Ranges from m1_games_lobby.sql CHECK constraints
const SETTINGS = {
  head_start_s: { min: 0, max: 600, step: 30, default: 180, label: 'Head start', unit: 's' },
  duration_s: {
    min: 300,
    max: 14400,
    step: 300,
    default: 2700,
    label: 'Round length',
    unit: 's',
  },
  ping_interval_s: {
    min: 30,
    max: 900,
    step: 30,
    default: 150,
    label: 'Ping interval',
    unit: 's',
  },
  tag_radius_m: { min: 5, max: 100, step: 5, default: 20, label: 'Tag radius', unit: 'm' },
  boundary_grace_s: {
    min: 10,
    max: 120,
    step: 10,
    default: 30,
    label: 'Boundary grace',
    unit: 's',
  },
} as const;

type SettingKey = keyof typeof SETTINGS;

function formatValue(key: SettingKey, value: number): string {
  if (key === 'duration_s') {
    const mins = Math.floor(value / 60);
    return `${mins} min`;
  }
  return `${value} ${SETTINGS[key].unit}`;
}

export default function CreateGameScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraRef>(null);
  const [mode, setMode] = useState<Mode>('classic_chase');
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [myLocation, setMyLocation] = useState<[number, number] | null>(null);
  const [centerMode, setCenterMode] = useState<'my_location' | 'custom'>('my_location');
  const [locating, setLocating] = useState(true);
  const [radius, setRadius] = useState(600);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const { height: screenHeight } = useWindowDimensions();
  const SHEET_HEIGHT = Math.max(380, Math.round(screenHeight * 0.54));
  const COLLAPSED_HEIGHT = 58;
  const SNAP_BOTTOM = SHEET_HEIGHT - COLLAPSED_HEIGHT;
  const SNAP_TOP = 0;

  const [translateY] = useState(() => new Animated.Value(SNAP_TOP));
  const [sheetExpanded, setSheetExpanded] = useState(true);

  const contentOpacity = translateY.interpolate({
    inputRange: [SNAP_TOP, SNAP_BOTTOM * 0.65, SNAP_BOTTOM],
    outputRange: [1, 0.2, 0],
    extrapolate: 'clamp',
  });

  const dockOpacity = translateY.interpolate({
    inputRange: [SNAP_TOP, SNAP_BOTTOM * 0.4, SNAP_BOTTOM],
    outputRange: [0, 0.4, 1],
    extrapolate: 'clamp',
  });

  const snapSheet = useCallback(
    (toValue: number, velocity = 0) => {
      Animated.spring(translateY, {
        toValue,
        velocity,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start(() => {
        setSheetExpanded(toValue === SNAP_TOP);
      });
    },
    [SNAP_TOP, translateY],
  );

  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 5,
      onPanResponderGrant: () => {
        translateY.stopAnimation((val) => {
          createSheetDragStartY = val;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const newY = Math.max(SNAP_TOP, Math.min(SNAP_BOTTOM, createSheetDragStartY + gesture.dy));
        translateY.setValue(newY);
      },
      onPanResponderRelease: (_, gesture) => {
        let toValue = SNAP_BOTTOM;
        if (gesture.vy < -0.35) {
          toValue = SNAP_TOP;
        } else if (gesture.vy > 0.35) {
          toValue = SNAP_BOTTOM;
        } else {
          const currentY = Math.max(
            SNAP_TOP,
            Math.min(SNAP_BOTTOM, createSheetDragStartY + gesture.dy),
          );
          toValue = currentY < SNAP_BOTTOM * 0.5 ? SNAP_TOP : SNAP_BOTTOM;
        }
        Animated.spring(translateY, {
          toValue,
          velocity: gesture.vy,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }).start(() => {
          setSheetExpanded(toValue === SNAP_TOP);
        });
      },
    }),
  );

  useEffect(() => {
    let active = true;
    async function initLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const last = await Location.getLastKnownPositionAsync();
          if (active && last) {
            const coords: [number, number] = [last.coords.longitude, last.coords.latitude];
            setMyLocation(coords);
            setCenter(coords);
            setLocating(false);
            cameraRef.current?.easeTo({ center: coords, duration: 400 });
          }
          const current = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (active && current) {
            const coords: [number, number] = [current.coords.longitude, current.coords.latitude];
            setMyLocation(coords);
            setCenter(coords);
            setLocating(false);
            cameraRef.current?.easeTo({ center: coords, duration: 400 });
          }
        } else {
          if (active) setLocating(false);
        }
      } catch {
        if (active) setLocating(false);
      }
    }
    void initLocation();
    return () => {
      active = false;
    };
  }, []);

  const [headStartS, setHeadStartS] = useState<number>(SETTINGS.head_start_s.default);
  const [durationS, setDurationS] = useState<number>(SETTINGS.duration_s.default);
  const [pingIntervalS, setPingIntervalS] = useState<number>(SETTINGS.ping_interval_s.default);
  const [tagRadiusM, setTagRadiusM] = useState<number>(SETTINGS.tag_radius_m.default);
  const [boundaryGraceS, setBoundaryGraceS] = useState<number>(SETTINGS.boundary_grace_s.default);
  const [boundaryPenalty, setBoundaryPenalty] = useState<BoundaryPenalty>('warn');

  const settingValues: Record<SettingKey, number> = {
    head_start_s: headStartS,
    duration_s: durationS,
    ping_interval_s: pingIntervalS,
    tag_radius_m: tagRadiusM,
    boundary_grace_s: boundaryGraceS,
  };
  const settingSetters: Record<SettingKey, (v: number) => void> = {
    head_start_s: setHeadStartS,
    duration_s: setDurationS,
    ping_interval_s: setPingIntervalS,
    tag_radius_m: setTagRadiusM,
    boundary_grace_s: setBoundaryGraceS,
  };

  function adjustSetting(key: SettingKey, delta: number) {
    const cfg = SETTINGS[key];
    const current = settingValues[key];
    const next = Math.max(cfg.min, Math.min(cfg.max, current + delta * cfg.step));
    settingSetters[key](next);
  }

  async function createGame() {
    if (!supabase) {
      setErrorMessage('Supabase is not configured yet. Add the project URL and anon key first.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    const { data, error } = await supabase.rpc('create_game', {
      mode,
      lat: center[1],
      lng: center[0],
      radius_m: radius,
      settings: {
        head_start_s: headStartS,
        duration_s: durationS,
        ping_interval_s: pingIntervalS,
        tag_radius_m: tagRadiusM,
        boundary_grace_s: boundaryGraceS,
        boundary_penalty: boundaryPenalty,
      },
    });
    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    const created = Array.isArray(data) ? data[0] : data;
    if (!created?.game_id) {
      setErrorMessage('The server did not return the new game. Please try again.');
      return;
    }
    router.replace({ pathname: '/lobby/[id]', params: { id: created.game_id } });
  }

  return (
    <View style={styles.screen}>
      <MapLibreMap
        attribution
        mapStyle={MAP_STYLE}
        onPress={(event) => {
          const coords = event.nativeEvent.lngLat;
          if (!coords || !Array.isArray(coords)) return;
          setCenterMode('custom');
          setCenter(coords);
          cameraRef.current?.easeTo({ center: coords, duration: 300 });
          if (sheetExpanded) {
            snapSheet(SNAP_BOTTOM);
          }
        }}
        style={StyleSheet.absoluteFill}
      >
        <Camera ref={cameraRef} initialViewState={{ center, zoom: 13 }} />
        <GeoJSONSource
          id="play-area"
          data={circleRing({ longitude: center[0], latitude: center[1] }, radius)}
        >
          <Layer
            id="play-area-fill"
            type="fill"
            paint={{ 'fill-color': '#1D4ED8', 'fill-opacity': 0.08 }}
          />
          <Layer
            id="play-area-outline"
            type="line"
            paint={{ 'line-color': '#1D4ED8', 'line-width': 2, 'line-dasharray': [2, 2] }}
          />
        </GeoJSONSource>
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
              'circle-color': '#1D4ED8',
              'circle-stroke-width': 2.5,
              'circle-stroke-color': '#FFFFFF',
            }}
          />
        </GeoJSONSource>
      </MapLibreMap>

      <View style={styles.topCard}>
        <View style={styles.topCardHeader}>
          <Text style={styles.title}>Create a game</Text>
          {locating && <ActivityIndicator color="#1D4ED8" size="small" />}
        </View>
        <Text style={styles.hint}>
          {centerMode === 'my_location'
            ? 'Using your GPS location as play-area centre.'
            : 'Custom centre selected. Tap anywhere on map to reposition.'}
        </Text>

        <View style={styles.centerToggleRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: centerMode === 'my_location' }}
            onPress={() => {
              setCenterMode('my_location');
              if (myLocation) {
                setCenter(myLocation);
                cameraRef.current?.easeTo({ center: myLocation, duration: 350 });
              } else {
                setLocating(true);
                void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
                  .then((pos) => {
                    const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
                    setMyLocation(coords);
                    setCenter(coords);
                    cameraRef.current?.easeTo({ center: coords, duration: 350 });
                  })
                  .catch(() => {})
                  .finally(() => setLocating(false));
              }
            }}
            style={[
              styles.centerToggleButton,
              centerMode === 'my_location' && styles.centerToggleSelected,
            ]}
          >
            <Text
              style={[
                styles.centerToggleText,
                centerMode === 'my_location' && styles.centerToggleTextSelected,
              ]}
            >
              📍 My location
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: centerMode === 'custom' }}
            onPress={() => setCenterMode('custom')}
            style={[
              styles.centerToggleButton,
              centerMode === 'custom' && styles.centerToggleSelected,
            ]}
          >
            <Text
              style={[
                styles.centerToggleText,
                centerMode === 'custom' && styles.centerToggleTextSelected,
              ]}
            >
              🗺️ Plot on map
            </Text>
          </Pressable>
        </View>
      </View>

      <Animated.View
        style={[
          styles.bottomSheet,
          {
            height: SHEET_HEIGHT,
            transform: [{ translateY }],
          },
        ]}
      >
        <View {...panResponder.panHandlers} style={styles.sheetHandleRow}>
          <View style={styles.sheetHandle} />
          <Animated.View style={[styles.dockBar, { opacity: dockOpacity }]}>
            <Text style={styles.dockTitle}>
              Settings · {radius}m ({mode === 'classic_chase' ? 'Classic' : 'Tag Hunt'})
            </Text>
            <Text style={styles.dockHint}>▲ Slide up to configure</Text>
          </Animated.View>
        </View>

        <Animated.View
          pointerEvents={sheetExpanded ? 'auto' : 'none'}
          style={[styles.bottomSheetInner, { opacity: contentOpacity }]}
        >
          <ScrollView
            contentContainerStyle={styles.bottomSheetContent}
            keyboardShouldPersistTaps="handled"
            style={styles.bottomSheetScroll}
          >
            <Text style={styles.sectionLabel}>MODE</Text>
            <View style={styles.row}>
              <ModeButton
                selected={mode === 'classic_chase'}
                label="Classic Chase"
                onPress={() => setMode('classic_chase')}
              />
              <ModeButton
                selected={mode === 'tag_hunt'}
                label="Tag Hunt"
                onPress={() => setMode('tag_hunt')}
              />
            </View>

            <Text style={styles.sectionLabel}>PLAY AREA RADIUS · {radius} M</Text>
            <View style={styles.row}>
              {RADII.map((value) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: radius === value }}
                  key={value}
                  onPress={() => setRadius(value)}
                  style={[styles.radiusButton, radius === value && styles.selectedButton]}
                >
                  <Text style={[styles.radiusText, radius === value && styles.selectedText]}>
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>GAME SETTINGS</Text>
            {(Object.keys(SETTINGS) as SettingKey[]).map((key) => (
              <View key={key} style={styles.settingRow}>
                <Text style={styles.settingLabel}>{SETTINGS[key].label}</Text>
                <View style={styles.stepper}>
                  <Pressable
                    accessibilityLabel={`Decrease ${SETTINGS[key].label}`}
                    accessibilityRole="button"
                    disabled={settingValues[key] <= SETTINGS[key].min}
                    onPress={() => adjustSetting(key, -1)}
                    style={[
                      styles.stepButton,
                      settingValues[key] <= SETTINGS[key].min && styles.stepButtonDisabled,
                    ]}
                  >
                    <Text style={styles.stepButtonText}>−</Text>
                  </Pressable>
                  <Text style={styles.settingValue}>{formatValue(key, settingValues[key])}</Text>
                  <Pressable
                    accessibilityLabel={`Increase ${SETTINGS[key].label}`}
                    accessibilityRole="button"
                    disabled={settingValues[key] >= SETTINGS[key].max}
                    onPress={() => adjustSetting(key, 1)}
                    style={[
                      styles.stepButton,
                      settingValues[key] >= SETTINGS[key].max && styles.stepButtonDisabled,
                    ]}
                  >
                    <Text style={styles.stepButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Boundary penalty</Text>
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: boundaryPenalty === 'warn' }}
                  onPress={() => setBoundaryPenalty('warn')}
                  style={[
                    styles.penaltyButton,
                    boundaryPenalty === 'warn' && styles.selectedButton,
                  ]}
                >
                  <Text
                    style={[styles.penaltyText, boundaryPenalty === 'warn' && styles.selectedText]}
                  >
                    Warn only
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: boundaryPenalty === 'extra_ping' }}
                  onPress={() => setBoundaryPenalty('extra_ping')}
                  style={[
                    styles.penaltyButton,
                    boundaryPenalty === 'extra_ping' && styles.selectedButton,
                  ]}
                >
                  <Text
                    style={[
                      styles.penaltyText,
                      boundaryPenalty === 'extra_ping' && styles.selectedText,
                    ]}
                  >
                    Extra ping
                  </Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.coordinateText}>
              Centre ({centerMode === 'my_location' ? 'My location' : 'Custom'}):{' '}
              {center[1].toFixed(5)}, {center[0].toFixed(5)}
            </Text>
            {errorMessage !== '' && (
              <Text accessibilityRole="alert" style={styles.error}>
                {errorMessage}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void createGame()}
              style={styles.primaryButton}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>Create lobby</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function ModeButton({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.modeButton, selected && styles.selectedButton]}
    >
      <Text style={[styles.modeText, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#E2E8F0', flex: 1 },
  topCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    elevation: 3,
    left: 14,
    padding: 12,
    position: 'absolute',
    right: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    top: 48,
  },
  title: { color: '#0F172A', fontSize: 18, fontWeight: '800' },
  topCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hint: { color: '#64748B', fontSize: 12, marginTop: 2 },
  centerToggleRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  centerToggleButton: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  centerToggleSelected: {
    backgroundColor: '#DBEAFE',
    borderColor: '#1D4ED8',
  },
  centerToggleText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  centerToggleTextSelected: {
    color: '#1D4ED8',
    fontWeight: '800',
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    bottom: 0,
    elevation: 12,
    left: 0,
    position: 'absolute',
    right: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  bottomSheetInner: {
    flex: 1,
  },
  sheetHandleRow: {
    alignItems: 'center',
    paddingBottom: 4,
    paddingTop: 8,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#CBD5E1',
    borderRadius: 3,
    height: 5,
    marginBottom: 4,
    width: 40,
  },
  dockBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 2,
    width: '100%',
  },
  dockTitle: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
  },
  dockHint: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '700',
  },
  bottomSheetScroll: {
    flex: 1,
  },
  bottomSheetContent: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 24,
  },
  sectionLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
    marginTop: 6,
  },
  row: { flexDirection: 'row', gap: 6 },
  modeButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 8,
  },
  modeText: { color: '#334155', fontSize: 13, fontWeight: '700' },
  selectedButton: { backgroundColor: '#DBEAFE', borderColor: '#1D4ED8' },
  selectedText: { color: '#1D4ED8' },
  radiusButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 32,
  },
  radiusText: { color: '#334155', fontSize: 12, fontWeight: '700' },
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
    minHeight: 34,
  },
  settingLabel: { color: '#334155', flex: 1, fontSize: 13, fontWeight: '600' },
  stepper: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  stepButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  stepButtonDisabled: { opacity: 0.3 },
  stepButtonText: { color: '#1D4ED8', fontSize: 16, fontWeight: '800', lineHeight: 18 },
  settingValue: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    minWidth: 64,
    textAlign: 'center',
  },
  penaltyButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 8,
  },
  penaltyText: { color: '#334155', fontSize: 12, fontWeight: '600' },
  coordinateText: { color: '#64748B', fontSize: 11, marginTop: 6 },
  error: { color: '#B91C1C', fontSize: 12, lineHeight: 16, marginTop: 6 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 44,
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  cancelButton: { alignItems: 'center', justifyContent: 'center', minHeight: 34, marginTop: 2 },
  cancelText: { color: '#64748B', fontSize: 13, fontWeight: '600' },
});
