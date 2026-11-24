/**
 * NF-18 & NF-32: Pure Diagnostics & Support Constants and Validators
 */

export const APP_VERSION = '2.9.9';
export const SUPPORT_EMAIL = 'support@ghostrun.app';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.ghostrun.app';

export const FEEDBACK_CATEGORIES = ['bug', 'suggestion', 'safety', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface DiagnosticBundle {
  app_version: string;
  platform_os: string;
  platform_version: string | number;
  timestamp: string;
  is_dev: boolean;
  permissions?: {
    notifications?: boolean;
    foreground_location?: boolean;
    background_location?: boolean;
  };
}

export function getPlayStoreReviewUrl(): string {
  return PLAY_STORE_URL;
}

/**
 * Validates feedback category against approved taxonomy.
 */
export function validateFeedbackCategory(category: string): boolean {
  return FEEDBACK_CATEGORIES.includes(category as FeedbackCategory);
}

/**
 * Validates feedback message length (5 to 2000 chars, non-empty).
 */
export function validateFeedbackMessage(message: string): { valid: boolean; error?: string } {
  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'Feedback message cannot be empty.' };
  }
  const trimmed = message.trim();
  if (trimmed.length < 5) {
    return { valid: false, error: 'Feedback message must be at least 5 characters.' };
  }
  if (trimmed.length > 2000) {
    return { valid: false, error: 'Feedback message cannot exceed 2000 characters.' };
  }
  return { valid: true };
}

/**
 * Sanitizes a diagnostic bundle before transmission to guarantee no PII or GPS data leaks.
 */
export function sanitizeDiagnosticBundle(bundle: Record<string, any>): DiagnosticBundle {
  return {
    app_version: typeof bundle?.app_version === 'string' ? bundle.app_version : APP_VERSION,
    platform_os: typeof bundle?.platform_os === 'string' ? bundle.platform_os : 'unknown',
    platform_version: bundle?.platform_version ?? 'unknown',
    timestamp: typeof bundle?.timestamp === 'string' ? bundle.timestamp : new Date().toISOString(),
    is_dev: Boolean(bundle?.is_dev),
    permissions: {
      notifications: Boolean(bundle?.permissions?.notifications),
      foreground_location: Boolean(bundle?.permissions?.foreground_location),
      background_location: Boolean(bundle?.permissions?.background_location),
    },
  };
}
