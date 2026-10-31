import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { supabase } from '../../src/lib/supabase';

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
type LobbyGame = {
  id: string;
  code: string;
  host_id: string;
  mode: 'classic_chase' | 'tag_hunt';
  status: string;
};
type LobbyState = {
  game: LobbyGame;
  players: LobbyPlayer[];
  my_player_id: string;
  my_team: Team;
  server_time: string;
};
type RpcResult = { error: { message: string } | null; data?: unknown };

export default function LobbyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gameId = Array.isArray(id) ? id[0] : id;
  const [state, setState] = useState<LobbyState | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [kickingPlayerId, setKickingPlayerId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string>('');

  const loadState = useCallback(async () => {
    if (!supabase || !gameId) return;
    const [{ data: authData }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('get_game_state', { game_id: gameId }),
    ]);
    setUserId(authData.user?.id ?? null);
    if (error) {
      if (error.message.includes('not a member')) {
        router.replace('/home');
        return;
      }
      setErrorMessage(error.message);
      return;
    }
    if (data) {
      setState(data as LobbyState);
      setErrorMessage('');
    }
  }, [gameId, router]);

  useEffect(() => {
    const initialLoad = setTimeout(() => void loadState(), 0);
    if (!supabase || !gameId) return;
    const channel = supabase
      .channel(`lobby-${gameId}`)
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
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` },
        (payload: { new?: { type?: string; payload?: { kicked?: boolean } } }) => {
          if (payload.new?.type === 'player_left' && payload.new?.payload?.kicked) {
            setBannerMessage('A player was kicked from the lobby.');
          }
          void loadState();
        },
      )
      .subscribe();
    return () => {
      clearTimeout(initialLoad);
      void supabase?.removeChannel(channel);
    };
  }, [gameId, loadState]);

  const isHost = Boolean(state && userId && state.game.host_id === userId);
  const activePlayers = useMemo(
    () => state?.players.filter((player) => player.status === 'active') ?? [],
    [state],
  );
  const hasBothTeams =
    activePlayers.some((player) => player.team === 'runner') &&
    activePlayers.some((player) => player.team === 'hunter');
  const everyoneReady =
    activePlayers.length >= 2 && activePlayers.every((player) => player.is_ready);
  const everyoneAssigned = activePlayers.every((player) => player.team !== 'unassigned');
  const canStart = hasBothTeams && everyoneAssigned;

  // The host moves everyone along; every player follows the game's phase.
  useEffect(() => {
    if (!state || !gameId) return;
    if (state.game.status === 'target_selection') {
      router.replace({ pathname: '/target/[id]', params: { id: gameId } });
    } else if (
      ['countdown', 'head_start', 'live', 'ended', 'cancelled'].includes(state.game.status)
    ) {
      router.replace({ pathname: '/game/[id]', params: { id: gameId } });
    }
  }, [gameId, router, state]);

  async function runAction(action: string, call: () => PromiseLike<RpcResult>) {
    setBusyAction(action);
    setErrorMessage('');
    const result = await call();
    setBusyAction('');
    if (result.error) {
      setErrorMessage(result.error.message);
      return false;
    }
    await loadState();
    if (action === 'continue' && result.data === 'target_selection' && gameId) {
      router.replace({ pathname: '/target/[id]', params: { id: gameId } });
    }
    return true;
  }

  async function setTeam(player: LobbyPlayer, team: Exclude<Team, 'unassigned'>) {
    if (!supabase || !gameId) return;
    await runAction('team', () =>
      supabase!.rpc('set_team', { game_id: gameId, player_id: player.id, team }),
    );
  }

  async function randomizeTeams() {
    if (!supabase || !gameId) return;
    const hunterCount = Math.max(1, Math.floor(activePlayers.length / 3));
    await runAction('randomize', () =>
      supabase!.rpc('randomize_teams', { game_id: gameId, hunter_count: hunterCount }),
    );
  }

  async function continueLobby() {
    if (!supabase || !gameId) return;
    await runAction('continue', () => supabase!.rpc('begin_target_selection', { game_id: gameId }));
  }

  async function startRound() {
    if (!supabase || !gameId) return;
    const started = await runAction('start', () =>
      supabase!.rpc('start_game', { game_id: gameId }),
    );
    if (started) router.replace({ pathname: '/game/[id]', params: { id: gameId } });
  }

  async function toggleReady() {
    if (!supabase || !gameId) return;
    const ownPlayer = state?.players.find((player) => player.id === state.my_player_id);
    await runAction('ready', () =>
      supabase!.rpc('set_ready', { game_id: gameId, ready: !ownPlayer?.is_ready }),
    );
  }

  async function confirmKick(player: LobbyPlayer) {
    if (!supabase || !gameId) return;
    setKickingPlayerId(null);
    await runAction('kick', () =>
      supabase!.rpc('kick_player', { game_id: gameId, player_id: player.id }),
    );
  }

  async function leaveLobby() {
    if (!supabase || !gameId) return;
    setBusyAction('leave');
    const { error } = await supabase.rpc('leave_game', { game_id: gameId });
    setBusyAction('');
    if (error) setErrorMessage(error.message);
    else router.replace('/home');
  }

  async function cancelGame() {
    if (!supabase || !gameId) return;
    setBusyAction('cancel');
    const { error } = await supabase.rpc('cancel_game', { game_id: gameId });
    setBusyAction('');
    if (error) setErrorMessage(error.message);
    else router.replace('/home');
  }

  async function shareCode() {
    if (!state) return;
    await Share.share({ message: `Join my GhostRun lobby with code ${state.game.code}.` });
  }

  if (!state) {
    return (
      <View style={styles.loading}>
        {errorMessage ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage}
          </Text>
        ) : (
          <ActivityIndicator color="#1D4ED8" size="large" />
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => void loadState()}
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>Refresh lobby</Text>
        </Pressable>
      </View>
    );
  }

  const self = state.players.find((player) => player.id === state.my_player_id);
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>
        GAME LOBBY · {state.game.mode === 'classic_chase' ? 'CLASSIC CHASE' : 'TAG HUNT'}
      </Text>
      <View style={styles.codeCard}>
        <View style={styles.codeTextWrap}>
          <Text style={styles.codeLabel}>JOIN CODE</Text>
          <Text style={styles.code}>{state.game.code}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void shareCode()}
          style={styles.shareButton}
        >
          <Text style={styles.shareText}>Share</Text>
        </Pressable>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Players</Text>
        <Text style={styles.playerCount}>{activePlayers.length}/20</Text>
      </View>

      {state.players.map((player) => (
        <View key={player.id} style={styles.playerCard}>
          <View style={[styles.avatar, { backgroundColor: player.color }]}>
            <Text style={styles.avatarLetter}>{player.display_name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.playerDetails}>
            <View style={styles.playerNameRow}>
              <Text style={styles.playerName}>{player.display_name}</Text>
              {player.user_id === state.game.host_id && (
                <MaterialCommunityIcons color="#EAB308" name="crown" size={14} />
              )}
              {player.user_id === userId && <Text style={styles.playerYou}>(you)</Text>}
            </View>
            <Text style={styles.playerSub}>
              {player.team === 'unassigned'
                ? 'Choose a team'
                : player.team === 'runner'
                  ? 'Runner'
                  : 'Hunter'}{' '}
              · {player.is_ready ? 'Ready' : 'Not ready'}
            </Text>
          </View>
          <View style={styles.playerActions}>
            {kickingPlayerId === player.id ? (
              <View style={styles.confirmKickRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void confirmKick(player)}
                  style={styles.confirmKickButton}
                >
                  <Text style={styles.confirmKickText}>Kick</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setKickingPlayerId(null)}
                  style={styles.cancelKickButton}
                >
                  <Text style={styles.cancelKickText}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {(player.user_id === userId || isHost) && (
                  <>
                    <TeamButton
                      label="R"
                      accessibilityLabel={`Set ${player.display_name} as runner`}
                      selected={player.team === 'runner'}
                      onPress={() => void setTeam(player, 'runner')}
                    />
                    <TeamButton
                      label="H"
                      accessibilityLabel={`Set ${player.display_name} as hunter`}
                      selected={player.team === 'hunter'}
                      onPress={() => void setTeam(player, 'hunter')}
                    />
                  </>
                )}
                {isHost && player.user_id !== userId && (
                  <Pressable
                    accessibilityLabel={`Kick ${player.display_name}`}
                    accessibilityRole="button"
                    onPress={() => setKickingPlayerId(player.id)}
                    style={styles.kickButton}
                  >
                    <Ionicons color="#EF4444" name="close" size={16} />
                  </Pressable>
                )}
              </>
            )}
          </View>
        </View>
      ))}

      {isHost && (
        <Pressable
          accessibilityRole="button"
          disabled={busyAction !== '' || activePlayers.length < 2}
          onPress={() => void randomizeTeams()}
          style={styles.secondaryButton}
        >
          {busyAction === 'randomize' ? (
            <ActivityIndicator color="#1D4ED8" />
          ) : (
            <Text style={styles.secondaryText}>Randomize teams</Text>
          )}
        </Pressable>
      )}

      {errorMessage !== '' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {errorMessage}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={!self || busyAction !== ''}
        onPress={() => void toggleReady()}
        style={[styles.readyButton, self?.is_ready && styles.readySelected]}
      >
        {busyAction === 'ready' ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <View style={styles.readyContentRow}>
            {self?.is_ready && <Ionicons color="#FFFFFF" name="checkmark-circle" size={18} />}
            <Text style={styles.readyText}>{self?.is_ready ? 'Ready' : 'Ready up'}</Text>
          </View>
        )}
      </Pressable>

      {state.game.mode === 'classic_chase' ? (
        isHost && (
          <Pressable
            accessibilityRole="button"
            disabled={
              busyAction !== '' ||
              !activePlayers.some((player) => player.team === 'runner') ||
              !activePlayers.some((player) => player.team === 'hunter')
            }
            onPress={() => void continueLobby()}
            style={[
              styles.continueButton,
              (busyAction !== '' ||
                !activePlayers.some((player) => player.team === 'runner') ||
                !activePlayers.some((player) => player.team === 'hunter')) &&
                styles.disabledButton,
            ]}
          >
            {busyAction === 'continue' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.continueText}>Continue to target</Text>
            )}
          </Pressable>
        )
      ) : isHost ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={busyAction !== '' || !canStart}
            onPress={() => void startRound()}
            style={[
              styles.continueButton,
              (busyAction !== '' || !canStart) && styles.disabledButton,
            ]}
          >
            {busyAction === 'start' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.continueText}>Start round</Text>
            )}
          </Pressable>
          <Text style={styles.modeNote}>
            {!hasBothTeams
              ? 'Assign at least one runner and one hunter before starting.'
              : !everyoneAssigned
                ? 'Every player must choose a team before the round can start.'
                : !everyoneReady
                  ? "Some players aren't ready. They'll be carried into the round."
                  : 'Tag Hunt has no target. The 10-second countdown starts as soon as you press start.'}
          </Text>
        </>
      ) : (
        <Text style={styles.modeNote}>
          {everyoneReady
            ? 'Everyone is ready. The host can start the round.'
            : canStart
              ? 'Teams are assigned. Waiting for the host to start the round.'
              : 'Tag Hunt has no target. Ready up and wait for the host to start the round.'}
        </Text>
      )}

      {bannerMessage !== '' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{bannerMessage}</Text>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={busyAction !== ''}
        onPress={() => void leaveLobby()}
        style={styles.leaveButton}
      >
        {busyAction === 'leave' ? (
          <ActivityIndicator color="#B91C1C" />
        ) : (
          <Text style={styles.leaveText}>Leave lobby</Text>
        )}
      </Pressable>

      {isHost && (
        <Pressable
          accessibilityRole="button"
          disabled={busyAction !== ''}
          onPress={() => void cancelGame()}
          style={styles.cancelGameButton}
        >
          {busyAction === 'cancel' ? (
            <ActivityIndicator color="#B91C1C" />
          ) : (
            <Text style={styles.cancelGameText}>Cancel game</Text>
          )}
        </Pressable>
      )}
    </ScrollView>
  );
}

function TeamButton({
  label,
  accessibilityLabel,
  selected,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.teamButton, selected && styles.teamButtonSelected]}
    >
      <Text style={[styles.teamButtonText, selected && styles.teamButtonTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F8FAFC',
    flexGrow: 1,
    padding: 20,
    paddingBottom: 38,
    paddingTop: 58,
  },
  loading: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  eyebrow: { color: '#1D4ED8', fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  codeCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    padding: 18,
  },
  codeTextWrap: { flex: 1 },
  codeLabel: { color: '#64748B', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  code: { color: '#0F172A', fontSize: 32, fontWeight: '900', letterSpacing: 6, marginTop: 3 },
  shareButton: {
    alignItems: 'center',
    backgroundColor: '#DBEAFE',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  shareText: { color: '#1D4ED8', fontSize: 15, fontWeight: '800' },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 26,
  },
  sectionTitle: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  playerCount: { color: '#64748B', fontSize: 14, fontWeight: '700' },
  playerCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    flexDirection: 'row',
    marginBottom: 8,
    minHeight: 70,
    paddingHorizontal: 12,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarLetter: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  playerDetails: { flex: 1, marginLeft: 10 },
  playerNameRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  playerName: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  playerYou: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  playerSub: { color: '#64748B', fontSize: 12, marginTop: 4 },
  playerActions: { flexDirection: 'row', gap: 6 },
  teamButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 9,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  teamButtonSelected: { backgroundColor: '#DBEAFE', borderColor: '#1D4ED8' },
  teamButtonText: { color: '#334155', fontSize: 14, fontWeight: '900' },
  teamButtonTextSelected: { color: '#1D4ED8' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#1D4ED8',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 48,
  },
  secondaryText: { color: '#1D4ED8', fontSize: 15, fontWeight: '800' },
  readyButton: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 13,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 52,
  },
  readySelected: { backgroundColor: '#059669' },
  readyContentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  readyText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  continueButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 13,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 52,
  },
  disabledButton: { opacity: 0.55 },
  continueText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  leaveButton: { alignItems: 'center', justifyContent: 'center', marginTop: 8, minHeight: 44 },
  leaveText: { color: '#B91C1C', fontSize: 14, fontWeight: '700' },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#DBEAFE',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 20,
  },
  retryText: { color: '#1D4ED8', fontSize: 15, fontWeight: '800' },
  modeNote: { color: '#94A3B8', fontSize: 12, lineHeight: 18, marginTop: 12 },
  error: { color: '#B91C1C', fontSize: 13, lineHeight: 19, marginTop: 8 },
  kickButton: {
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderRadius: 9,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  kickButtonText: { color: '#DC2626', fontSize: 13, fontWeight: '800' },
  confirmKickRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  confirmKickButton: {
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 8,
  },
  confirmKickText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  cancelKickButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 8,
  },
  cancelKickText: { color: '#64748B', fontSize: 12, fontWeight: '700' },
  banner: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 14,
    padding: 12,
  },
  bannerText: { color: '#1E40AF', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  cancelGameButton: {
    alignItems: 'center',
    borderColor: '#FECACA',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 44,
  },
  cancelGameText: { color: '#B91C1C', fontSize: 14, fontWeight: '700' },
});
