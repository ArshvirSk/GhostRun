import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';

import { supabase } from '../lib/supabase';
import { GeoJSONSource, Layer } from '../lib/map';
import { playSound } from '../lib/audio';

/**
 * v2 modifier UI: Noise Meter, Dead Drops, Shrinking Zone, and Hot & Cold Hunt.
 *
 * The server owns every rule. This module only polls status RPCs, presents HUD overlays,
 * and handles user actions (Heat press, drop claims, item usage).
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
  effects: { veil: boolean; decoy: boolean; scramble?: boolean; silenced?: boolean };
  noise_enabled: boolean;
  drops_enabled: boolean;
  hot_cold_enabled?: boolean;
  heat_charges?: number | null;
  secret_role?: string | null;
  double_agent_enabled?: boolean;
  agent_powers?: {
    scramble_available: boolean;
    whisper_available: boolean;
  } | null;
  tribunal?: {
    tribunal_id: string;
    accused_id: string;
    started_by: string;
    my_vote: boolean | null;
  } | null;
};

export type NearbyDrop = {
  id: string;
  longitude: number;
  latitude: number;
  distance_m: number;
  claimable: boolean;
};

export type HeatMark = {
  id: number;
  hunter_id: string;
  result: 'hot' | 'cold' | 'no_change';
  longitude: number;
  latitude: number;
  pressed_at: string;
};

export type HeatResult = 'hot' | 'cold' | 'no_change' | null;

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
    (id) => id === 'noise_meter' || id === 'dead_drops' || id === 'hot_cold',
  );

  const refresh = useCallback(async () => {
    if (!supabase || !gameId || !live) return;
    const [statusResult, dropsResult] = await Promise.all([
      supabase.rpc('get_my_status', { game_id: gameId }),
      (game?.modifiers ?? []).includes('dead_drops')
        ? supabase.rpc('nearby_drops', { game_id: gameId })
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (!aliveRef.current) return;
    if (statusResult.data) setStatus(statusResult.data as MyModifierStatus);
    if (dropsResult.data) {
      setDrops(((dropsResult.data as { drops?: NearbyDrop[] }).drops ?? []) as NearbyDrop[]);
    }
  }, [game?.modifiers, gameId, live]);

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
export function ModifierMapLayers({
  drops,
  marks = [],
}: {
  drops: NearbyDrop[];
  marks?: HeatMark[];
}) {
  return (
    <>
      {drops.length > 0 && (
        <GeoJSONSource
          id="drops"
          data={{
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
          }}
        >
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
      )}

      {marks.length > 0 && (
        <GeoJSONSource
          id="heat-marks"
          data={{
            type: 'FeatureCollection' as const,
            features: marks.map((m) => ({
              type: 'Feature' as const,
              id: m.id,
              properties: { result: m.result },
              geometry: {
                type: 'Point' as const,
                coordinates: [m.longitude, m.latitude],
              },
            })),
          }}
        >
          <Layer
            id="heat-mark-halo"
            type="circle"
            paint={{
              'circle-radius': 15,
              'circle-color': [
                'match',
                ['get', 'result'],
                'hot',
                '#EF4444',
                'cold',
                '#3B82F6',
                '#94A3B8',
              ] as any,
              'circle-opacity': 0.28,
            }}
          />
          <Layer
            id="heat-mark-points"
            type="circle"
            paint={{
              'circle-radius': 6,
              'circle-color': [
                'match',
                ['get', 'result'],
                'hot',
                '#DC2626',
                'cold',
                '#2563EB',
                '#64748B',
              ] as any,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#FFFFFF',
            }}
          />
        </GeoJSONSource>
      )}
    </>
  );
}

/** Non-touch-blocking translucent screen tint overlay with haptics for HEAT results. */
export function HeatOverlay({
  result,
  visible,
  onDismiss,
}: {
  result: HeatResult;
  visible: boolean;
  onDismiss?: () => void;
}) {
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible && result) {
      try {
        if (result === 'hot') {
          playSound('heat_hot');
          Vibration.vibrate([0, 100, 100, 100]); // Two short pulses
        } else if (result === 'cold') {
          playSound('heat_cold');
          Vibration.vibrate(120); // One soft pulse
        }
      } catch {
        // ignore
      }

      // Fade in 150 ms, hold 1.5 s, fade out 1.5 s
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.delay(1500),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (onDismiss) onDismiss();
      });
    } else {
      opacity.setValue(0);
    }
  }, [visible, result, onDismiss, opacity]);

  if (!visible || !result) return null;

  const bgStyle =
    result === 'hot'
      ? styles.heatBgHot
      : result === 'cold'
        ? styles.heatBgCold
        : styles.heatBgNoChange;

  const iconName = result === 'hot' ? 'flame' : result === 'cold' ? 'snow' : 'remove-outline';

  const label = result === 'hot' ? 'HOT' : result === 'cold' ? 'COLD' : 'NO CHANGE';

  const subLabel =
    result === 'hot' ? 'Runner nearby' : result === 'cold' ? 'Nobody near' : 'Distance unchanged';

  return (
    <Animated.View pointerEvents="none" style={[styles.heatOverlay, bgStyle, { opacity }]}>
      <View style={styles.heatBadge}>
        <Ionicons color="#FFFFFF" name={iconName} size={44} />
        <Text style={styles.heatBadgeText}>{label}</Text>
        <Text style={styles.heatBadgeSub}>{subLabel}</Text>
      </View>
    </Animated.View>
  );
}

/** Runner sensed pulse ripple around screen edges (heartbeat haptic, faint ripple). */
export function SensedRippleOverlay({ active }: { active: boolean }) {
  const [pulseAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (active) {
      playSound('heat_hot');
      try {
        Vibration.vibrate([0, 80, 100, 80]); // Heartbeat haptic
      } catch {
        // ignore
      }

      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.9,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [active, pulseAnim]);

  if (!active) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.sensedRipple, { opacity: pulseAnim }]} />
  );
}

/** Thumb-reachable HEAT button with charge pips and cooldown indicator for hunters. */
export function HeatButton({
  gameId,
  charges = 6,
  maxCharges = 6,
  cooldownEndsAt,
  onPressResult,
  disabled = false,
}: {
  gameId: string;
  charges?: number;
  maxCharges?: number;
  cooldownEndsAt?: string | null;
  onPressResult: (result: 'hot' | 'cold' | 'no_change') => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(() =>
    cooldownEndsAt ? Math.max(0, Math.ceil((Date.parse(cooldownEndsAt) - Date.now()) / 1000)) : 0,
  );

  useEffect(() => {
    if (!cooldownEndsAt) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(cooldownEndsAt) - Date.now()) / 1000));
      setCooldownRemaining(remaining);
    };
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [cooldownEndsAt]);

  async function handlePress() {
    if (!supabase || busy || disabled || cooldownRemaining > 0 || charges <= 0) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('heat_press', { game_id: gameId });
      if (!error && data) {
        const res = (data as { result?: string }).result;
        if (res === 'hot' || res === 'cold' || res === 'no_change') {
          onPressResult(res);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const pips = Array.from({ length: maxCharges }, (_, i) => i < charges);

  return (
    <View style={styles.heatButtonWrapper}>
      <Pressable
        accessibilityLabel="HEAT button: probe for nearby runners"
        accessibilityRole="button"
        disabled={busy || disabled || cooldownRemaining > 0 || charges <= 0}
        onPress={handlePress}
        style={({ pressed }) => [
          styles.heatButton,
          charges <= 0 && styles.heatButtonEmpty,
          cooldownRemaining > 0 && styles.heatButtonCooldown,
          pressed && styles.heatButtonPressed,
        ]}
      >
        <Ionicons color="#FFFFFF" name="flame" size={18} style={{ marginRight: 6 }} />
        <Text style={styles.heatButtonText}>
          {busy
            ? 'PROBING…'
            : cooldownRemaining > 0
              ? `HEAT (${cooldownRemaining}s)`
              : charges <= 0
                ? 'HEAT (EMPTY)'
                : 'HEAT'}
        </Text>
      </Pressable>

      <View style={styles.pipRow}>
        {pips.map((filled, idx) => (
          <View key={idx} style={[styles.pip, filled ? styles.pipFilled : styles.pipEmpty]} />
        ))}
      </View>
    </View>
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
  const hotColdOn = modifiers.includes('hot_cold');

  if (!noiseOn && !dropsOn && !zoneOn && !hotColdOn) return null;
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

      {hotColdOn && (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.titleRow}>
              <Ionicons color="#DC2626" name="flame" size={16} />
              <Text style={[styles.cardTitle, { marginLeft: 6 }]}>Hot & Cold Hunt</Text>
            </View>
            {status?.team === 'hunter' && (
              <View style={styles.badgeWrap}>
                <Text style={styles.badgeText}>{status?.heat_charges ?? 6} charges</Text>
              </View>
            )}
          </View>
          <Text style={styles.cardHint}>
            {status?.team === 'hunter'
              ? 'Press HEAT to probe for runners. Red = within range, Blue = clear. Marks stay on your map for 5 minutes.'
              : 'Hunters can probe your heat. If a hunter probes while you are within range, you will feel a sensed heartbeat pulse.'}
          </Text>
          <Text style={styles.safetyHint}>
            Safety reminder: Keep your eyes up when crossing roads and moving through traffic.
          </Text>
        </View>
      )}

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
  titleRow: { alignItems: 'center', flexDirection: 'row' },
  cardTitle: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  cardHint: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 4 },
  safetyHint: {
    color: '#D97706',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: 6,
  },
  badgeWrap: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { color: '#DC2626', fontSize: 11, fontWeight: '800' },
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

  // Hot & Cold overlay styles
  heatOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 998,
  },
  heatBgHot: {
    backgroundColor: 'rgba(239, 68, 68, 0.33)',
  },
  heatBgCold: {
    backgroundColor: 'rgba(59, 130, 246, 0.33)',
  },
  heatBgNoChange: {
    backgroundColor: 'rgba(100, 116, 139, 0.18)',
  },
  heatBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  heatBadgeText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginTop: 8,
  },
  heatBadgeSub: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },

  // Sensed pulse ripple styles
  sensedRipple: {
    ...StyleSheet.absoluteFill,
    borderColor: 'rgba(139, 92, 246, 0.6)',
    borderWidth: 10,
    zIndex: 997,
  },

  // Heat button styles
  heatButtonWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heatButton: {
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  heatButtonEmpty: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  heatButtonCooldown: {
    backgroundColor: '#64748B',
  },
  heatButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  heatButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  pipRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  pip: {
    borderRadius: 3,
    height: 6,
    marginHorizontal: 2,
    width: 14,
  },
  pipFilled: {
    backgroundColor: '#EF4444',
  },
  pipEmpty: {
    backgroundColor: '#E2E8F0',
  },
  agentContainer: {
    backgroundColor: '#0F172A',
    borderColor: '#38BDF8',
    borderRadius: 14,
    borderWidth: 1.5,
    marginVertical: 8,
    padding: 12,
  },
  agentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  agentTitle: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  agentActions: {
    flexDirection: 'row',
    gap: 8,
  },
  agentButton: {
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  agentButtonDisabled: {
    borderColor: '#334155',
    opacity: 0.5,
  },
  agentButtonText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  whisperBanner: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    marginTop: 8,
    padding: 8,
  },
  whisperText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  runnerPicker: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    marginTop: 8,
    padding: 8,
  },
  runnerPickerTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  runnerPickItem: {
    backgroundColor: '#334155',
    borderRadius: 6,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  runnerPickText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  tribunalBanner: {
    backgroundColor: '#7F1D1D',
    borderColor: '#EF4444',
    borderRadius: 14,
    borderWidth: 1.5,
    marginVertical: 8,
    padding: 12,
  },
  tribunalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  tribunalTitle: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '800',
  },
  tribunalPrompt: {
    color: '#FFFFFF',
    fontSize: 12,
    marginBottom: 10,
  },
  tribunalButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  ejectButton: {
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 8,
    flex: 1,
    paddingVertical: 8,
  },
  innocentButton: {
    alignItems: 'center',
    backgroundColor: '#475569',
    borderRadius: 8,
    flex: 1,
    paddingVertical: 8,
  },
  tribunalBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  startTribunalButton: {
    alignItems: 'center',
    backgroundColor: '#450A0A',
    borderColor: '#DC2626',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 9,
  },
  startTribunalText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
  },
});

/**
 * AgentControls: secret interface for the Double Agent.
 */
export function AgentControls({
  gameId,
  mode,
  status,
  runners,
  onActionComplete,
}: {
  gameId: string;
  mode: 'classic_chase' | 'tag_hunt';
  status: MyModifierStatus | null;
  runners: { id: string; display_name: string }[];
  onActionComplete?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [whisperResult, setWhisperResult] = useState<string | null>(null);

  if (status?.secret_role !== 'agent') {
    return null;
  }

  const scrambleAvailable = status.agent_powers?.scramble_available ?? true;
  const whisperAvailable = status.agent_powers?.whisper_available ?? true;

  async function handleScramble(runnerId: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setShowPicker(false);
    try {
      await supabase.rpc('agent_scramble', { game_id: gameId, runner_id: runnerId });
      Vibration.vibrate([0, 100, 100, 100]);
      onActionComplete?.();
    } catch {
      // Ignore or let parent reload
    } finally {
      setBusy(false);
    }
  }

  async function handleWhisper() {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.rpc('agent_whisper', { game_id: gameId });
      const res = data as { quadrant?: string } | null;
      if (res?.quadrant) {
        setWhisperResult(`Secret Target is in the ${res.quadrant} quadrant`);
      }
      playSound('whisper');
      Vibration.vibrate(150);
      onActionComplete?.();
    } catch {
      // Ignore or let parent reload
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.agentContainer}>
      <View style={styles.agentHeader}>
        <MaterialCommunityIcons color="#38BDF8" name="incognito" size={18} />
        <Text style={styles.agentTitle}>DOUBLE AGENT CONTROLS</Text>
      </View>

      <View style={styles.agentActions}>
        <Pressable
          disabled={!scrambleAvailable || busy}
          onPress={() => setShowPicker(!showPicker)}
          style={[styles.agentButton, (!scrambleAvailable || busy) && styles.agentButtonDisabled]}
        >
          <MaterialCommunityIcons color="#38BDF8" name="radar" size={16} />
          <Text style={styles.agentButtonText}>
            {scrambleAvailable ? 'Scramble Ping' : 'Scramble Used'}
          </Text>
        </Pressable>

        {mode === 'classic_chase' && (
          <Pressable
            disabled={!whisperAvailable || busy}
            onPress={() => void handleWhisper()}
            style={[styles.agentButton, (!whisperAvailable || busy) && styles.agentButtonDisabled]}
          >
            <MaterialCommunityIcons color="#38BDF8" name="compass-outline" size={16} />
            <Text style={styles.agentButtonText}>
              {whisperAvailable ? 'Whisper Target' : 'Whisper Used'}
            </Text>
          </Pressable>
        )}
      </View>

      {whisperResult && (
        <View style={styles.whisperBanner}>
          <Text style={styles.whisperText}>{whisperResult}</Text>
        </View>
      )}

      {showPicker && (
        <View style={styles.runnerPicker}>
          <Text style={styles.runnerPickerTitle}>SELECT RUNNER TO SCRAMBLE</Text>
          {runners.map((runner) => (
            <Pressable
              key={runner.id}
              onPress={() => void handleScramble(runner.id)}
              style={styles.runnerPickItem}
            >
              <Text style={styles.runnerPickText}>{runner.display_name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * TribunalDock: hunter tribunal voting and inquest initiation.
 */
export function TribunalDock({
  gameId,
  myPlayerId,
  status,
  hunters,
  onActionComplete,
}: {
  gameId: string;
  myPlayerId: string;
  status: MyModifierStatus | null;
  hunters: { id: string; display_name: string }[];
  onActionComplete?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showHunterPicker, setShowHunterPicker] = useState(false);

  if (status?.team !== 'hunter' || !status.double_agent_enabled) {
    return null;
  }

  const activeTribunal = status.tribunal;
  const accusedName =
    hunters.find((h) => h.id === activeTribunal?.accused_id)?.display_name || 'Suspect';
  const otherHunters = hunters.filter((h) => h.id !== myPlayerId);

  async function handleVote(vote: boolean) {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      await supabase.rpc('cast_vote', { game_id: gameId, vote });
      Vibration.vibrate(100);
      onActionComplete?.();
    } catch {
      // Ignore
    } finally {
      setBusy(false);
    }
  }

  async function handleStartTribunal(accusedId: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setShowHunterPicker(false);
    try {
      await supabase.rpc('start_tribunal', { game_id: gameId, accused_hunter_id: accusedId });
      Vibration.vibrate(200);
      onActionComplete?.();
    } catch {
      // Ignore
    } finally {
      setBusy(false);
    }
  }

  if (activeTribunal) {
    const hasVoted = activeTribunal.my_vote !== null && activeTribunal.my_vote !== undefined;
    return (
      <View style={styles.tribunalBanner}>
        <View style={styles.tribunalHeader}>
          <MaterialCommunityIcons color="#FCA5A5" name="gavel" size={18} />
          <Text style={styles.tribunalTitle}>TRIBUNAL IN PROGRESS</Text>
        </View>
        <Text style={styles.tribunalPrompt}>
          Suspect: <Text style={{ fontWeight: 'bold' }}>{accusedName}</Text>. Vote to eject:
        </Text>
        <View style={styles.tribunalButtons}>
          <Pressable
            disabled={busy || hasVoted}
            onPress={() => void handleVote(true)}
            style={[styles.ejectButton, (busy || hasVoted) && { opacity: 0.5 }]}
          >
            <Text style={styles.tribunalBtnText}>
              {hasVoted && activeTribunal.my_vote === true ? 'Voted Eject' : 'Eject'}
            </Text>
          </Pressable>
          <Pressable
            disabled={busy || hasVoted}
            onPress={() => void handleVote(false)}
            style={[styles.innocentButton, (busy || hasVoted) && { opacity: 0.5 }]}
          >
            <Text style={styles.tribunalBtnText}>
              {hasVoted && activeTribunal.my_vote === false ? 'Voted Innocent' : 'Innocent'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View>
      {showHunterPicker ? (
        <View style={styles.runnerPicker}>
          <Text style={styles.runnerPickerTitle}>ACCUSE A HUNTER OF BEING DOUBLE AGENT</Text>
          {otherHunters.map((hunter) => (
            <Pressable
              key={hunter.id}
              onPress={() => void handleStartTribunal(hunter.id)}
              style={styles.runnerPickItem}
            >
              <Text style={styles.runnerPickText}>{hunter.display_name}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setShowHunterPicker(false)} style={{ marginTop: 4 }}>
            <Text style={{ color: '#94A3B8', fontSize: 11, textAlign: 'center' }}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          disabled={busy || otherHunters.length === 0}
          onPress={() => setShowHunterPicker(true)}
          style={[
            styles.startTribunalButton,
            (busy || otherHunters.length === 0) && { opacity: 0.5 },
          ]}
        >
          <MaterialCommunityIcons color="#FCA5A5" name="gavel" size={16} />
          <Text style={styles.startTribunalText}>Convene Hunter Tribunal</Text>
        </Pressable>
      )}
    </View>
  );
}
