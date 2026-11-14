/**
 * GhostRun — Moderation Client Integration (FL-P0)
 */

import { supabase } from './supabase';
import {
  ReportContext,
  ReportReason,
  ReportItem,
  BlockItem,
  validateReportPayload,
} from './moderationCore';

export async function blockUser(targetUserId: string): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { error } = await supabase.rpc('block_user', {
      p_target_user_id: targetUserId,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function unblockUser(targetUserId: string): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { error } = await supabase.rpc('unblock_user', {
      p_target_user_id: targetUserId,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function listMyBlocks(): Promise<BlockItem[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('list_my_blocks');
    if (error || !data) return [];
    return (data as Array<{
      blocked_user_id: string;
      display_name: string;
      handle: string | null;
      blocked_at: string;
    }>).map((item) => ({
      blockedUserId: item.blocked_user_id,
      displayName: item.display_name,
      handle: item.handle,
      blockedAt: item.blocked_at,
    }));
  } catch {
    return [];
  }
}

export async function submitReport(params: {
  reportedUserId: string;
  context: ReportContext;
  reason: ReportReason;
  details?: string;
  gameId?: string;
  messageId?: string;
}): Promise<{ success: boolean; reportId?: string; error?: string }> {
  const validation = validateReportPayload(params);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (!supabase) {
    return { success: true, reportId: 'mock-report-id' };
  }

  try {
    const { data, error } = await supabase.rpc('report_user', {
      p_reported_user_id: params.reportedUserId,
      p_context: params.context,
      p_reason: params.reason,
      p_details: params.details ?? null,
      p_game_id: params.gameId ?? null,
      p_message_id: params.messageId ?? null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, reportId: String(data) };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to submit report',
    };
  }
}

export async function getAdminReports(status?: string): Promise<ReportItem[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('get_admin_reports', {
      p_status: status ?? null,
    });
    if (error || !data) return [];
    return (data as Array<{
      id: string;
      reporter_id: string;
      reporter_name?: string;
      reporter_handle?: string;
      reported_id: string;
      reported_name?: string;
      reported_handle?: string;
      game_id?: string | null;
      message_id?: string | null;
      context: ReportContext;
      reason: ReportReason;
      details?: string | null;
      status: 'pending' | 'reviewed' | 'actioned' | 'dismissed';
      action_taken?: string | null;
      created_at: string;
    }>).map((item) => ({
      id: item.id,
      reporterId: item.reporter_id,
      reporterName: item.reporter_name,
      reporterHandle: item.reporter_handle,
      reportedId: item.reported_id,
      reportedName: item.reported_name,
      reportedHandle: item.reported_handle,
      gameId: item.game_id,
      messageId: item.message_id,
      context: item.context,
      reason: item.reason,
      details: item.details,
      status: item.status,
      actionTaken: item.action_taken,
      createdAt: item.created_at,
    }));
  } catch {
    return [];
  }
}
