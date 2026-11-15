import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import {
  MovableCornerMiniMap,
  STORAGE_KEY_MINIMAP_CORNER,
  STORAGE_KEY_MINIMAP_ENABLED,
  type MiniMapCorner,
} from '../components/MovableCornerMiniMap';
import type { LngLat } from '../lib/geo';
import {
  openLocationSettings,
  startLocationSharing,
  stopLocationSharing,
  uploadLocation,
  watchLocation,
  type GeoFix,
  type StartLocationResult,
} from '../lib/location';
import { initAudio, toggleAudioMuted } from '../lib/audio';
import { initTacticalNotificationChannels } from '../lib/notifications';

import type { RoundState, ShellActions } from './types';
import { createShellActions } from './actions';
import {
  selectActiveModifiers,
  selectActiveRoles,
  selectIsOutOfBounds,
  selectModeId,
  selectMyPlayer,
  selectMyRole,
  selectPings,
  selectTarget,
  selectTeammates,
} from './selectors';
import { MapView } from './MapView';
import { TacticalRadarCanvas } from './TacticalRadarCanvas';
import { HudFrame } from './HudFrame';
import { PhaseBanner } from './PhaseBanner';
import { SosSheet } from './SosSheet';
import { SafetyCheckinModal } from '../components/SafetyCheckinModal';
import { TeamRadioSheet } from '../components/TeamRadioSheet';
import { useSafetyCheckin } from './useSafetyCheckin';
import { EventFeed } from './EventFeed';
import { TrackingStatus, type SharingState } from './TrackingStatus';
import { RunnerLayout } from './layouts/RunnerLayout';
import { HunterLayout } from './layouts/HunterLayout';
import { OperatorLayout } from './layouts/OperatorLayout';
import { SpectatorLayout } from './layouts/SpectatorLayout';
import { SprintLayout } from './layouts/SprintLayout';
import { getActiveHudWidgets } from '../modes/hud-registry';

interface GameShellProps {
  gameId: string;
}

export function GameShell({ gameId }: GameShellProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens, colors } = useTheme();

  const [state, setState] = useState<RoundState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);

  // Tactical Compass & Heading Tracking
  const [userHeading, setUserHeading] = useState<number | null>(null);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let mounted = true;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        sub = await Location.watchHeadingAsync((headingData) => {
          if (!mounted) return;
          const heading = headingData.trueHeading >= 0 ? headingData.trueHeading : headingData.magHeading;
          setUserHeading(heading);
        });
      } catch {
        // Heading may not be supported on emulators without compass
      }
    })();
    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);

  // Shell controls
  const [isCompact, setIsCompact] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(false);
  const [sosVisible, setSosVisible] = useState(false);
  const [radioVisible, setRadioVisible] = useState(false);
  const [unreadRadioCount, setUnreadRadioCount] = useState(0);
  const [sprintMode, setSprintMode] = useState(false);

  // Location state
  const [sharing, setSharing] = useState<SharingState>('idle');
  const [backgroundSharing, setBackgroundSharing] = useState(true);
  const [fix, setFix] = useState<GeoFix | null>(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);

  // Out of bounds grace tracking
  const [outOfBoundsSince, setOutOfBoundsSince] = useState<number | null>(null);
  const serverNow = now + serverOffset;

  // Periodic Safety Check-in (NF-06)
  const checkinInterval =
    Number((state?.game?.mode_params?.safety as any)?.checkin_interval_m) ||
    ((state as any)?.safety?.is_night ? 10 : 15);

  const {
    modalVisible: checkinVisible,
    countdown: checkinCountdown,
    handleConfirmOk: handleCheckinOk,
    handleTriggerSos: handleCheckinSos,
  } = useSafetyCheckin({
    gameId,
    isLive: state?.game?.status === 'live',
    intervalMinutes: checkinInterval,
    onSos: () => setSosVisible(true),
  });

  const loadState = useCallback(async () => {
    if (!supabase || !gameId) return;
    try {
      const { data, error } = await supabase.rpc('get_game_state', { game_id: gameId });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const rawState = data as RoundState;
      if (rawState?.server_time) {
        setServerOffset(Date.parse(rawState.server_time) - Date.now());
      }
      setState(rawState);
      setError(null);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to sync game state');
      setLoading(false);
    }
  }, [gameId]);

  const actions: ShellActions = useMemo(() => {
    return createShellActions(gameId, loadState);
  }, [gameId, loadState]);

  // Audio initialization
  useEffect(() => {
    void initAudio();
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!supabase || !gameId) return;
    const initialLoad = setTimeout(() => void loadState(), 0);

    const channel = supabase
      .channel(`game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => void loadState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, () => void loadState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_positions', filter: `game_id=eq.${gameId}` }, () => void loadState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pings', filter: `game_id=eq.${gameId}` }, () => void loadState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` }, () => void loadState())
      .subscribe();

    return () => {
      clearTimeout(initialLoad);
      void supabase?.removeChannel(channel);
    };
  }, [gameId, loadState]);

  // Visual clock tick (pauses when screen is off / app is in background to conserve CPU & battery)
  useEffect(() => {
    let tick: ReturnType<typeof setInterval> | null = null;
    const startTick = () => {
      if (!tick) tick = setInterval(() => setNow(Date.now()), 500);
    };
    const stopTick = () => {
      if (tick) {
        clearInterval(tick);
        tick = null;
      }
    };

    if (AppState.currentState === 'active') {
      startTick();
    }

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setNow(Date.now());
        startTick();
      } else {
        stopTick();
      }
    });

    return () => {
      stopTick();
      sub.remove();
    };
  }, []);

  // AppState resync
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void loadState();
    });
    return () => sub.remove();
  }, [loadState]);

  // Phase transition routing
  useEffect(() => {
    if (!state) return;
    if (state.game.status === 'lobby') {
      router.replace({ pathname: '/lobby/[id]', params: { id: gameId } });
    } else if (state.game.status === 'ended') {
      router.replace({ pathname: '/result/[id]', params: { id: gameId } });
    }
  }, [gameId, router, state, state?.game?.status]);

  // Location sharing lifecycle
  const startSharing = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setSharing('starting');

    let res: StartLocationResult;
    try {
      // Ensure match notifications are permitted for radar alerts and phase shifts
      const notifPerm = await Notifications.getPermissionsAsync();
      if (!notifPerm.granted && notifPerm.canAskAgain) {
        await Notifications.requestPermissionsAsync();
      }
      void initTacticalNotificationChannels();
      res = await startLocationSharing(gameId);
    } catch {
      res = { ok: false, reason: 'error', message: 'Location sharing error' };
    }

    startingRef.current = false;
    if (!mountedRef.current) return;

    if (!res.ok) {
      setSharing(res.reason === 'denied' ? 'denied' : 'error');
      setBackgroundSharing(false);
      return;
    }

    setSharing('on');
    setBackgroundSharing(res.background);
  }, [gameId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!state) return;
    const isLiveOrHeadStart = ['head_start', 'live'].includes(state.game.status);
    const isRemote = state.players.find((p) => p.id === state.my_player_id)?.is_remote;

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isLiveOrHeadStart && !isRemote && sharing === 'idle') {
      timer = setTimeout(() => void startSharing(), 0);
    }

    return () => {
      if (timer) clearTimeout(timer);
      mountedRef.current = false;
      void stopLocationSharing();
    };
  }, [sharing, startSharing, state, state?.game?.status, state?.my_player_id, state?.players]);

  // Local location watcher: when phone is locked/backgrounded with background sharing enabled,
  // skip local React state marker updates to conserve CPU & battery.
  useEffect(() => {
    if (sharing !== 'on') return;
    return watchLocation((nextFix) => {
      if (AppState.currentState !== 'active' && backgroundSharing) return;
      setFix(nextFix);
      if (!backgroundSharing) void uploadLocation(nextFix);
    });
  }, [backgroundSharing, sharing]);

  // Derived state & selectors
  const myRole = selectMyRole(state);
  const modeId = selectModeId(state);
  const modifiers = selectActiveModifiers(state);
  const roles = selectActiveRoles(state);
  const teammates = selectTeammates(state);
  const pings = selectPings(state);
  const target = selectTarget(state);

  const posLng = state?.my_position?.longitude;
  const posLat = state?.my_position?.latitude;
  const fixLng = fix?.longitude;
  const fixLat = fix?.latitude;

  const ownFix: LngLat | null = useMemo(() => {
    if (fixLng != null && fixLat != null) return { longitude: fixLng, latitude: fixLat };
    if (posLng != null && posLat != null) return { longitude: posLng, latitude: posLat };
    return null;
  }, [fixLat, fixLng, posLat, posLng]);

  const isOutOfBounds = selectIsOutOfBounds(state, ownFix);

  // Out of bounds grace period calculation
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isOutOfBounds) {
      if (outOfBoundsSince === null) {
        timer = setTimeout(() => setOutOfBoundsSince(Date.now()), 0);
      }
    } else {
      if (outOfBoundsSince !== null) {
        timer = setTimeout(() => setOutOfBoundsSince(null), 0);
      }
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isOutOfBounds, outOfBoundsSince]);

  const graceSecondsTotal = state?.game?.boundary_grace_s || 15;
  const remainingGraceS = outOfBoundsSince
    ? Math.max(0, graceSecondsTotal - Math.floor((now - outOfBoundsSince) / 1000))
    : graceSecondsTotal;

  const isMapLocked = useMemo(() => {
    if (!state) return false;
    const lockedParam = (state.game.mode_params as any)?.locked_map;
    if (lockedParam !== undefined && lockedParam !== null) {
      return Boolean(lockedParam);
    }
    const difficulty = (state.game as any).difficulty || 'standard';
    return difficulty === 'standard' || difficulty === 'hardcore' || difficulty === 'blackout' || difficulty === 'extreme';
  }, [state]);

  const isBlackoutMode = useMemo(() => {
    if (!state) return false;
    const diff = (state.game as any).difficulty;
    const params = (state.game.mode_params as any) || {};
    return (
      diff === 'blackout' ||
      diff === 'extreme' ||
      Boolean(params.blackout) ||
      Boolean(params.radar_only)
    );
  }, [state]);

  // User preference: headstart mini-map enabled & default corner
  const [minimapEnabled, setMinimapEnabled] = useState(true);
  const [defaultCorner, setDefaultCorner] = useState<MiniMapCorner>('top-right');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [storedEnabled, storedCorner] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_MINIMAP_ENABLED),
          AsyncStorage.getItem(STORAGE_KEY_MINIMAP_CORNER),
        ]);
        if (!mounted) return;
        if (storedEnabled !== null) {
          setMinimapEnabled(storedEnabled !== 'false');
        }
        if (
          storedCorner &&
          ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(storedCorner)
        ) {
          setDefaultCorner(storedCorner as MiniMapCorner);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const isHeadStart = state?.game?.status === 'head_start';
  const showHeadStartMiniMap = isHeadStart && myRole === 'runner' && minimapEnabled;

  const headstartSecondsLeft = useMemo(() => {
    if (!state || !isHeadStart || !state.game.live_at) return null;
    return Math.max(0, Math.ceil((Date.parse(state.game.live_at) - serverNow) / 1000));
  }, [state, isHeadStart, serverNow]);

  const widgetProps = useMemo(() => {
    if (!state) return null;
    return {
      gameId,
      state,
      actions,
      ownFix,
      serverNow,
      myRole,
      phase: state.game.status,
      isCompact,
    };
  }, [actions, gameId, isCompact, myRole, ownFix, serverNow, state]);

  // Slot distribution
  const { topWidgets, bannerWidgets, actionWidgets, overlayWidgets, mapLayerWidgets, sheetWidgets } =
    useMemo(() => {
      const top: React.ReactNode[] = [];
      const banner: React.ReactNode[] = [];
      const actionsList: React.ReactNode[] = [];
      const overlay: React.ReactNode[] = [];
      const mapLayers: React.ReactNode[] = [];
      const sheet: React.ReactNode[] = [];

      if (!widgetProps || !state) {
        return {
          topWidgets: null,
          bannerWidgets: null,
          actionWidgets: [],
          overlayWidgets: null,
          mapLayerWidgets: null,
          sheetWidgets: null,
        };
      }

      const phase = state.game.status;
      const allWidgets = getActiveHudWidgets(modeId, modifiers, roles);

      for (const w of allWidgets) {
        // Check role and phase compatibility
        const matchesRole = w.roles.includes(myRole) || w.roles.includes('solo');
        const matchesPhase = w.phases.includes(phase);
        if (!matchesRole || !matchesPhase) continue;

          const rendered = <w.Component key={w.id} {...widgetProps} />;

          switch (w.slot) {
            case 'top':
              top.push(rendered);
              break;
            case 'banner':
              banner.push(rendered);
              break;
            case 'actions':
              actionsList.push(rendered);
              break;
            case 'overlay':
              overlay.push(rendered);
              break;
            case 'mapLayer':
              mapLayers.push(rendered);
              break;
            case 'sheet':
              sheet.push(rendered);
              break;
          }
        }

      return {
        topWidgets: top.length > 0 ? <View style={{ gap: 4 }}>{top}</View> : null,
        bannerWidgets: banner.length > 0 ? <View style={{ gap: 6 }}>{banner}</View> : null,
        actionWidgets: actionsList,
        overlayWidgets: overlay.length > 0 ? <>{overlay}</> : null,
        mapLayerWidgets: mapLayers.length > 0 ? <>{mapLayers}</> : null,
        sheetWidgets: sheet.length > 0 ? <View style={{ gap: 8 }}>{sheet}</View> : null,
      };
    }, [modeId, modifiers, myRole, roles, state, widgetProps]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: tokens.colors.background }]}>
        <ActivityIndicator color={tokens.colors.primary} size="large" />
        <Text variant="label" style={{ marginTop: 12, color: tokens.colors.textMuted }}>
          CONNECTING TO GRID...
        </Text>
      </View>
    );
  }

  if (error || !state) {
    return (
      <View style={[styles.center, { backgroundColor: tokens.colors.background }]}>
        <Text variant="title" style={{ color: tokens.colors.danger }}>
          RADAR LINK OFFLINE
        </Text>
        <Text variant="body" style={{ color: tokens.colors.textMuted, marginTop: 8 }}>
          {error || 'Unable to synchronize round state.'}
        </Text>
      </View>
    );
  }

  // Common Header & Banners
  const commonTop = (
    <>
      <HudFrame
        extraChips={topWidgets}
        isCompact={isCompact}
        muted={muted}
        onToggleCompact={() => setIsCompact((c) => !c)}
        onToggleMute={() => setMuted((m) => !m)}
        onToggleSfx={async () => {
          const next = await toggleAudioMuted();
          setSfxMuted(next);
        }}
        serverNow={serverNow}
        sfxMuted={sfxMuted}
        state={state}
      />
      <View style={{ marginTop: isCompact ? 105 : 155 }}>
        <PhaseBanner
          actions={actions}
          isOutOfBounds={isOutOfBounds}
          remainingGraceS={remainingGraceS}
          serverNow={serverNow}
          state={state}
          vehicleWarning={state.safety?.vehicle_warning}
        />
        <TrackingStatus
          accuracyM={fix?.accuracy ?? null}
          backgroundSharing={backgroundSharing}
          onOpenSettings={() => void openLocationSettings()}
          onRetry={() => void startSharing()}
          sharing={sharing}
        />
        <EventFeed events={state.events || []} maxEvents={2} />
      </View>
    </>
  );

  return (
    <View style={[styles.screen, { backgroundColor: tokens.colors.background }]}>
      {/* Tactical Canvas: Blackout Radial Heatmap Radar OR MapView */}
      {isBlackoutMode ? (
        <TacticalRadarCanvas
          area={state.game.area}
          extraction={(state.game as any).extraction || (state as any).relay_heist?.extraction || null}
          jail={state.game.jail}
          myRole={myRole}
          ownFix={ownFix}
          pings={pings}
          players={state.players}
          safeZones={(state.game as any).safe_zones || []}
          tagRadiusM={state.game.tag_radius_m || 20}
          target={target}
          teammates={teammates}
          userHeading={userHeading}
        />
      ) : showHeadStartMiniMap ? (
        <MovableCornerMiniMap
          initialCorner={defaultCorner}
          borderColor={colors.runner}
          backgroundColor={colors.surface}
          onCornerChange={(c) => setDefaultCorner(c)}
        >
          <MapView
            area={state.game.area}
            modeLayers={mapLayerWidgets}
            onPressMap={undefined}
            ownFix={ownFix}
            pings={pings}
            tagRadiusM={state.game.tag_radius_m || 20}
            target={target}
            targetRadiusM={state.game.target_radius_m || 25}
            teammates={teammates}
            isMapLocked={isMapLocked}
            userHeading={userHeading}
          />
          <View style={[styles.miniMapBadge, { backgroundColor: colors.runner }]}>
            <Text style={styles.miniMapBadgeText}>TACTICAL RADAR</Text>
          </View>
        </MovableCornerMiniMap>
      ) : (
        <MapView
          area={state.game.area}
          modeLayers={mapLayerWidgets}
          onPressMap={() => {
            if (!isCompact && !isMapLocked) {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setIsCompact(true);
            }
          }}
          ownFix={ownFix}
          pings={pings}
          tagRadiusM={state.game.tag_radius_m || 20}
          target={target}
          targetRadiusM={state.game.target_radius_m || 25}
          teammates={teammates}
          isMapLocked={isMapLocked}
          userHeading={userHeading}
        />
      )}

      {/* Runner Headstart Directives Overlay Or Normal Role Layout */}
      {showHeadStartMiniMap ? (
        <View
          style={[
            styles.headstartScreen,
            {
              paddingTop: Math.max(insets.top, 16) + 20,
              paddingBottom: Math.max(insets.bottom, 16) + 20,
            },
          ]}
        >
          {/* Top Info Bar */}
          <View style={styles.headstartHeaderRow}>
            <View
              style={[
                styles.headstartStatusPill,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.runner },
              ]}
            >
              <Ionicons name="flash" size={14} color={colors.runner} />
              <Text variant="caption" style={{ color: colors.runner, fontWeight: '800', marginLeft: 6 }}>
                RUNNER HEADSTART
              </Text>
            </View>
          </View>

          {/* Central Countdown & Scatter Directives */}
          <View style={styles.headstartCountdownCenter}>
            <Text variant="caption" style={{ color: colors.textMuted, letterSpacing: 2, marginBottom: 8 }}>
              HUNTER PURSUIT COMMENCES IN
            </Text>
            <Text
              variant="display"
              style={{
                color: colors.runner,
                fontSize: 76,
                fontWeight: '900',
                lineHeight: 80,
                fontVariant: ['tabular-nums'],
              }}
            >
              {headstartSecondsLeft !== null ? `${headstartSecondsLeft}s` : '--'}
            </Text>
            <Text
              variant="title"
              style={{
                color: colors.text,
                letterSpacing: 2,
                fontSize: 18,
                fontWeight: '800',
                marginTop: 14,
                textAlign: 'center',
              }}
            >
              SCATTER & REACH COVER
            </Text>
            <Text
              variant="body"
              style={{
                color: colors.textMuted,
                textAlign: 'center',
                marginTop: 10,
                maxWidth: 320,
                lineHeight: 20,
                fontSize: 14,
              }}
            >
              Hunters are held at spawn until timer expires. Break line of sight immediately and advance toward your mission objectives.
            </Text>
          </View>

          {/* Bottom Directives & Radar Card */}
          <View style={styles.headstartDirectivesCard}>
            <Card
              variant="elevated"
              style={[
                styles.directiveCard,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons
                  name={isMapLocked ? 'compass-outline' : 'navigate-outline'}
                  size={22}
                  color={colors.primary}
                  style={{ marginRight: 12 }}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="label" style={{ color: colors.primary }}>
                    {isMapLocked ? 'TACTICAL COMPASS LOCKED' : 'TACTICAL OVERVIEW'}
                  </Text>
                  <Text variant="caption" style={{ color: colors.textMuted, marginTop: 2 }}>
                    {isMapLocked
                      ? 'Operative locked to center; map auto-rotates with your phone.'
                      : 'Corner radar active. Full tactical map restores upon launch.'}
                  </Text>
                </View>
              </View>
            </Card>
          </View>
        </View>
      ) : sprintMode ? (
        <SprintLayout
          {...widgetProps!}
          onExitSprint={() => setSprintMode(false)}
          onOpenSos={() => setSosVisible(true)}
          primaryAction={actionWidgets[0]}
        />
      ) : myRole === 'operator' ? (
        <OperatorLayout
          {...widgetProps!}
          actionWidgets={actionWidgets}
          bannerWidgets={bannerWidgets}
          overlayWidgets={overlayWidgets}
          sheetWidgets={sheetWidgets}
          topWidgets={commonTop}
        />
      ) : myRole === 'spectator' ? (
        <SpectatorLayout
          {...widgetProps!}
          bannerWidgets={bannerWidgets}
          overlayWidgets={overlayWidgets}
          sheetWidgets={sheetWidgets}
          topWidgets={commonTop}
        />
      ) : myRole === 'hunter' ? (
        <HunterLayout
          {...widgetProps!}
          actionWidgets={actionWidgets}
          bannerWidgets={bannerWidgets}
          overlayWidgets={overlayWidgets}
          sheetWidgets={sheetWidgets}
          topWidgets={commonTop}
        />
      ) : (
        <RunnerLayout
          {...widgetProps!}
          actionWidgets={actionWidgets}
          bannerWidgets={bannerWidgets}
          overlayWidgets={overlayWidgets}
          sheetWidgets={sheetWidgets}
          topWidgets={commonTop}
        />
      )}

      {/* Universal Emergency SOS Sheet */}
      <SosSheet
        actions={actions}
        onClose={() => setSosVisible(false)}
        visible={sosVisible}
      />

      {/* Periodic Safety Check-in Modal (NF-06) */}
      <SafetyCheckinModal
        countdownSeconds={checkinCountdown}
        onConfirmOk={handleCheckinOk}
        onTriggerSos={handleCheckinSos}
        visible={checkinVisible}
      />

      {/* Team Radio Floating Trigger (NF-07) */}
      {myRole !== 'spectator' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Team Radio"
          onPress={() => {
            setRadioVisible(true);
            setUnreadRadioCount(0);
          }}
          style={[
            styles.radioFab,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: myRole === 'hunter' ? colors.danger : colors.primary,
            },
          ]}
        >
          <Ionicons
            name="radio-outline"
            size={22}
            color={myRole === 'hunter' ? colors.danger : colors.primary}
          />
          {unreadRadioCount > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: colors.accent }]}>
              <Text variant="caption" style={{ color: '#000', fontSize: 10, fontWeight: '700' }}>
                {unreadRadioCount}
              </Text>
            </View>
          )}
        </Pressable>
      )}

      {/* Team Radio Sheet (NF-07 & NF-08) */}
      <TeamRadioSheet
        visible={radioVisible}
        gameId={gameId}
        myTeam={myRole === 'hunter' ? 'hunter' : 'runner'}
        myUserId={selectMyPlayer(state)?.user_id}
        onClose={() => setRadioVisible(false)}
        onUnreadChange={(delta) => setUnreadRadioCount((c) => c + delta)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  radioFab: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    zIndex: 50,
  },
  unreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  miniMapBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 3,
    alignItems: 'center',
  },
  miniMapBadgeText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headstartScreen: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    zIndex: 30,
  },
  headstartHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headstartStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  headstartCountdownCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  headstartDirectivesCard: {
    width: '100%',
  },
  directiveCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
});
