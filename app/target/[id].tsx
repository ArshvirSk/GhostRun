import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { circleRing, distanceM, type LngLat } from '../../src/lib/geo';
import { supabase } from '../../src/lib/supabase';

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

type Team = 'runner' | 'hunter' | 'unassigned';
type LobbyPlayer = {
  id: string;
  user_id: string;
  display_name: string;
  color: string;
  team: Team;
  status: 'active' | 'tagged' | 'left';
  is_ready: boolean;
};
type Area = LngLat & { radius_m: number };
type GameState = {
  server_time: string;
  game: {
    id: string;
    code: string;
    host_id: string;
    mode: 'classic_chase' | 'tag_hunt';
    status: string;
    area: Area;
    target_set: boolean;
  };
  players: LobbyPlayer[];
  my_player_id: string;
  my_team: Team;
  target: LngLat | null;
};

export default function TargetSelectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gameId = Array.isArray(id) ? id[0] : id;

  const [state, setState] = useState<GameState | null>(null);
  const [draft, setDraft] = useState<LngLat | null>(null);
  const [busy, setBusy] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');

  const loadState = useCallback(async () => {
    if (!supabase || !gameId) return;
    const { data, error } = await supabase.rpc('get_game_state', { game_id: gameId });
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setState(data as GameState);
  }, [gameId]);

  useEffect(() => {
    const initialLoad = setTimeout(() => void loadState(), 0);
    if (!supabase || !gameId) return () => clearTimeout(initialLoad);
    const channel = supabase
      .channel(`target-${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => void loadState(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` },
        () => void loadState(),
      )
      .subscribe();
    return () => {
      clearTimeout(initialLoad);
      void supabase?.removeChannel(channel);
    };
  }, [gameId, loadState]);

  const existingTarget = state?.target ?? null;
  const marker = draft ?? existingTarget;
  const self = state?.players.find((player) => player.id === state.my_player_id);
  const isRunner = state?.my_team === 'runner';
  const insideArea =
    state && marker ? distanceM(marker, state.game.area) <= state.game.area.radius_m : false;
  const activePlayers = state?.players.filter((player) => player.status === 'active') ?? [];
  const targetSaved = Boolean(state?.game.target_set || state?.target);
  const teamsAssigned =
    activePlayers.some((player) => player.team === 'runner') &&
    activePlayers.some((player) => player.team === 'hunter') &&
    activePlayers.every((player) => player.team !== 'unassigned');
  const everyoneReady =
    activePlayers.length >= 2 && activePlayers.every((player) => player.is_ready);
  const canStart = targetSaved && teamsAssigned && everyoneReady;
  const isHost = Boolean(state && self && state.game.host_id === self.user_id);

  // Round phases are rendered by the game screen; follow the host there.
  useEffect(() => {
    if (!state || !gameId) return;
    if (state.game.status === 'lobby') {
      router.replace({ pathname: '/lobby/[id]', params: { id: gameId } });
    } else if (
      ['countdown', 'head_start', 'live', 'ended', 'cancelled'].includes(state.game.status)
    ) {
      router.replace({ pathname: '/game/[id]', params: { id: gameId } });
    }
  }, [gameId, router, state]);

  // Keep the secret target visible only while a runner may still change it.
  const markerData = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!marker) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [marker.longitude, marker.latitude] },
        },
      ],
    };
  }, [marker]);

  async function runAction(
    action: string,
    call: () => PromiseLike<{ error: { message: string } | null }>,
  ) {
    setBusy(action);
    setErrorMessage('');
    setNotice('');
    const result = await call();
    setBusy('');
    if (result.error) {
      setErrorMessage(result.error.message);
      return false;
    }
    await loadState();
    return true;
  }

  async function confirmTarget() {
    if (!supabase || !gameId || !draft) return;
    const saved = await runAction('target', () =>
      supabase!.rpc('set_target', { game_id: gameId, lat: draft.latitude, lng: draft.longitude }),
    );
    if (saved) {
      setDraft(null);
      setNotice('Target saved. Hunters cannot see it.');
    }
  }

  async function toggleReady() {
    if (!supabase || !gameId) return;
    await runAction('ready', () =>
      supabase!.rpc('set_ready', { game_id: gameId, ready: !self?.is_ready }),
    );
  }

  async function startRound() {
    if (!supabase || !gameId) return;
    const started = await runAction('start', () =>
      supabase!.rpc('start_game', { game_id: gameId }),
    );
    if (started) router.replace({ pathname: '/game/[id]', params: { id: gameId } });
  }

  async function leaveGame() {
    if (!supabase || !gameId) return;
    setBusy('leave');
    const { error } = await supabase.rpc('leave_game', { game_id: gameId });
    setBusy('');
    if (error) setErrorMessage(error.message);
    else router.replace('/home');
  }

  if (!state) {
    return (
      <View style={styles.centered}>
        {errorMessage ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage}
          </Text>
        ) : (
          <ActivityIndicator color="#1D4ED8" size="large" />
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/home')}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>Back to home</Text>
        </Pressable>
      </View>
    );
  }

  if (['countdown', 'head_start', 'live', 'ended', 'cancelled'].includes(state.game.status)) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1D4ED8" size="large" />
        <Text style={styles.blockedText}>The round is starting…</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace({ pathname: '/game/[id]', params: { id: gameId! } })}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryText}>Enter round</Text>
        </Pressable>
      </View>
    );
  }

  if (state.game.mode !== 'classic_chase' || state.game.status !== 'target_selection') {
    return (
      <View style={styles.centered}>
        <Text style={styles.blockedTitle}>Target selection is not open</Text>
        <Text style={styles.blockedText}>
          {state.game.mode !== 'classic_chase'
            ? 'Tag Hunt has no secret target.'
            : 'The lobby is still open. Target selection opens when the host continues.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace({ pathname: '/lobby/[id]', params: { id: gameId! } })}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryText}>Back to lobby</Text>
        </Pressable>
      </View>
    );
  }

  const zoom = Math.max(11, Math.min(16, 15 - Math.log2(state.game.area.radius_m / 200)));

  return (
    <View style={styles.screen}>
      <MapLibreMap
        attribution
        mapStyle={MAP_STYLE}
        onPress={(event) => {
          if (!isRunner) return;
          const [longitude, latitude] = event.nativeEvent.lngLat;
          setDraft({ longitude, latitude });
          setNotice('');
        }}
        style={StyleSheet.absoluteFill}
      >
        <Camera
          initialViewState={{
            center: [state.game.area.longitude, state.game.area.latitude],
            zoom,
          }}
        />
        <GeoJSONSource id="play-area" data={circleRing(state.game.area, state.game.area.radius_m)}>
          <Layer
            id="play-area-fill"
            type="fill"
            paint={{ 'fill-color': '#1D4ED8', 'fill-opacity': 0.07 }}
          />
          <Layer
            id="play-area-outline"
            type="line"
            paint={{ 'line-color': '#1D4ED8', 'line-width': 2, 'line-dasharray': [2, 2] }}
          />
        </GeoJSONSource>
        {markerData && (
          <GeoJSONSource id="secret-target" data={markerData}>
            <Layer
              id="secret-target-point"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': insideArea || !draft ? '#DB2777' : '#B91C1C',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      <View style={styles.topCard}>
        <Text style={styles.eyebrow}>TARGET SELECTION · {state.game.code}</Text>
        <Text style={styles.title}>
          {isRunner ? 'Pick the secret target' : 'Runners are choosing a target'}
        </Text>
        <Text style={styles.subtitle}>
          {isRunner
            ? 'Tap anywhere inside the dashed play area. Only runners can see this point, and you can move it until the round starts.'
            : 'Hunters never see the target. Ready up and wait for the host to start.'}
        </Text>
      </View>

      <ScrollView style={styles.bottomCard} contentContainerStyle={styles.bottomContent}>
        <Text style={styles.sectionLabel}>READY-UP</Text>
        {state.players.map((player) => (
          <View key={player.id} style={styles.readyRow}>
            <View style={[styles.dot, { backgroundColor: player.color }]} />
            <Text style={styles.readyName}>
              {player.display_name}
              {player.id === state.my_player_id ? ' (you)' : ''}
            </Text>
            <Text style={[styles.readyState, player.is_ready && styles.readyStateOn]}>
              {player.is_ready ? 'Ready' : 'Waiting'}
            </Text>
          </View>
        ))}

        {isRunner && (
          <Text style={styles.status}>
            {marker
              ? insideArea
                ? draft
                  ? 'New target selected. Confirm it to save.'
                  : 'Target saved. Tap the map to move it.'
                : 'That point is outside the play area.'
              : 'No target chosen yet.'}
          </Text>
        )}
        {notice !== '' && <Text style={styles.notice}>{notice}</Text>}
        {errorMessage !== '' && (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage}
          </Text>
        )}

        {isRunner && draft && (
          <Pressable
            accessibilityRole="button"
            disabled={!insideArea || busy !== ''}
            onPress={() => void confirmTarget()}
            style={[styles.primaryButton, (!insideArea || busy !== '') && styles.disabled]}
          >
            {busy === 'target' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryText}>Confirm target</Text>
            )}
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={busy !== ''}
          onPress={() => void toggleReady()}
          style={[styles.readyButton, self?.is_ready && styles.readyButtonOn]}
        >
          {busy === 'ready' ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.readyButtonText}>{self?.is_ready ? 'Ready ✓' : 'Ready up'}</Text>
          )}
        </Pressable>

        {isHost && (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={busy !== '' || !canStart}
              onPress={() => void startRound()}
              style={[styles.startButton, (busy !== '' || !canStart) && styles.disabled]}
            >
              {busy === 'start' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>Start round</Text>
              )}
            </Pressable>
            <Text style={styles.startHint}>
              {!targetSaved
                ? 'A runner must save the secret target first.'
                : !teamsAssigned
                  ? 'Every player needs a team before the round can start.'
                  : !everyoneReady
                    ? 'Every player must be ready before the round can start.'
                    : 'The 10-second countdown starts as soon as you press start.'}
            </Text>
          </>
        )}

        <Text style={styles.footer}>
          The host can start the round once the target is saved and every player is ready. Location
          sharing starts with the 10-second countdown.
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={busy !== ''}
          onPress={() => void leaveGame()}
          style={styles.linkButton}
        >
          {busy === 'leave' ? (
            <ActivityIndicator color="#B91C1C" />
          ) : (
            <Text style={styles.leaveText}>Leave game</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#E2E8F0', flex: 1 },
  centered: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  topCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    left: 16,
    padding: 16,
    position: 'absolute',
    right: 16,
    top: 52,
  },
  eyebrow: { color: '#DB2777', fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#0F172A', fontSize: 21, fontWeight: '900', marginTop: 6 },
  subtitle: { color: '#475569', fontSize: 13, lineHeight: 19, marginTop: 6 },
  bottomCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    bottom: 0,
    left: 0,
    maxHeight: '54%',
    position: 'absolute',
    right: 0,
  },
  bottomContent: { padding: 20, paddingBottom: 32 },
  sectionLabel: { color: '#475569', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  readyRow: { alignItems: 'center', flexDirection: 'row', marginTop: 10 },
  dot: { borderRadius: 5, height: 10, width: 10 },
  readyName: { color: '#0F172A', flex: 1, fontSize: 14, fontWeight: '700', marginLeft: 8 },
  readyState: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  readyStateOn: { color: '#059669' },
  status: { color: '#334155', fontSize: 13, lineHeight: 19, marginTop: 14 },
  notice: { color: '#059669', fontSize: 13, fontWeight: '700', marginTop: 10 },
  error: { color: '#B91C1C', fontSize: 13, lineHeight: 19, marginTop: 10, textAlign: 'left' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#DB2777',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 50,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  readyButton: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 50,
  },
  readyButtonOn: { backgroundColor: '#059669' },
  readyButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  startButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 50,
  },
  startHint: { color: '#64748B', fontSize: 12, lineHeight: 17, marginTop: 8 },
  footer: { color: '#94A3B8', fontSize: 12, lineHeight: 17, marginTop: 14 },
  linkButton: { alignItems: 'center', justifyContent: 'center', marginTop: 10, minHeight: 42 },
  linkText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
  leaveText: { color: '#B91C1C', fontSize: 14, fontWeight: '700' },
  blockedTitle: { color: '#0F172A', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  blockedText: {
    color: '#475569',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
  },
});
