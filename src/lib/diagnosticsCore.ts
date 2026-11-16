/**
 * NF-18 & NF-32: Pure Diagnostics & Support Constants
 */

export const APP_VERSION = '2.9.5';
export const SUPPORT_EMAIL = 'support@ghostrun.app';
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.ghostrun.app';

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
