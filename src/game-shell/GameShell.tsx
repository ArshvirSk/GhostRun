import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  LayoutAnimation,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
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

import type { RoundState, ShellActions } from './types';
import { createShellActions } from './actions';
import {
  selectActiveModifiers,
  selectActiveRoles,
  selectIsOutOfBounds,
  selectModeId,
  selectMyRole,
  selectPings,
  selectTarget,
  selectTeammates,
} from './selectors';
import { MapView } from './MapView';
import { HudFrame } from './HudFrame';
import { PhaseBanner } from './PhaseBanner';
import { SosSheet } from './SosSheet';
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
  const { tokens } = useTheme();

  const [state, setState] = useState<RoundState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);

  // Shell controls
  const [isCompact, setIsCompact] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(false);
  const [sosVisible, setSosVisible] = useState(false);
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

  // Visual clock tick
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
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

  // Local location watcher
  useEffect(() => {
    if (sharing !== 'on') return;
    return watchLocation((nextFix) => {
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
      {/* Background Interactive Map */}
      <MapView
        area={state.game.area}
        modeLayers={mapLayerWidgets}
        onPressMap={() => {
          if (!isCompact) {
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
      />

      {/* Role-Specific Layout Or Sprint Mode */}
      {sprintMode ? (
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
});
