import { distanceM, type LngLat } from '../lib/geo';
import type { GamePlayer, Role, RoundState } from './types';

export function selectGame(state: RoundState | null) {
  return state?.game ?? null;
}

export function selectStatus(state: RoundState | null) {
  return state?.game?.status ?? null;
}

export function selectMyPlayerId(state: RoundState | null) {
  return state?.my_player_id ?? null;
}

export function selectMyPlayer(state: RoundState | null): GamePlayer | null {
  if (!state) return null;
  return state.players.find((p) => p.id === state.my_player_id) ?? null;
}

export function selectMyTeam(state: RoundState | null) {
  return state?.my_team ?? 'unassigned';
}

export function selectMyRole(state: RoundState | null): Role {
  if (!state) return 'spectator';
  const player = selectMyPlayer(state);
  if (!player) return 'spectator';
  if (player.status === 'tagged' || player.status === 'left') return 'spectator';
  if (player.is_remote || state.operator?.is_operator) return 'operator';
  if (player.team === 'solo') return 'solo';
  if (player.team === 'hunter') return 'hunter';
  if (player.team === 'runner') return 'runner';
  return 'spectator';
}

export function selectIsHost(state: RoundState | null) {
  if (!state) return false;
  const player = selectMyPlayer(state);
  return !!player && player.user_id === state.game.host_id;
}

export function selectPlayers(state: RoundState | null) {
  return state?.players ?? [];
}

export function selectActivePlayers(state: RoundState | null) {
  return (state?.players ?? []).filter((p) => p.status === 'active');
}

export function selectTaggedPlayers(state: RoundState | null) {
  return (state?.players ?? []).filter((p) => p.status === 'tagged');
}

export function selectJailedPlayers(state: RoundState | null) {
  return (state?.players ?? []).filter((p) => p.team === 'runner' && p.status === 'jailed');
}

export function selectRunnersRemaining(state: RoundState | null) {
  if (!state) return 0;
  return state.players.filter((p) => p.team === 'runner' && p.status === 'active').length;
}

export function selectHuntersCount(state: RoundState | null) {
  if (!state) return 0;
  return state.players.filter((p) => p.team === 'hunter' && p.status === 'active').length;
}

export function selectArea(state: RoundState | null) {
  return state?.game?.area ?? null;
}

export function selectEffectiveRadius(state: RoundState | null) {
  return state?.game?.area?.radius_m ?? 300;
}

export function selectPings(state: RoundState | null) {
  return state?.pings ?? [];
}

export function selectTeammates(state: RoundState | null) {
  if (!state) return [];
  const myTeam = state.my_team;
  return state.positions.filter(
    (pos) => pos.player_id !== state.my_player_id && pos.team === myTeam
  );
}

export function selectTarget(state: RoundState | null) {
  return state?.target ?? null;
}

export function selectEvents(state: RoundState | null) {
  return (state?.events ?? []).slice().sort((a, b) => b.id - a.id);
}

export function selectSafetyState(state: RoundState | null) {
  return state?.safety ?? null;
}

export function selectIsPaused(state: RoundState | null) {
  return state?.game?.status === 'paused' || state?.safety?.is_paused === true;
}

export function selectCurfewRemainingS(state: RoundState | null, serverNow: number) {
  const curfewAt = state?.safety?.curfew_at;
  if (!curfewAt) return null;
  const remaining = Math.ceil((Date.parse(curfewAt) - serverNow) / 1000);
  return Math.max(0, remaining);
}

export function selectNextPingIn(state: RoundState | null, serverNow: number) {
  if (!state?.game?.next_ping_at || state.game.status !== 'live') return null;
  const diff = Math.ceil((Date.parse(state.game.next_ping_at) - serverNow) / 1000);
  return Math.max(0, diff);
}

export function selectTimerValue(state: RoundState | null, serverNow: number) {
  if (!state) return null;
  const status = state.game.status;
  if (status === 'countdown') {
    if (!state.game.head_start_at) return null;
    return Math.max(0, Math.ceil((Date.parse(state.game.head_start_at) - serverNow) / 1000));
  }
  if (status === 'head_start') {
    if (!state.game.live_at) return null;
    return Math.max(0, Math.ceil((Date.parse(state.game.live_at) - serverNow) / 1000));
  }
  if (status === 'live') {
    if (!state.game.ends_at) return null;
    return Math.max(0, Math.ceil((Date.parse(state.game.ends_at) - serverNow) / 1000));
  }
  return null;
}

export function selectTimerLabel(state: RoundState | null) {
  if (!state) return 'ROUND TIME';
  const status = state.game.status;
  if (status === 'countdown') return 'COUNTDOWN';
  if (status === 'head_start') return 'HEAD START';
  if (status === 'live') return 'TIME REMAINING';
  if (status === 'paused') return 'PAUSED';
  if (status === 'ended') return 'MATCH OVER';
  return 'TIMER';
}

export function selectIsOutOfBounds(state: RoundState | null, ownFix: LngLat | null) {
  if (!state || !ownFix || !state.game?.area) return false;
  if (!['head_start', 'live'].includes(state.game.status)) return false;
  const dist = distanceM(ownFix, state.game.area);
  return dist > state.game.area.radius_m;
}

export function selectModeId(state: RoundState | null) {
  return state?.game?.mode_id || state?.game?.mode || 'classic_chase';
}

export function selectActiveModifiers(state: RoundState | null) {
  return state?.game?.modifiers ?? [];
}

export function selectActiveRoles(state: RoundState | null) {
  return state?.game?.roles ?? [];
}
