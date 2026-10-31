import { Camera, Map as MapLibreMap } from '../src/lib/map';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '../src/lib/supabase';

type Mode = 'classic_chase' | 'tag_hunt';

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_CENTER: [number, number] = [-97, 38];
const RADII = [300, 600, 1000, 1500];

export default function CreateGameScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('classic_chase');
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [radius, setRadius] = useState(600);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

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
      settings: {},
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
        onPress={(event) => setCenter(event.nativeEvent.lngLat)}
        style={StyleSheet.absoluteFill}
      >
        <Camera initialViewState={{ center, zoom: 13 }} />
      </MapLibreMap>

      <View style={styles.topCard}>
        <Text style={styles.title}>Create a game</Text>
        <Text style={styles.hint}>Tap the map to choose the play-area centre.</Text>
      </View>

      <View style={styles.bottomCard}>
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
        <Text style={styles.coordinateText}>
          Centre: {center[1].toFixed(5)}, {center[0].toFixed(5)}
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
      </View>
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
    borderRadius: 16,
    left: 16,
    padding: 16,
    position: 'absolute',
    right: 16,
    top: 52,
  },
  title: { color: '#0F172A', fontSize: 22, fontWeight: '800' },
  hint: { color: '#475569', fontSize: 14, marginTop: 4 },
  bottomCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    bottom: 0,
    left: 0,
    padding: 20,
    position: 'absolute',
    right: 0,
  },
  sectionLabel: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: 8,
    marginTop: 8,
  },
  row: { flexDirection: 'row', gap: 8 },
  modeButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
  },
  modeText: { color: '#334155', fontSize: 14, fontWeight: '700' },
  selectedButton: { backgroundColor: '#DBEAFE', borderColor: '#1D4ED8' },
  selectedText: { color: '#1D4ED8' },
  radiusButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  radiusText: { color: '#334155', fontSize: 13, fontWeight: '700' },
  coordinateText: { color: '#64748B', fontSize: 12, marginTop: 12 },
  error: { color: '#B91C1C', fontSize: 13, lineHeight: 18, marginTop: 8 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 52,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  cancelButton: { alignItems: 'center', justifyContent: 'center', minHeight: 42 },
  cancelText: { color: '#475569', fontSize: 15, fontWeight: '700' },
});
