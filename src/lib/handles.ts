/**
 * GhostRun — Handles Client Integration (FL-P0)
 */

import { supabase } from './supabase';
import { validateHandle } from './handlesCore';

export interface HandleCheckResponse {
  available: boolean;
  normalized?: string;
  reason?: string;
}

export async function checkHandleAvailability(handle: string): Promise<HandleCheckResponse> {
  const localCheck = validateHandle(handle);
  if (!localCheck.valid) {
    return {
      available: false,
      reason: localCheck.error,
    };
  }

  if (!supabase) {
    return { available: true, normalized: localCheck.normalized };
  }

  try {
    const { data, error } = await supabase.rpc('check_handle', {
      p_handle: localCheck.normalized,
    });
    if (error) {
      return { available: false, reason: error.message };
    }
    return data as HandleCheckResponse;
  } catch (err: unknown) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : 'Network error checking handle',
    };
  }
}

export async function claimHandle(handle: string): Promise<{ success: boolean; error?: string }> {
  const localCheck = validateHandle(handle);
  if (!localCheck.valid) {
    return { success: false, error: localCheck.error };
  }

  if (!supabase) {
    return { success: true };
  }

  try {
    const { data, error } = await supabase.rpc('claim_handle', {
      p_handle: localCheck.normalized,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: Boolean(data?.success) };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to claim handle',
    };
  }
}

export async function getMyHandle(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('get_my_handle');
    if (error || !data) return null;
    return String(data);
  } catch {
    return null;
  }
}
