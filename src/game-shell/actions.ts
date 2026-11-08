import { supabase } from '../lib/supabase';
import type { ShellActions } from './types';

export function createShellActions(
  gameId: string,
  onRefresh: () => Promise<void>
): ShellActions {
  return {
    refreshState: async () => {
      await onRefresh();
    },

    attemptTag: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { data, error } = await supabase.rpc('attempt_tag', { game_id: gameId });
        if (error) return { ok: false, error: error.message };
        const res = data as { ok: boolean; message?: string } | null;
        await onRefresh();
        return { ok: res?.ok ?? false, message: res?.message };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Tag failed' };
      }
    },

    leaveGame: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('leave_game', { game_id: gameId });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Leave failed' };
      }
    },

    sendSos: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('send_sos', { game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'SOS failed' };
      }
    },

    pauseGame: async (reason = 'safety_pause') => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('pause_game', { game_id: gameId, reason });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Pause failed' };
      }
    },

    resumeGame: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('resume_game', { game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Resume failed' };
      }
    },

    votePauseGame: async (vote: boolean) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('vote_pause_game', { game_id: gameId, vote });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Vote failed' };
      }
    },

    startRescue: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('start_rescue', { game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Rescue start failed' };
      }
    },

    completeRescue: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('complete_rescue', { game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Rescue completion failed' };
      }
    },

    cancelRescue: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('cancel_rescue', { game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Cancel rescue failed' };
      }
    },

    tagGhost: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('tag_ghost', { game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Ghost tag failed' };
      }
    },

    requestRoleSwap: async (targetPlayerId: string) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('request_role_swap', {
          p_game_id: gameId,
          p_target_player_id: targetPlayerId,
        });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Swap request failed' };
      }
    },

    confirmRoleSwap: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('confirm_role_swap', { p_game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Confirm swap failed' };
      }
    },

    cancelRoleSwap: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('cancel_role_swap', { p_game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Cancel swap failed' };
      }
    },

    requestHandoff: async (targetPlayerId: string) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('request_handoff', {
          p_game_id: gameId,
          p_target_player_id: targetPlayerId,
        });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Handoff request failed' };
      }
    },

    confirmHandoff: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('confirm_handoff', { p_game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Confirm handoff failed' };
      }
    },

    pickupPackage: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('pickup_package', { p_game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Pickup failed' };
      }
    },

    startSecuringPackage: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('start_securing_package', { p_game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Start secure failed' };
      }
    },

    completeSecurePackage: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('complete_secure_package', { p_game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Complete secure failed' };
      }
    },

    cancelSecuringPackage: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('cancel_securing_package', { p_game_id: gameId });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Cancel secure failed' };
      }
    },

    placeMarker: async (lat: number, lng: number, label = 'Waypoint') => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('place_marker', {
          p_game_id: gameId,
          p_lat: lat,
          p_lng: lng,
          p_label: label,
        });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Place marker failed' };
      }
    },

    clearMarker: async (markerId: string) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('clear_marker', {
          p_game_id: gameId,
          p_marker_id: markerId,
        });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Clear marker failed' };
      }
    },

    operatorScan: async (target?: { lat: number; lng: number }) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const params: Record<string, any> = { p_game_id: gameId };
        if (target) {
          params.p_target_lat = target.lat;
          params.p_target_lng = target.lng;
        }
        const { data, error } = await supabase.rpc('operator_scan', params);
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true, data };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Scan failed' };
      }
    },

    sendOperatorMessage: async (message: string) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('send_operator_message', {
          p_game_id: gameId,
          p_message: message,
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Comms failed' };
      }
    },

    heatPress: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { data, error } = await supabase.rpc('heat_press', { p_game_id: gameId });
        if (error) return { ok: false, error: error.message };
        const result = (data as any)?.result ?? (data as any) ?? null;
        await onRefresh();
        return { ok: true, result };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Heat press failed' };
      }
    },

    agentWhisper: async () => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { data, error } = await supabase.rpc('agent_whisper', { p_game_id: gameId });
        if (error) return { ok: false, error: error.message };
        const quadrant = (data as any)?.quadrant;
        await onRefresh();
        return { ok: true, quadrant };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Whisper failed' };
      }
    },

    agentScramble: async (targetPlayerId: string) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('agent_scramble', {
          p_game_id: gameId,
          p_target_player_id: targetPlayerId,
        });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Scramble failed' };
      }
    },

    conveneTribunal: async (accusedPlayerId: string) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('convene_tribunal', {
          p_game_id: gameId,
          p_accused_player_id: accusedPlayerId,
        });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Tribunal failed' };
      }
    },

    castTribunalVote: async (tribunalId: string, vote: boolean) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('cast_tribunal_vote', {
          p_tribunal_id: tribunalId,
          p_vote: vote,
        });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Vote failed' };
      }
    },

    claimDrop: async (dropId: string) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('claim_drop', {
          p_game_id: gameId,
          p_drop_id: dropId,
        });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Claim failed' };
      }
    },

    useItem: async (itemId: string) => {
      if (!supabase) return { ok: false, error: 'Database not initialized' };
      try {
        const { error } = await supabase.rpc('use_item', {
          p_game_id: gameId,
          p_item_id: itemId,
        });
        if (error) return { ok: false, error: error.message };
        await onRefresh();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Item usage failed' };
      }
    },
  };
}
