/**
 * NF-16: Persistent Crews & Squad Lists Client Module
 */

import { Share } from 'react-native';
import { supabase } from './supabase';
import {
  Crew,
  CrewMember,
  validateCrewName,
  validateCrewCode,
  normalizeCrewCode,
  formatCrewInviteText,
} from './crewsCore';

export * from './crewsCore';

/**
 * Creates a persistent crew with the caller as captain
 */
export async function createCrewOnServer(
  name: string,
  customCode?: string
): Promise<{ success: boolean; crewId?: string; error?: string }> {
  const nameVal = validateCrewName(name);
  if (!nameVal.valid) return { success: false, error: nameVal.error };

  if (customCode) {
    const codeVal = validateCrewCode(customCode);
    if (!codeVal.valid) return { success: false, error: codeVal.error };
  }

  if (!supabase) return { success: false, error: 'Database unconfigured' };

  try {
    const { data, error } = await supabase.rpc('create_crew', {
      p_name: name.trim(),
      p_code: customCode ? normalizeCrewCode(customCode) : null,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, crewId: data as string };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to create crew' };
  }
}

/**
 * Joins an existing crew using a unique join code
 */
export async function joinCrewOnServer(
  code: string
): Promise<{ success: boolean; crewId?: string; error?: string }> {
  const cleanCode = normalizeCrewCode(code);
  const codeVal = validateCrewCode(cleanCode);
  if (!codeVal.valid) return { success: false, error: codeVal.error };

  if (!supabase) return { success: false, error: 'Database unconfigured' };

  try {
    const { data, error } = await supabase.rpc('join_crew', {
      p_code: cleanCode,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, crewId: data as string };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to join crew' };
  }
}

/**
 * Leaves or disbands a crew
 */
export async function leaveCrewOnServer(
  crewId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database unconfigured' };

  try {
    const { error } = await supabase.rpc('leave_crew', {
      p_crew_id: crewId,
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to leave crew' };
  }
}

/**
 * Fetches all crews the authenticated user belongs to
 */
export async function fetchMyCrews(): Promise<{
  success: boolean;
  crews: Crew[];
  error?: string;
}> {
  if (!supabase) return { success: false, crews: [], error: 'Database unconfigured' };

  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) return { success: false, crews: [], error: 'Not authenticated' };

    const { data, error } = await supabase
      .from('crew_members')
      .select('role, crews(id, name, code, created_by, created_at)')
      .eq('user_id', authData.user.id);

    if (error) return { success: false, crews: [], error: error.message };

    const crews: Crew[] = (data || []).map((row: any) => ({
      id: row.crews.id,
      name: row.crews.name,
      code: row.crews.code,
      created_by: row.crews.created_by,
      created_at: row.crews.created_at,
      my_role: row.role as 'captain' | 'member',
    }));

    return { success: true, crews };
  } catch (err: any) {
    return { success: false, crews: [], error: err.message || 'Failed to fetch crews' };
  }
}

/**
 * Fetches members belonging to a crew
 */
export async function fetchCrewMembers(
  crewId: string
): Promise<{ success: boolean; members: CrewMember[]; error?: string }> {
  if (!supabase) return { success: false, members: [], error: 'Database unconfigured' };

  try {
    const { data, error } = await supabase
      .from('crew_members')
      .select('crew_id, user_id, role, joined_at, profiles(display_name)')
      .eq('crew_id', crewId)
      .order('joined_at', { ascending: true });

    if (error) return { success: false, members: [], error: error.message };

    const members: CrewMember[] = (data || []).map((row: any) => ({
      crew_id: row.crew_id,
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
      display_name: row.profiles?.display_name || 'Operative',
    }));

    return { success: true, members };
  } catch (err: any) {
    return { success: false, members: [], error: err.message || 'Failed to fetch members' };
  }
}

/**
 * Shares a crew invite link / code via native OS share sheet
 */
export async function shareCrewInvite(crew: Crew): Promise<{ success: boolean }> {
  try {
    const message = formatCrewInviteText(crew.name, crew.code);
    await Share.share({
      title: `GhostRun Crew: ${crew.name}`,
      message,
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}
