import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type CameraRef,
} from '../../src/lib/map';
import { circleRing, distanceM } from '../../src/lib/geo';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { useHostStore } from '../../src/stores/hostStore';
import { PinpointHostDrop } from '../../src/modes/pinpoint/types';
import { getHeadingCompassLabel } from '../../src/modes/pinpoint/engine';
import { triggerHaptic } from '../../src/motion/haptics';

const DAY_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const DARK_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_DARK_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';

const DROP_MAP_PADDING = { top: 120, bottom: 320, left: 24, right: 24 };

const SAMPLE_PHOTO_PRESETS = [
  {
    title: 'Memorial Fountain',
    url: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=600&q=80',
    heading: 0,
  },
  {
    title: 'Park Pavilion',
    url: 'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=600&q=80',
    heading: 90,
  },
  {
    title: 'Stone Arch Bridge',
    url: 'https://images.unsplash.com/photo-1508873696983-2df5703bc20d?auto=format&fit=crop&w=600&q=80',
    heading: 180,
  },
  {
    title: 'Historic Clock Tower',
    url: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=600&q=80',
    heading: 270,
  },
];

export default function PinpointDropsScreen() {
  const { colors, spacing, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);

  const center = useHostStore((s) => s.center);
  const radius = useHostStore((s) => s.radius);
  const modeParams = useHostStore((s) => s.modeParams);
  const setModeParam = useHostStore((s) => s.setModeParam);

  const totalRounds = modeParams.pinpoint?.total_rounds ?? 3;
  const initialDrops: PinpointHostDrop[] = modeParams.pinpoint?.drops ?? [];

  // Generate initial default drops inside the arena if none exist
  const [drops, setDrops] = useState<PinpointHostDrop[]>(() => {
    if (initialDrops.length > 0) return initialDrops;

    // Distribute 3 sample drops radially inside the geofence
    const sampleOffsets = [
      { dLng: 0.0015, dLat: 0.0015, title: 'Main Plaza Fountain', heading: 45 },
      { dLng: -0.0018, dLat: 0.0012, title: 'North Trail Pavilion', heading: 180 },
      { dLng: 0.0010, dLat: -0.0020, title: 'Stone Arch Bridge', heading: 270 },
    ];

    return sampleOffsets.slice(0, Math.min(3, totalRounds)).map((offset, idx) => ({
      id: `drop-${idx + 1}`,
      roundNumber: idx + 1,
      title: offset.title,
      latitude: center[1] + offset.dLat,
      longitude: center[0] + offset.dLng,
      heading: offset.heading,
      photoUrl: SAMPLE_PHOTO_PRESETS[idx % SAMPLE_PHOTO_PRESETS.length].url,
    }));
  });

  const [activeDropIndex, setActiveDropIndex] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const activeDrop = drops[activeDropIndex] || drops[0];

  // Sync drops to host store
  const persistDrops = useCallback(
    (newDrops: PinpointHostDrop[]) => {
      setDrops(newDrops);
      setModeParam('pinpoint', 'drops', newDrops);
    },
    [setModeParam]
  );

  // Handle map tap to place or reposition current drop
  const handleMapPress = (event: any) => {
    const coords = event.nativeEvent.lngLat;
    if (!coords || !Array.isArray(coords)) return;
    const [tapLng, tapLat] = coords as [number, number];

    const distFromCenter = distanceM(
      { longitude: center[0], latitude: center[1] },
      { longitude: tapLng, latitude: tapLat }
    );

    if (distFromCenter > radius) {
      setErrorMessage('Target drop must be inside the arena geofence.');
      triggerHaptic('error');
      return;
    }

    setErrorMessage('');
    triggerHaptic('buttonTap');

    if (!activeDrop) {
      // Create first drop
      const newDrop: PinpointHostDrop = {
        id: `drop-1`,
        roundNumber: 1,
        title: 'Landmark Objective 1',
        latitude: tapLat,
        longitude: tapLng,
        heading: 0,
        photoUrl: SAMPLE_PHOTO_PRESETS[0].url,
      };
      persistDrops([newDrop]);
      setActiveDropIndex(0);
      return;
    }

    // Reposition active drop
    const updated = drops.map((d, idx) => {
      if (idx !== activeDropIndex) return d;
      return {
        ...d,
        latitude: tapLat,
        longitude: tapLng,
      };
    });

    persistDrops(updated);
  };

  const handleAddDrop = () => {
    if (drops.length >= 5) {
      setErrorMessage('Maximum of 5 landmark drops supported per match.');
      triggerHaptic('error');
      return;
    }

    const nextRound = drops.length + 1;
    // Slight angular offset from center
    const angleRad = ((nextRound - 1) * 72 * Math.PI) / 180;
    const offsetM = Math.min(radius * 0.5, 150);
    const dLat = (offsetM * Math.cos(angleRad)) / 111111;
    const dLng = (offsetM * Math.sin(angleRad)) / (111111 * Math.cos((center[1] * Math.PI) / 180));

    const newDrop: PinpointHostDrop = {
      id: `drop-${Date.now()}`,
      roundNumber: nextRound,
      title: `Landmark Objective ${nextRound}`,
      latitude: center[1] + dLat,
      longitude: center[0] + dLng,
      heading: (nextRound * 45) % 360,
      photoUrl: SAMPLE_PHOTO_PRESETS[(nextRound - 1) % SAMPLE_PHOTO_PRESETS.length].url,
    };

    triggerHaptic('tagConfirmed');
    const updated = [...drops, newDrop];
    persistDrops(updated);
    setActiveDropIndex(updated.length - 1);
  };

  const handleDeleteActiveDrop = () => {
    if (drops.length <= 1) {
      setErrorMessage('At least one landmark target drop is required.');
      triggerHaptic('error');
      return;
    }

    triggerHaptic('buttonTap');
    const updated = drops
      .filter((_, idx) => idx !== activeDropIndex)
      .map((d, idx) => ({ ...d, roundNumber: idx + 1 }));

    persistDrops(updated);
    setActiveDropIndex(Math.max(0, activeDropIndex - 1));
  };

  const handleUpdateHeading = (deltaDeg: number) => {
    if (!activeDrop) return;
    triggerHaptic('buttonTap');
    const newHeading = ((activeDrop.heading + deltaDeg) % 360 + 360) % 360;
    const updated = drops.map((d, idx) => (idx === activeDropIndex ? { ...d, heading: newHeading } : d));
    persistDrops(updated);
  };

  const handleSetCardinalHeading = (heading: number) => {
    if (!activeDrop) return;
    triggerHaptic('buttonTap');
    const updated = drops.map((d, idx) => (idx === activeDropIndex ? { ...d, heading } : d));
    persistDrops(updated);
  };

  const handleUpdateTitle = (title: string) => {
    if (!activeDrop) return;
    const updated = drops.map((d, idx) => (idx === activeDropIndex ? { ...d, title } : d));
    persistDrops(updated);
  };

  const handleSelectSamplePhoto = (sampleUrl: string) => {
    if (!activeDrop) return;
    triggerHaptic('buttonTap');
    const updated = drops.map((d, idx) => (idx === activeDropIndex ? { ...d, photoUrl: sampleUrl } : d));
    persistDrops(updated);
  };

  const handleConfirmAndContinue = () => {
    triggerHaptic('buttonTap');
    persistDrops(drops);
    router.push('/host/review' as any);
  };

  // Center camera on active drop when selected
  useEffect(() => {
    if (activeDrop && cameraRef.current) {
      cameraRef.current.easeTo({
        center: [activeDrop.longitude, activeDrop.latitude],
        duration: 300,
        padding: DROP_MAP_PADDING,
      });
    }
  }, [activeDropIndex]);

  const activeDistance = activeDrop
    ? Math.round(
        distanceM(
          { longitude: center[0], latitude: center[1] },
          { longitude: activeDrop.longitude, latitude: activeDrop.latitude }
        )
      )
    : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View
        style={[
          styles.topBar,
          {
            paddingHorizontal: spacing.lg,
            paddingTop: Math.max(insets.top, 16) + 8,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Area"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textMuted} />
        </Pressable>
        <View style={styles.stepIndicator}>
          <Text variant="label" style={{ color: colors.accent }}>
            STEP 4B OF 5
          </Text>
          <Text variant="label" style={{ color: colors.textMuted }}>
            HOST TARGET DROPS
          </Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* MapLibre Canvas */}
      <MapLibreMap
        attribution={false}
        compass={false}
        logo={false}
        mapStyle={isDark ? DARK_MAP_STYLE : DAY_MAP_STYLE}
        onPress={handleMapPress}
        style={StyleSheet.absoluteFill}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center,
            zoom: 14.5,
            padding: DROP_MAP_PADDING,
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

        {/* Tactical Arena Center Pin */}
        <GeoJSONSource
          id="center-pin"
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
            id="center-pin-core"
            type="circle"
            paint={{
              'circle-radius': 6,
              'circle-color': '#FFFFFF',
              'circle-opacity': 0.8,
            }}
          />
        </GeoJSONSource>

        {/* All Target Drop Markers */}
        {drops.map((drop, idx) => {
          const isActive = idx === activeDropIndex;
          return (
            <GeoJSONSource
              key={drop.id}
              id={`drop-source-${drop.id}`}
              data={{
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    properties: { round: drop.roundNumber, active: isActive },
                    geometry: { type: 'Point', coordinates: [drop.longitude, drop.latitude] },
                  },
                ],
              }}
            >
              {/* Outer Pulse Halo */}
              <Layer
                id={`drop-halo-${drop.id}`}
                type="circle"
                paint={{
                  'circle-radius': isActive ? 22 : 14,
                  'circle-color': isActive ? '#C8FF00' : '#00F0FF',
                  'circle-opacity': isActive ? 0.35 : 0.15,
                }}
              />
              {/* Core Marker */}
              <Layer
                id={`drop-core-${drop.id}`}
                type="circle"
                paint={{
                  'circle-radius': isActive ? 10 : 7,
                  'circle-color': isActive ? '#C8FF00' : '#00F0FF',
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#0F0E13',
                }}
              />
            </GeoJSONSource>
          );
        })}
      </MapLibreMap>

      {/* Floating Instruction Guide Banner */}
      <View
        style={[
          styles.guideBanner,
          {
            top: Math.max(insets.top, 16) + 60,
            backgroundColor: 'rgba(22, 21, 29, 0.94)',
            borderColor: colors.border,
          },
        ]}
      >
        <Ionicons name="navigate-circle-outline" size={16} color={colors.accent} />
        <Text style={styles.guideBannerText}>
          Tap anywhere inside the dashed zone to reposition selected drop.
        </Text>
      </View>

      {/* Error Pill */}
      {errorMessage !== '' && (
        <View style={styles.errorPill}>
          <Ionicons name="alert-circle" size={14} color="#FF5A5F" />
          <Text style={styles.errorPillText}>{errorMessage}</Text>
        </View>
      )}

      {/* Bottom Configuration Panel */}
      <View
        style={[
          styles.bottomSheet,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 16) + 80,
          },
        ]}
      >
        {/* Drop Selector Tabs Row */}
        <View style={styles.dropSelectorRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dropTabsScroll}>
            {drops.map((drop, idx) => {
              const isActive = idx === activeDropIndex;
              return (
                <Pressable
                  key={drop.id}
                  style={[
                    styles.dropTab,
                    isActive && styles.dropTabActive,
                    { borderColor: isActive ? colors.accent : colors.border },
                  ]}
                  onPress={() => {
                    triggerHaptic('buttonTap');
                    setActiveDropIndex(idx);
                    setErrorMessage('');
                  }}
                >
                  <Text style={[styles.dropTabText, isActive && styles.dropTabTextActive]}>
                    DROP {drop.roundNumber}
                  </Text>
                </Pressable>
              );
            })}

            {drops.length < 5 && (
              <Pressable style={styles.addDropBtn} onPress={handleAddDrop}>
                <Ionicons name="add" size={16} color={colors.accent} />
                <Text style={styles.addDropText}>ADD DROP</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>

        {activeDrop && (
          <ScrollView style={styles.dropEditorScroll} showsVerticalScrollIndicator={false}>
            {/* Title & Telemetry Header */}
            <View style={styles.activeHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>LANDMARK TITLE</Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.border, color: colors.text }]}
                  value={activeDrop.title}
                  onChangeText={handleUpdateTitle}
                  placeholder="e.g. Memorial Fountain"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <Pressable
                style={styles.deleteDropBtn}
                onPress={handleDeleteActiveDrop}
                accessibilityRole="button"
                accessibilityLabel="Delete active target drop"
              >
                <Ionicons name="trash-outline" size={18} color="#FF5A5F" />
              </Pressable>
            </View>

            {/* Coordinates & Center Distance */}
            <View style={styles.coordsRow}>
              <View style={styles.coordCell}>
                <Text style={styles.coordLabel}>DISTANCE TO CENTER</Text>
                <Text style={styles.coordValue}>{activeDistance}m</Text>
              </View>
              <View style={styles.coordCell}>
                <Text style={styles.coordLabel}>COORDINATES</Text>
                <Text style={styles.coordValue}>
                  {activeDrop.latitude.toFixed(4)}°, {activeDrop.longitude.toFixed(4)}°
                </Text>
              </View>
            </View>

            {/* Compass Azimuth Orientation Controls */}
            <View style={styles.azimuthSection}>
              <View style={styles.azimuthHeaderRow}>
                <Text style={styles.fieldLabel}>VIEWFINDER HEADING (AZIMUTH)</Text>
                <Text style={styles.azimuthValue}>
                  {getHeadingCompassLabel(activeDrop.heading)}
                </Text>
              </View>

              {/* Cardinal Presets */}
              <View style={styles.cardinalRow}>
                {[
                  { label: 'N', deg: 0 },
                  { label: 'NE', deg: 45 },
                  { label: 'E', deg: 90 },
                  { label: 'SE', deg: 135 },
                  { label: 'S', deg: 180 },
                  { label: 'SW', deg: 225 },
                  { label: 'W', deg: 270 },
                  { label: 'NW', deg: 315 },
                ].map((card) => {
                  const isSelected = Math.abs(activeDrop.heading - card.deg) < 15;
                  return (
                    <Pressable
                      key={card.label}
                      style={[
                        styles.cardinalBtn,
                        isSelected && styles.cardinalBtnActive,
                        { borderColor: isSelected ? colors.accent : colors.border },
                      ]}
                      onPress={() => handleSetCardinalHeading(card.deg)}
                    >
                      <Text style={[styles.cardinalText, isSelected && styles.cardinalTextActive]}>
                        {card.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Fine Heading Adjustment (+/- 15 deg) */}
              <View style={styles.stepperRow}>
                <Pressable style={styles.stepBtn} onPress={() => handleUpdateHeading(-15)}>
                  <Ionicons name="remove" size={16} color="#FFFFFF" />
                  <Text style={styles.stepBtnText}>-15°</Text>
                </Pressable>
                <Pressable style={styles.stepBtn} onPress={() => handleUpdateHeading(15)}>
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                  <Text style={styles.stepBtnText}>+15°</Text>
                </Pressable>
              </View>
            </View>

            {/* Photo Reference Selection */}
            <View style={styles.photoPresetSection}>
              <Text style={styles.fieldLabel}>REFERENCE PHOTO CLUE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoPresetsRow}>
                {SAMPLE_PHOTO_PRESETS.map((preset, idx) => {
                  const isSelected = activeDrop.photoUrl === preset.url;
                  return (
                    <Pressable
                      key={preset.title}
                      style={[
                        styles.photoPresetCard,
                        isSelected && styles.photoPresetCardActive,
                      ]}
                      onPress={() => handleSelectSamplePhoto(preset.url)}
                    >
                      <Image source={{ uri: preset.url }} style={styles.photoPresetThumb} />
                      <Text style={styles.photoPresetTitle} numberOfLines={1}>
                        {preset.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </ScrollView>
        )}
      </View>

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
          title="Confirm Drops & Review"
          variant="primary"
          size="lg"
          onPress={handleConfirmAndContinue}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
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
  stepIndicator: {
    alignItems: 'center',
  },
  guideBanner: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 15,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  guideBannerText: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    color: '#94A3B8',
    flex: 1,
  },
  errorPill: {
    position: 'absolute',
    top: 130,
    alignSelf: 'center',
    zIndex: 25,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 90, 95, 0.95)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    gap: 6,
  },
  errorPillText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#FFFFFF',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 340,
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  dropSelectorRow: {
    marginBottom: 10,
  },
  dropTabsScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  dropTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1E1D29',
    borderWidth: 1,
  },
  dropTabActive: {
    backgroundColor: '#C8FF00',
  },
  dropTabText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  dropTabTextActive: {
    color: '#000000',
  },
  addDropBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1E1D29',
    borderWidth: 1,
    borderColor: '#39374B',
    gap: 4,
  },
  addDropText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#C8FF00',
    letterSpacing: 0.8,
  },
  dropEditorScroll: {
    flex: 1,
  },
  activeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginBottom: 10,
  },
  fieldLabel: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  textInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 0,
    backgroundColor: '#16151E',
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
  },
  deleteDropBtn: {
    width: 38,
    height: 38,
    borderRadius: 6,
    backgroundColor: '#261F25',
    borderWidth: 1,
    borderColor: '#4A2A33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coordsRow: {
    flexDirection: 'row',
    backgroundColor: '#181722',
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
    gap: 12,
  },
  coordCell: {
    flex: 1,
  },
  coordLabel: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    color: '#64748B',
    letterSpacing: 0.6,
  },
  coordValue: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#00F0FF',
    marginTop: 2,
  },
  azimuthSection: {
    backgroundColor: '#181722',
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
  },
  azimuthHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  azimuthValue: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#C8FF00',
  },
  cardinalRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
  },
  cardinalBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: '#201F2C',
    borderWidth: 1,
  },
  cardinalBtnActive: {
    backgroundColor: '#C8FF00',
  },
  cardinalText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    color: '#94A3B8',
  },
  cardinalTextActive: {
    color: '#000000',
  },
  stepperRow: {
    flexDirection: 'row',
    gap: 8,
  },
  stepBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#262535',
    paddingVertical: 6,
    borderRadius: 4,
    gap: 4,
  },
  stepBtnText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#FFFFFF',
  },
  photoPresetSection: {
    marginBottom: 16,
  },
  photoPresetsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 4,
  },
  photoPresetCard: {
    width: 90,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#1A1924',
    borderWidth: 1,
    borderColor: '#2F2E3E',
  },
  photoPresetCardActive: {
    borderColor: '#C8FF00',
  },
  photoPresetThumb: {
    width: '100%',
    height: 55,
  },
  photoPresetTitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 9,
    color: '#94A3B8',
    padding: 4,
    textAlign: 'center',
  },
  bottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    zIndex: 20,
  },
});
