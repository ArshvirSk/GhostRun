import { Platform } from 'react-native';
import {
  APP_VERSION,
  SUPPORT_EMAIL,
  DiagnosticBundle,
} from './diagnosticsCore';

export * from './diagnosticsCore';

/**
 * Builds a diagnostic payload with zero coordinates or personal data.
 */
export function buildDiagnosticBundle(
  permissions?: DiagnosticBundle['permissions']
): DiagnosticBundle {
  return {
    app_version: APP_VERSION,
    platform_os: Platform.OS,
    platform_version: Platform.Version,
    timestamp: new Date().toISOString(),
    is_dev: typeof __DEV__ !== 'undefined' ? __DEV__ : false,
    permissions: permissions || {},
  };
}

/**
 * Formats a support email intent URL with prefilled technical diagnostics.
 */
export function formatSupportEmailUrl(
  subject = 'GhostRun Technical Support',
  userMessage = ''
): string {
  const osInfo = `${Platform.OS} ${Platform.Version}`;
  const body = [
    userMessage,
    '',
    '--- System Diagnostics ---',
    `App Version: ${APP_VERSION}`,
    `Platform: ${osInfo}`,
    `Timestamp: ${new Date().toISOString()}`,
    '--------------------------',
  ].join('\n');

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
