import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  FALLBACK_REGISTRY,
  parameterSummary,
  rulesFor,
  type ModeRegistry,
} from '../../src/lib/modeRegistry';
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
  mode_id: 'classic_chase' | 'tag_hunt';
  modifiers: string[];
  roles: string[];
  mode_params: Record<string, unknown>;
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
  // undefined = not loaded yet, null = must still choose (C3), boolean = chosen.
  const [shareChoice, setShareChoice] = useState<boolean | null | undefined>(undefined);
  const [savingShare, setSavingShare] = useState(false);
  const [registry, setRegistry] = useState<ModeRegistry>(FALLBACK_REGISTRY);
  const [draftModifiers, setDraftModifiers] = useState<string[]>([]);
  const [draftRoles, setDraftRoles] = useState<string[]>([]);
  const [scrambleCharges, setScrambleCharges] = useState<number>(1);
  const draftTouchedRef = useRef(false);
  const [savingModes, setSavingModes] = useState(false);
  const [modesMessage, setModesMessage] = useState('');

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
      const loaded = data as LobbyState;
      if (!draftTouchedRef.current) {
        setDraftModifiers(loaded.game.modifiers ?? []);
        setDraftRoles(loaded.game.roles ?? []);
        const daParams = loaded.game.mode_params?.double_agent as
          | { scramble_charges?: number }
          | undefined;
        if (daParams?.scramble_charges) {
          setScrambleCharges(Number(daParams.scramble_charges));
        }
      }
    }
    const { data: registryData } = await supabase.rpc('get_mode_registry');
    if (registryData) setRegistry(registryData as ModeRegistry);
    if (authData.user) {
      const { data: selfRow } = await supabase
        .from('players')
        .select('share_trail')
        .eq('game_id', gameId)
        .eq('user_id', authData.user.id)
        .maybeSingle();
      if (selfRow) setShareChoice((selfRow.share_trail as boolean | null) ?? null);
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

  async function chooseShare(share: boolean) {
    if (!supabase || !gameId) return;
    setSavingShare(true);
    setErrorMessage('');
    const { error } = await supabase.rpc('set_share_trail', { game_id: gameId, share });
    setSavingShare(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setShareChoice(share);
    await loadState();
  }

  function toggleDraft(list: 'modifiers' | 'roles', id: string) {
    draftTouchedRef.current = true;
    setModesMessage('');
    const setter = list === 'modifiers' ? setDraftModifiers : setDraftRoles;
    setter((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function saveModeConfig() {
    if (!supabase || !gameId) return;
    setSavingModes(true);
    setModesMessage('');
    const modeParams: Record<string, unknown> = {
      ...(state?.game.mode_params ?? {}),
    };
    if (draftRoles.includes('double_agent')) {
      modeParams.double_agent = {
        scramble_charges: scrambleCharges,
        scramble_cooldown_s: 120,
      };
    } else {
      delete modeParams.double_agent;
    }
    const { error } = await supabase.rpc('set_game_modes', {
      game_id: gameId,
      modifiers: draftModifiers,
      roles: draftRoles,
      mode_params: modeParams,
    });
    setSavingModes(false);
    if (error) {
      setModesMessage(error.message);
      return;
    }
    draftTouchedRef.current = false;
    await loadState();
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

      {shareChoice === null && (
        <View style={styles.shareSheet}>
          <Text style={styles.shareTitle}>Share your route after the game?</Text>
          <Text style={styles.shareBody}>
            When the game ends, a replay shows where everyone moved. You choose what others see of
            you.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={savingShare}
            onPress={() => void chooseShare(true)}
            style={styles.shareChoiceButton}
          >
            <Text style={styles.shareChoiceText}>Share my route</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={savingShare}
            onPress={() => void chooseShare(false)}
            style={styles.shareChoiceButton}
          >
            <Text style={styles.shareChoiceText}>Keep my route private</Text>
          </Pressable>
          <Text style={styles.shareHint}>
            Either way, in-game events such as tags and pings remain visible, because they already
            happened in front of everyone. You can change this until the game ends.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/privacy' as any)}
            style={styles.shareLinkRow}
          >
            <Text style={styles.shareLink}>How your location is used</Text>
          </Pressable>
        </View>
      )}

      {shareChoice !== null && shareChoice !== undefined && (
        <View style={styles.shareStatusRow}>
          <Text style={styles.shareStatusText}>
            Route after the game: {shareChoice ? 'shared with the crew' : 'private'}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={savingShare}
            onPress={() => void chooseShare(!shareChoice)}
            style={styles.shareLinkRow}
          >
            <Text style={styles.shareLink}>Change</Text>
          </Pressable>
        </View>
      )}

      {(() => {
        const registryMode = registry.modes.find((mode) => mode.id === state.game.mode_id);
        const activeModifiers = state.game.modifiers ?? [];
        const activeRoles = state.game.roles ?? [];
        const rules = rulesFor(activeModifiers, activeRoles);
        const compatibleModifiers = registry.modifiers.filter((modifier) =>
          registryMode?.compatible_modifiers.includes(modifier.id),
        );
        const compatibleRoles = registry.roles.filter((role) =>
          registryMode?.compatible_roles.includes(role.id),
        );
        const chosenModifiers = isHost ? draftModifiers : activeModifiers;
        const chosenRoles = isHost ? draftRoles : activeRoles;
        return (
          <View style={styles.modeCard}>
            <Text style={styles.cardEyebrow}>MODE</Text>
            <Text style={styles.modeName}>
              {registryMode?.name ??
                (state.game.mode === 'classic_chase' ? 'Classic Chase' : 'Tag Hunt')}
            </Text>
            <Text style={styles.modeHint}>
              {isHost
                ? 'You can add modifiers and roles until the round starts.'
                : 'The host chooses modifiers and roles. Everyone plays by the same rules.'}
            </Text>

            <Text style={styles.modeSub}>Modifiers</Text>
            <View style={styles.chipRow}>
              {compatibleModifiers.map((modifier) => {
                const active = chosenModifiers.includes(modifier.id);
                return (
                  <Pressable
                    key={modifier.id}
                    accessibilityRole="button"
                    disabled={!isHost || !modifier.enabled || savingModes}
                    onPress={() => toggleDraft('modifiers', modifier.id)}
                    style={[
                      styles.chip,
                      active && styles.chipActive,
                      (!modifier.enabled || !isHost) && styles.chipDisabled,
                    ]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {modifier.name}
                      {modifier.enabled ? '' : ' · Soon'}
                    </Text>
                    {active && modifier.enabled && parameterSummary(modifier) !== '' && (
                      <Text style={styles.chipParams}>{parameterSummary(modifier)}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modeSub}>Roles</Text>
            <View style={styles.chipRow}>
              {compatibleRoles.map((role) => {
                const active = chosenRoles.includes(role.id);
                return (
                  <Pressable
                    key={role.id}
                    accessibilityRole="button"
                    disabled={!isHost || !role.enabled || savingModes}
                    onPress={() => toggleDraft('roles', role.id)}
                    style={[
                      styles.chip,
                      active && styles.chipActive,
                      (!role.enabled || !isHost) && styles.chipDisabled,
                    ]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {role.name}
                      {role.enabled ? '' : ' · Soon'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {chosenRoles.includes('double_agent') && isHost && (
              <View style={styles.roleConfigBox}>
                <Text style={styles.roleConfigTitle}>DOUBLE AGENT SETTINGS</Text>
                <View style={styles.roleConfigRow}>
                  <Text style={styles.roleConfigLabel}>Scramble Charges:</Text>
                  <View style={styles.chargeButtonGroup}>
                    {[1, 2, 3].map((num) => (
                      <Pressable
                        key={num}
                        accessibilityLabel={`Set ${num} scramble charges`}
                        accessibilityRole="button"
                        onPress={() => {
                          draftTouchedRef.current = true;
                          setScrambleCharges(num);
                        }}
                        style={[
                          styles.chargeButton,
                          scrambleCharges === num && styles.chargeButtonActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.chargeButtonText,
                            scrambleCharges === num && styles.chargeButtonTextActive,
                          ]}
                        >
                          {num}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <Text style={styles.roleConfigHint}>Cooldown between scrambles: 120s (2 min)</Text>
              </View>
            )}

            {rules.length > 0 && (
              <View style={styles.rulesBox}>
                <Text style={styles.rulesTitle}>RULES THIS ROUND</Text>
                {rules.map((line) => (
                  <Text key={line} style={styles.ruleLine}>
                    • {line}
                  </Text>
                ))}
              </View>
            )}

            {isHost && (
              <Pressable
                accessibilityRole="button"
                disabled={savingModes}
                onPress={() => void saveModeConfig()}
                style={styles.saveModesButton}
              >
                {savingModes ? (
                  <ActivityIndicator color="#1D4ED8" size="small" />
                ) : (
                  <Text style={styles.saveModesText}>Save mode setup</Text>
                )}
              </Pressable>
            )}
            {modesMessage !== '' && (
              <Text accessibilityRole="alert" style={styles.error}>
                {modesMessage}
              </Text>
            )}
          </View>
        );
      })()}

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
  shareSheet: {
    backgroundColor: '#FFFFFF',
    borderColor: '#BFDBFE',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
  },
  shareTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  shareBody: { color: '#475569', fontSize: 14, lineHeight: 20, marginTop: 6 },
  shareChoiceButton: {
    alignItems: 'center',
    borderColor: '#1D4ED8',
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 52,
  },
  shareChoiceText: { color: '#1D4ED8', fontSize: 16, fontWeight: '800' },
  shareHint: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 12 },
  shareLinkRow: { justifyContent: 'center', minHeight: 44 },
  shareLink: { color: '#1D4ED8', fontSize: 14, fontWeight: '700' },
  shareStatusRow: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 14,
  },
  shareStatusText: { color: '#334155', flex: 1, fontSize: 13, fontWeight: '600' },
  modeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    elevation: 2,
    marginBottom: 16,
    padding: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  cardEyebrow: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  modeName: { color: '#0F172A', fontSize: 20, fontWeight: '900', marginTop: 4 },
  modeHint: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 4 },
  modeSub: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
    marginTop: 14,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderColor: '#CBD5E1',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: '#EFF6FF', borderColor: '#1D4ED8' },
  chipDisabled: { opacity: 0.45 },
  chipText: { color: '#334155', fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#1D4ED8' },
  chipParams: { color: '#64748B', fontSize: 10, marginTop: 2 },
  rulesBox: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
    padding: 12,
  },
  rulesTitle: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  ruleLine: { color: '#334155', fontSize: 13, lineHeight: 19 },
  saveModesButton: {
    alignItems: 'center',
    borderColor: '#1D4ED8',
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 48,
  },
  saveModesText: { color: '#1D4ED8', fontSize: 15, fontWeight: '800' },
  roleConfigBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    marginTop: 12,
    padding: 12,
  },
  roleConfigTitle: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  roleConfigRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  roleConfigLabel: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  chargeButtonGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  chargeButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 36,
  },
  chargeButtonActive: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  chargeButtonText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  chargeButtonTextActive: {
    color: '#FFFFFF',
  },
  roleConfigHint: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 6,
  },
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
