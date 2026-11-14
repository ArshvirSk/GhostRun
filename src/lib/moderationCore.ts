/**
 * GhostRun — Moderation Core Logic (FL-P0)
 *
 * Types, reason descriptions, and digest formatting for reporting,
 * blocking, and operator review.
 */

export type ReportContext = 'lobby' | 'friends' | 'board' | 'radio' | 'other';

export type ReportReason =
  | 'harassment'
  | 'inappropriate_name'
  | 'cheating'
  | 'unsafe_behaviour'
  | 'other';

export interface ReportItem {
  id: string;
  reporterId: string;
  reporterName?: string;
  reporterHandle?: string;
  reportedId: string;
  reportedName?: string;
  reportedHandle?: string;
  gameId?: string | null;
  messageId?: string | null;
  context: ReportContext;
  reason: ReportReason;
  details?: string | null;
  status: 'pending' | 'reviewed' | 'actioned' | 'dismissed';
  actionTaken?: string | null;
  createdAt: string;
}

export interface BlockItem {
  blockedUserId: string;
  displayName: string;
  handle?: string | null;
  blockedAt: string;
}

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: 'Harassment or Abusive Behavior',
  inappropriate_name: 'Inappropriate Name or Handle',
  cheating: 'Cheating / Mock Location',
  unsafe_behaviour: 'Unsafe Physical Behavior',
  other: 'Other Violation',
};

/**
 * Validates report submission payload.
 */
export function validateReportPayload(payload: {
  reportedUserId: string;
  context: string;
  reason: string;
  details?: string;
}): { valid: boolean; error?: string } {
  if (!payload.reportedUserId) {
    return { valid: false, error: 'Target user ID is required' };
  }

  const validContexts: ReportContext[] = ['lobby', 'friends', 'board', 'radio', 'other'];
  if (!validContexts.includes(payload.context as ReportContext)) {
    return { valid: false, error: 'Invalid report context' };
  }

  const validReasons: ReportReason[] = [
    'harassment',
    'inappropriate_name',
    'cheating',
    'unsafe_behaviour',
    'other',
  ];
  if (!validReasons.includes(payload.reason as ReportReason)) {
    return { valid: false, error: 'Invalid report reason' };
  }

  if (payload.details && payload.details.length > 200) {
    return { valid: false, error: 'Report details exceed 200 characters limit' };
  }

  return { valid: true };
}

/**
 * Checks whether an interaction with another user is permitted given the blocklist.
 */
export function isUserBlocked(targetUserId: string, blocklist: BlockItem[]): boolean {
  return blocklist.some((b) => b.blockedUserId === targetUserId);
}

/**
 * Compiles a text daily moderation digest for the operator.
 */
export function generateModerationDigest(
  reports: ReportItem[],
  dateStr: string = new Date().toISOString().slice(0, 10),
): string {
  const pending = reports.filter((r) => r.status === 'pending');
  const lines: string[] = [
    `=== GHOSTRUN DAILY MODERATION DIGEST (${dateStr}) ===`,
    `Total Reports: ${reports.length}`,
    `Pending Action: ${pending.length}`,
    '',
  ];

  if (pending.length === 0) {
    lines.push('No pending reports. Community queue is clean.');
    return lines.join('\n');
  }

  pending.forEach((r, idx) => {
    lines.push(`[Report #${idx + 1}] Context: ${r.context} | Reason: ${r.reason}`);
    lines.push(`  Reported: ${r.reportedHandle ? '@' + r.reportedHandle : r.reportedName || r.reportedId}`);
    lines.push(`  Reporter: ${r.reporterHandle ? '@' + r.reporterHandle : r.reporterName || r.reporterId}`);
    if (r.details) {
      lines.push(`  Note: "${r.details}"`);
    }
    if (r.gameId) {
      lines.push(`  Game: ${r.gameId}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}
