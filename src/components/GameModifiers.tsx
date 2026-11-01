import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '../lib/supabase';
import { GeoJSONSource, Layer } from '../lib/map';

/**
 * v2 modifier UI: Noise Meter, Dead Drops and the Shrinking Zone readout.
 *
 * The server owns every rule. This module only polls the owner-only status RPC
 * (`get_my_status`), the 40 m drop reveal (`nearby_drops`) and sends intents
 * (`start_drop_claim` -> hold -> `claim_drop`, `use_item`). Nothing here decides
 * whether a claim is legal.
 */

export type ItemId = 'veil' | 'decoy' | 'burn' | 'free_ping' | 'jam' | 'sweep';

export type MyModifierStatus = {
  player_id: string;
  team: 'runner' | 'hunter' | 'unassigned';
  status: string;
  noise: number;
  smoothed_speed_mps: number | null;
  charges: Partial<Record<ItemId, number>>;
  cooldowns: Record<string, string>;
  effects: { veil: boolean; decoy: boolean };
  noise_enabled: boolean;
  drops_enabled: boolean;
};

export type NearbyDrop = {
  id: string;
  longitude: number;
  latitude: number;
  distance_m: number;
  claimable: boolean;
};

type GameShape = {
  status: string;
  modifiers?: string[];
  area?: {
    radius_m: number;
    base_radius_m?: number;
    zone_stage?: number;
    zone_stage_count?: number;
    shrinking?: boolean;
  };
};

const ITEM_LABELS: Record<ItemId, string> = {
  veil: 'Veil',
  decoy: 'Decoy',
  burn: 'Burn',
  free_ping: 'Free Ping',
  jam: 'Jam',
  sweep: 'Sweep',
};

const ITEM_HINTS: Record<ItemId, string> = {
  veil: 'Your next ping is skipped.',
  decoy: 'Your next ping lands 150–250 m away.',
  burn: 'See the nearest hunter for 10 s.',
  free_ping: 'Ping a random runner now.',
  jam: 'Cancel a runner’s Veil or Decoy.',
  sweep: 'Vague positions of runners within 150 m.',
};

const ITEM_ICONS: Record<ItemId, ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  veil: 'weather-night',
  decoy: 'ghost-outline',
  burn: 'fire',
  free_ping: 'radar',
  jam: 'access-point-off',
  sweep: 'magnify-scan',
};

/** Polls the modifier RPCs while the round is live. */
export function useModifierState(gameId: string | undefined, game: GameShape | null) {
  const [status, setStatus] = useState<MyModifierStatus | null>(null);
  const [drops, setDrops] = useState<NearbyDrop[]>([]);
  const aliveRef = useRef(true);
  const live = game?.status === 'live';
  const hasModifiers = (game?.modifiers ?? []).some(
    (id) => id === 'noise_meter' || id === 'dead_drops',
  );

  const refresh = useCallback(async () => {
    if (!supabase || !gameId || !live) return;
    const [statusResult, dropsResult] = await Promise.all([
      supabase.rpc('get_my_status', { game_id: gameId }),
      supabase.rpc('nearby_drops', { game_id: gameId }),
    ]);
    if (!aliveRef.current) return;
    if (statusResult.data) setStatus(statusResult.data as MyModifierStatus);
    if (dropsResult.data) {
      setDrops(((dropsResult.data as { drops?: NearbyDrop[] }).drops ?? []) as NearbyDrop[]);
    }
  }, [gameId, live]);

  useEffect(() => {
    aliveRef.current = true;
    if (!live || !hasModifiers) {
      return () => {
        aliveRef.current = false;
      };
    }
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      aliveRef.current = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [hasModifiers, live, refresh]);

  return {
    status: live && hasModifiers ? status : null,
    drops: live && hasModifiers ? drops : [],
    refresh,
  };
}

/** Amber drop markers. Only rendered for drops the server already revealed. */
export function ModifierMapLayers({ drops }: { drops: NearbyDrop[] }) {
  if (drops.length === 0) return null;
  const data = {
    type: 'FeatureCollection' as const,
    features: drops.map((drop) => ({
      type: 'Feature' as const,
      id: drop.id,
      properties: { claimable: drop.claimable },
      geometry: {
        type: 'Point' as const,
        coordinates: [drop.longitude, drop.latitude],
      },
    })),
  };
  return (
    <GeoJSONSource id="drops" data={data}>
      <Layer
        id="drop-halo"
        type="circle"
        paint={{
          'circle-radius': 16,
          'circle-color': '#F59E0B',
          'circle-opacity': 0.22,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#F59E0B',
        }}
      />
      <Layer
        id="drop-points"
        type="circle"
        paint={{
          'circle-radius': ['case', ['get', 'claimable'], 9, 7] as any,
          'circle-color': '#D97706',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        }}
      />
    </GeoJSONSource>
  );
}

function noiseColor(noise: number) {
  if (noise >= 85) return '#DC2626';
  if (noise >= 60) return '#EA580C';
  if (noise >= 30) return '#EAB308';
  return '#059669';
}

export function ModifierPanel({
  gameId,
  game,
  status,
  drops,
  refresh,
  serverNow,
}: {
  gameId: string;
  game: GameShape;
  status: MyModifierStatus | null;
  drops: NearbyDrop[];
  refresh: () => Promise<void>;
  serverNow: number;
}) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [holdingDrop, setHoldingDrop] = useState<string | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [burnMark, setBurnMark] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  const modifiers = game.modifiers ?? [];
  const noiseOn = modifiers.includes('noise_meter');
  const dropsOn = modifiers.includes('dead_drops');
  const zoneOn = modifiers.includes('shrinking_zone');
  if (!noiseOn && !dropsOn && !zoneOn) return null;
  if (game.status !== 'live' && game.status !== 'head_start') return null;

  async function activateItem(item: ItemId) {
    if (!supabase || busy !== '') return;
    setBusy(item);
    setMessage('');
    const { data, error } = await supabase.rpc('use_item', { game_id: gameId, item });
    setBusy('');
    if (error) {
      setMessage(error.message);
      return;
    }
    const effect = data as { display_name?: string } | null;
    if (item === 'burn' && effect?.display_name) {
      setMessage(`Burn: ${effect.display_name} was the nearest hunter.`);
    } else {
      setMessage(`${ITEM_LABELS[item]} used. ${ITEM_HINTS[item]}`);
    }
    if (item === 'burn' && effect && 'latitude' in effect) {
      const revealed = effect as unknown as { latitude: number; longitude: number };
      setBurnMark({ latitude: revealed.latitude, longitude: revealed.longitude });
    }
    await refresh();
  }

  function beginHold(drop: NearbyDrop) {
    if (!supabase || holdingDrop !== null || busy !== '') return;
    setHoldingDrop(drop.id);
    setMessage('Hold on…');
    void supabase
      .rpc('start_drop_claim', { game_id: gameId, drop_id: drop.id })
      .then(({ error }) => {
        if (error) {
          setHoldingDrop(null);
          setMessage(error.message);
          return;
        }
        holdTimerRef.current = setTimeout(() => {
          void supabase!
            .rpc('claim_drop', { game_id: gameId, drop_id: drop.id })
            .then(async ({ data, error: claimError }) => {
              setHoldingDrop(null);
              if (claimError) {
                setMessage(claimError.message);
                return;
              }
              const claimed = data as { item?: ItemId } | null;
              setMessage(
                claimed?.item
                  ? `You found a ${ITEM_LABELS[claimed.item]}. ${ITEM_HINTS[claimed.item]}`
                  : 'Drop claimed.',
              );
              await refresh();
            });
        }, 4600);
      });
  }

  function cancelHold() {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    setHoldingDrop(null);
  }

  const charges = (Object.keys(ITEM_LABELS) as ItemId[])
    .map((item) => ({ item, count: status?.charges?.[item] ?? 0 }))
    .filter((entry) => entry.count > 0);

  const zone = game.area;

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>MODIFIERS</Text>

      {noiseOn && status?.team === 'runner' && (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Noise</Text>
            <Text style={[styles.noiseValue, { color: noiseColor(status.noise) }]}>
              {status.noise}/100
            </Text>
          </View>
          <View style={styles.noiseTrack}>
            <View
              style={[
                styles.noiseFill,
                { backgroundColor: noiseColor(status.noise), width: `${status.noise}%` },
              ]}
            />
          </View>
          <Text style={styles.cardHint}>
            {status.noise >= 100
              ? 'You just pinged yourself. Slow down.'
              : status.noise >= 60
                ? 'Hunters were told a runner is loud. Walk to quiet down.'
                : 'Sprint raises noise fast; walking or standing still quiets it.'}
          </Text>
          {(status.effects.veil || status.effects.decoy) && (
            <Text style={styles.effectText}>
              {status.effects.veil ? 'Veil ready · next ping skipped. ' : ''}
              {status.effects.decoy ? 'Decoy ready · next ping shifted.' : ''}
            </Text>
          )}
        </View>
      )}

      {dropsOn && (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Dead drops</Text>
            <Text style={styles.cardHint}>{drops.length} nearby</Text>
          </View>
          {drops.length === 0 && (
            <Text style={styles.cardHint}>Move around the area. Drops appear within 40 m.</Text>
          )}
          {drops.map((drop) => (
            <View key={drop.id} style={styles.dropRow}>
              <MaterialCommunityIcons color="#D97706" name="package-variant" size={18} />
              <View style={styles.dropDetails}>
                <Text style={styles.dropTitle}>
                  {drop.claimable ? 'Drop in reach' : 'Drop nearby'}
                </Text>
                <Text style={styles.cardHint}>{Math.round(drop.distance_m)} m away</Text>
              </View>
              {drop.claimable ? (
                <Pressable
                  accessibilityLabel="Hold to claim the dead drop"
                  accessibilityRole="button"
                  onPressIn={() => beginHold(drop)}
                  onPressOut={cancelHold}
                  style={[styles.claimButton, holdingDrop === drop.id && styles.claimButtonHolding]}
                >
                  {holdingDrop === drop.id ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.claimText}>HOLD 5 s</Text>
                  )}
                </Pressable>
              ) : (
                <Text style={styles.cardHint}>Too far</Text>
              )}
            </View>
          ))}
          <Text style={styles.cardHint}>Keep holding the button for five seconds to claim.</Text>
        </View>
      )}

      {dropsOn && charges.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your items</Text>
          {charges.map(({ item, count }) => (
            <View key={item} style={styles.itemRow}>
              <MaterialCommunityIcons color="#1D4ED8" name={ITEM_ICONS[item]} size={18} />
              <View style={styles.dropDetails}>
                <Text style={styles.itemTitle}>
                  {ITEM_LABELS[item]} ×{count}
                </Text>
                <Text style={styles.cardHint}>{ITEM_HINTS[item]}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={busy !== ''}
                onPress={() => void activateItem(item)}
                style={[styles.useButton, busy !== '' && styles.disabled]}
              >
                {busy === item ? (
                  <ActivityIndicator color="#1D4ED8" size="small" />
                ) : (
                  <Text style={styles.useText}>USE</Text>
                )}
              </Pressable>
            </View>
          ))}
          {status?.cooldowns?.drop_claim && (
            <Text style={styles.cardHint}>
              Next claim window:{' '}
              {Math.max(
                0,
                Math.ceil((Date.parse(status.cooldowns.drop_claim) + 180_000 - serverNow) / 1000),
              )}
              s
            </Text>
          )}
        </View>
      )}

      {zoneOn && zone?.shrinking && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Shrinking zone</Text>
          <Text style={styles.cardHint}>
            Stage {zone.zone_stage ?? 1} of {zone.zone_stage_count ?? 3} ·{' '}
            {Math.round(zone.radius_m)} m radius
            {zone.base_radius_m ? ` (from ${zone.base_radius_m} m)` : ''}.
          </Text>
        </View>
      )}

      {burnMark && (
        <Text style={styles.effectText}>
          Burn mark: {burnMark.latitude.toFixed(4)}, {burnMark.longitude.toFixed(4)} · 10 s window
        </Text>
      )}

      {message !== '' && (
        <Text
          accessibilityRole="alert"
          style={[styles.cardHint, message.includes('Hold on') && styles.pendingText]}
        >
          {message}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => void refresh()}
        style={styles.refreshButton}
      >
        <Ionicons color="#1D4ED8" name="refresh" size={14} />
        <Text style={styles.refreshText}>Refresh modifiers</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  sectionLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
    marginTop: 14,
  },
  card: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
  },
  rowBetween: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  cardHint: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 4 },
  noiseValue: { fontSize: 14, fontWeight: '900' },
  noiseTrack: {
    backgroundColor: '#E2E8F0',
    borderRadius: 6,
    height: 10,
    marginTop: 8,
    overflow: 'hidden',
  },
  noiseFill: { borderRadius: 6, height: 10 },
  effectText: { color: '#4338CA', fontSize: 12, fontWeight: '700', marginTop: 8 },
  pendingText: { color: '#B45309', fontWeight: '700' },
  dropRow: { alignItems: 'center', flexDirection: 'row', marginTop: 10 },
  dropDetails: { flex: 1, marginLeft: 10 },
  dropTitle: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  claimButton: {
    alignItems: 'center',
    backgroundColor: '#D97706',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 92,
    paddingHorizontal: 10,
  },
  claimButtonHolding: { backgroundColor: '#B45309' },
  claimText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  itemRow: { alignItems: 'center', flexDirection: 'row', marginTop: 10 },
  itemTitle: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  useButton: {
    alignItems: 'center',
    backgroundColor: '#DBEAFE',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 58,
    paddingHorizontal: 10,
  },
  useText: { color: '#1D4ED8', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  disabled: { opacity: 0.5 },
  refreshButton: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  refreshText: { color: '#1D4ED8', fontSize: 12, fontWeight: '700', marginLeft: 6 },
});
