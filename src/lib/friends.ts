/**
 * GhostRun — Friends Client Integration (FL-P1)
 */

import { supabase } from './supabase';
import {
  FriendProfile,
  FriendRequest,
  HostPresence,
  FriendSettings,
  SearchedOperative,
} from './friendsCore';

export async function sendFriendRequest(targetHandle: string): Promise<{
  success: boolean;
  status?: string;
  reason?: string;
  error?: string;
}> {
  if (!supabase) return { success: true, status: 'sent' };
  try {
    const { data, error } = await supabase.rpc('send_friend_request', {
      p_target_handle: targetHandle,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return data as { success: boolean; status?: string; reason?: string };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to send request',
    };
  }
}

export async function respondFriendRequest(
  requesterId: string,
  action: 'accept' | 'decline',
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: true };
  try {
    const { data, error } = await supabase.rpc('respond_friend_request', {
      p_requester_id: requesterId,
      p_action: action,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: Boolean(data?.success) };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to respond to request',
    };
  }
}

export async function removeFriend(friendId: string): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { error } = await supabase.rpc('remove_friend', {
      p_friend_id: friendId,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function listFriends(): Promise<FriendProfile[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('list_friends');
    if (error || !data) return [];
    return (data as Array<{
      user_id: string;
      display_name: string;
      handle: string | null;
      color: string;
      show_presence: boolean;
      share_echo: boolean;
      friends_since: string | null;
    }>).map((item) => ({
      userId: item.user_id,
      displayName: item.display_name,
      handle: item.handle,
      color: item.color,
      showPresence: Boolean(item.show_presence),
      shareEcho: Boolean(item.share_echo),
      friendsSince: item.friends_since,
    }));
  } catch {
    return [];
  }
}

export async function listFriendRequests(): Promise<{
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}> {
  if (!supabase) return { incoming: [], outgoing: [] };
  try {
    const { data, error } = await supabase.rpc('list_friend_requests');
    if (error || !data) return { incoming: [], outgoing: [] };
    const raw = data as {
      incoming?: Array<{
        requester_id: string;
        display_name: string;
        handle: string | null;
        color: string;
        requested_at: string;
      }>;
      outgoing?: Array<{
        target_id: string;
        display_name: string;
        handle: string | null;
        color: string;
        requested_at: string;
      }>;
    };
    return {
      incoming: (raw.incoming ?? []).map((r) => ({
        requesterId: r.requester_id,
        displayName: r.display_name,
        handle: r.handle,
        color: r.color,
        requestedAt: r.requested_at,
      })),
      outgoing: (raw.outgoing ?? []).map((r) => ({
        targetId: r.target_id,
        displayName: r.display_name,
        handle: r.handle,
        color: r.color,
        requestedAt: r.requested_at,
      })),
    };
  } catch {
    return { incoming: [], outgoing: [] };
  }
}

export async function publishHostPresence(
  gameId: string,
  modeId: string,
  playerCount: number = 1,
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('publish_presence', {
      p_game_id: gameId,
      p_mode_id: modeId,
      p_player_count: playerCount,
    });
  } catch {
    // presence is opportunistic
  }
}

export async function clearHostPresence(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('clear_presence');
  } catch {
    // presence cleanup is opportunistic
  }
}

export async function getFriendsHosting(): Promise<HostPresence[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('friends_hosting');
    if (error || !data) return [];
    return (data as Array<{
      host_id: string;
      host_name: string;
      host_handle: string | null;
      game_id: string;
      mode_id: string;
      player_count: number;
      expires_at: string;
    }>).map((h) => ({
      hostId: h.host_id,
      hostName: h.host_name,
      hostHandle: h.host_handle,
      gameId: h.game_id,
      modeId: h.mode_id,
      playerCount: h.player_count,
      expiresAt: h.expires_at,
    }));
  } catch {
    return [];
  }
}

export async function fetchFriendSettings(): Promise<FriendSettings> {
  const defaults: FriendSettings = {
    allowFriendRequests: true,
    showPresence: true,
    shareEcho: true,
  };

  if (!supabase) return defaults;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return defaults;

    const { data, error } = await supabase
      .from('profiles')
      .select('allow_friend_requests, show_presence, share_echo')
      .eq('id', user.id)
      .single();

    if (error || !data) return defaults;

    return {
      allowFriendRequests: data.allow_friend_requests !== false,
      showPresence: Boolean(data.show_presence),
      shareEcho: data.share_echo !== false,
    };
  } catch {
    return defaults;
  }
}

export async function updateFriendSettings(
  settings: FriendSettings,
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: true };
  try {
    const { data, error } = await supabase.rpc('set_friend_settings', {
      p_allow_requests: settings.allowFriendRequests,
      p_show_presence: settings.showPresence,
      p_share_echo: settings.shareEcho,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update settings',
    };
  }
}

export async function searchOperatives(query: string): Promise<SearchedOperative[]> {
  if (!supabase) return [];
  const clean = query.trim();
  if (!clean) return [];

  try {
    const { data, error } = await supabase.rpc('search_operatives', {
      p_query: clean,
    });
    if (error || !data) return [];
    return (data as Array<{
      id: string;
      display_name: string;
      handle: string | null;
      color: string;
      relationship: 'friend' | 'pending_outgoing' | 'pending_incoming' | 'none';
    }>).map((item) => ({
      id: item.id,
      displayName: item.display_name,
      handle: item.handle,
      color: item.color,
      relationship: item.relationship,
    }));
  } catch {
    return [];
  }
}
