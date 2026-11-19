import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/tokens';
import { sanitizeCodename, codenameToHandle, sanitizeTagline } from '../lib/codename';

export const USER_PROFILE_KEY = '@ghostrun:profile';

export interface UserProfile {
  id: string;
  display_name: string;
  tagline?: string | null;
  handle?: string | null;
  color: string;
  profile_visibility?: 'public' | 'private';
  email?: string;
  created_at?: string;
  is_vanguard?: boolean;
  is_cipher?: boolean;
}

interface UserStoreState {
  profile: UserProfile | null;
  isHydrated: boolean;
  setProfile: (profile: Partial<UserProfile> & { display_name: string }) => void;
  clearProfile: () => void;
  syncWithServer: (userId?: string) => Promise<UserProfile | null>;
}

export const useUserStore = create<UserStoreState>((set, get) => ({
  profile: null,
  isHydrated: false,

  setProfile: (updated) => {
    const current = get().profile;
    const isCipher =
      updated.is_cipher !== undefined
        ? updated.is_cipher
        : updated.is_vanguard !== undefined
        ? updated.is_vanguard
        : current?.is_cipher ?? current?.is_vanguard;

    const cleanName = sanitizeCodename(updated.display_name || current?.display_name || 'OPERATIVE');
    const cleanTag = updated.tagline !== undefined ? (sanitizeTagline(updated.tagline) || null) : (current?.tagline || null);
    const cleanHandle = updated.handle !== undefined ? updated.handle : (current?.handle || codenameToHandle(cleanName));

    const merged: UserProfile = {
      id: updated.id || current?.id || 'local_user',
      display_name: cleanName,
      tagline: cleanTag,
      handle: cleanHandle,
      color: updated.color || current?.color || colors.palette[0],
      profile_visibility:
        updated.profile_visibility !== undefined
          ? updated.profile_visibility
          : current?.profile_visibility ?? 'public',
      email: updated.email || current?.email,
      created_at: updated.created_at || current?.created_at,
      is_vanguard: isCipher,
      is_cipher: isCipher,
    };

    set({ profile: merged, isHydrated: true });

    // Persist immediately in background
    void AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(merged));
  },

  clearProfile: () => {
    set({ profile: null, isHydrated: true });
    void AsyncStorage.removeItem(USER_PROFILE_KEY);
  },

  syncWithServer: async (providedUserId?: string) => {
    if (!supabase) return get().profile;

    try {
      let uid = providedUserId;
      if (!uid) {
        const { data: authData } = await supabase.auth.getUser();
        uid = authData?.user?.id;
      }
      if (!uid) return get().profile;

      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, tagline, handle, color, profile_visibility, created_at')
        .eq('id', uid)
        .maybeSingle();

      if (error || !data) return get().profile;

      const cleanName = sanitizeCodename(data.display_name || get().profile?.display_name || 'OPERATIVE');
      const synced: UserProfile = {
        id: data.id,
        display_name: cleanName,
        tagline: data.tagline ?? get().profile?.tagline ?? null,
        handle: data.handle ?? get().profile?.handle ?? codenameToHandle(cleanName),
        color: data.color || get().profile?.color || colors.palette[0],
        profile_visibility: (data.profile_visibility as 'public' | 'private') || 'public',
        created_at: data.created_at,
      };

      set({ profile: synced, isHydrated: true });
      void AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(synced));
      return synced;
    } catch {
      return get().profile;
    }
  },
}));

// Eager boot-time hydration from AsyncStorage
AsyncStorage.getItem(USER_PROFILE_KEY)
  .then((raw) => {
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.display_name === 'string') {
          const cleanName = sanitizeCodename(parsed.display_name);
          useUserStore.setState({
            profile: {
              id: parsed.id || 'local_user',
              display_name: cleanName,
              tagline: parsed.tagline ?? null,
              handle: parsed.handle ?? codenameToHandle(cleanName),
              color: parsed.color || colors.palette[0],
              email: parsed.email,
              created_at: parsed.created_at,
              is_vanguard: parsed.is_cipher ?? parsed.is_vanguard,
              is_cipher: parsed.is_cipher ?? parsed.is_vanguard,
            },
            isHydrated: true,
          });
        }
      } catch {}
    } else {
      useUserStore.setState({ isHydrated: true });
    }
  })
  .catch(() => {
    useUserStore.setState({ isHydrated: true });
  });
