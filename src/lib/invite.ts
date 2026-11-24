/**
 * NF-02 & NF-19 Minimal: Tactical Invite & Deep-Linking Utilities
 *
 * Generates formatted invitation payloads for system share sheets,
 * builds deep links (ghost-run://) and web fallback links (https://ghostrun.app),
 * parses invite URLs/codes, and generates App Links verification & fallback HTML.
 */

export const DEFAULT_INVITE_DOMAIN = 'https://ghostrun.app';
export const DEFAULT_CUSTOM_SCHEME = 'ghost-run';
export const ALTERNATE_CUSTOM_SCHEME = 'ghostrun';
export const LOBBY_CODE_LENGTH = 4;

export interface QrInvitePayload {
  type: 'ghostrun_invite';
  code: string;
  mode?: string;
  url: string;
}

export interface BuildInviteOptions {
  code: string;
  modeId?: string;
  modeName?: string;
  playerCount?: number;
  baseUrl?: string;
  scheme?: string;
}

export interface InvitePayload {
  code: string;
  title: string;
  message: string;
  url: string;
  deepLink: string;
  webLink: string;
  modeName: string;
}

export interface ParsedInvite {
  code: string | null;
  isValid: boolean;
  source: 'code' | 'deepLink' | 'webLink' | 'unknown';
}

/**
 * Builds a JSON QR code payload for host screen display or physical invite cards.
 */
export function buildQrPayload(options: BuildInviteOptions): string {
  const payload = buildInvitePayload(options);
  const data: QrInvitePayload = {
    type: 'ghostrun_invite',
    code: payload.code,
    mode: payload.modeName,
    url: payload.webLink,
  };
  return JSON.stringify(data);
}

/**
 * Normalizes a room code to uppercase alphanumeric string of length 4.
 */
export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, LOBBY_CODE_LENGTH);
}

/**
 * Builds formatted invite payloads for React Native Share.share or clipboard.
 */
export function buildInvitePayload(options: BuildInviteOptions): InvitePayload {
  const code = normalizeRoomCode(options.code);
  const modeName = options.modeName || 'Classic Chase';
  const baseUrl = (options.baseUrl || DEFAULT_INVITE_DOMAIN).replace(/\/+$/, '');
  const scheme = options.scheme || DEFAULT_CUSTOM_SCHEME;

  const deepLink = `${scheme}://join?code=${code}`;
  const webLink = `${baseUrl}/join/${code}`;
  const title = `GhostRun: Join ${modeName}`;

  const message = [
    `GhostRun Match Invite: ${modeName}`,
    `Lobby Code: ${code}`,
    '',
    `Tap to join match:`,
    deepLink,
    '',
    `Need the app? Open link:`,
    webLink,
  ].join('\n');

  return {
    code,
    title,
    message,
    url: webLink,
    deepLink,
    webLink,
    modeName,
  };
}

/**
 * Parses user input (code, deep link, web URL, or JSON QR code) to extract a valid 4-character lobby code.
 */
export function parseInviteUrl(input: string): ParsedInvite {
  if (!input || typeof input !== 'string') {
    return { code: null, isValid: false, source: 'unknown' };
  }

  const trimmed = input.trim();

  // 1. Direct 4-character code (e.g. "ABCD", "w9k2")
  const directMatch = trimmed.match(/^[A-Za-z0-9]{4}$/);
  if (directMatch) {
    return {
      code: directMatch[0].toUpperCase(),
      isValid: true,
      source: 'code',
    };
  }

  // 2. Structured JSON QR payload (e.g. {"code":"ABCD"} or {"type":"ghostrun_invite","code":"ABCD"})
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsedJson = JSON.parse(trimmed);
      const candidate = parsedJson.code || parsedJson.lobby || parsedJson.room;
      if (candidate && typeof candidate === 'string') {
        const cleanCode = candidate.trim().toUpperCase().slice(0, LOBBY_CODE_LENGTH);
        if (cleanCode.length === LOBBY_CODE_LENGTH) {
          return {
            code: cleanCode,
            isValid: true,
            source: 'code',
          };
        }
      }
    } catch {
      // Non-fatal, proceed to URL matching
    }
  }

  // 3. Custom scheme deep links (ghost-run:// or ghostrun://, path or query)
  const schemePattern = /^(?:ghost-run|ghostrun):\/\/join(?:\/([A-Za-z0-9]{4}))?(?:\?.*code=([A-Za-z0-9]{4}))?/i;
  const schemeMatch = trimmed.match(schemePattern);
  if (schemeMatch) {
    const matchedCode = schemeMatch[1] || schemeMatch[2];
    if (matchedCode) {
      return {
        code: matchedCode.toUpperCase(),
        isValid: true,
        source: 'deepLink',
      };
    }
  }

  // 4. Web URLs (e.g. https://ghostrun.app/join/ABCD or https://ghostrun.app/join?code=ABCD)
  const webPathMatch = trimmed.match(/\/join\/([A-Za-z0-9]{4})(?:[?#\/]|$)/i);
  if (webPathMatch && webPathMatch[1]) {
    return {
      code: webPathMatch[1].toUpperCase(),
      isValid: true,
      source: 'webLink',
    };
  }

  const webQueryMatch = trimmed.match(/[?&]code=([A-Za-z0-9]{4})(?:[&#]|$)/i);
  if (webQueryMatch && webQueryMatch[1]) {
    return {
      code: webQueryMatch[1].toUpperCase(),
      isValid: true,
      source: 'webLink',
    };
  }

  // If none of the structured patterns match, return unknown/invalid
  return { code: null, isValid: false, source: 'unknown' };
}

/**
 * Generates Android Digital Asset Links JSON content (.well-known/assetlinks.json)
 * for verified App Links.
 */
export function generateAssetLinksJson(options?: {
  packageName?: string;
  sha256Fingerprints?: string[];
}): string {
  const packageName = options?.packageName || 'com.ghostrun.app';
  const fingerprints = options?.sha256Fingerprints || [
    '14:6D:E9:7F:C2:52:92:2E:39:69:89:12:F1:C7:E9:88:FE:84:48:FA:7E:6D:23:6C:C1:C6:1C:89:6E:FF:45:90',
  ];

  const payload = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return JSON.stringify(payload, null, 2);
}

/**
 * Generates standalone HTML for the web fallback landing page at /join/<CODE>.
 */
export function generateFallbackLandingHtml(options: {
  code: string;
  modeName?: string;
  baseUrl?: string;
  playStoreUrl?: string;
}): string {
  const code = normalizeRoomCode(options.code);
  const modeName = options.modeName || 'Classic Chase';
  const deepLink = `${DEFAULT_CUSTOM_SCHEME}://join?code=${code}`;
  const playStoreUrl =
    options.playStoreUrl ||
    'https://play.google.com/store/apps/details?id=com.ghostrun.app';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GhostRun - Join Match ${code}</title>
  <meta name="description" content="Join mission ${code} (${modeName}) in GhostRun: Real-world GPS tactical chase.">
  <meta property="og:title" content="GhostRun Mission Invite: ${modeName}">
  <meta property="og:description" content="Lobby Code: ${code}. Tap to join the tactical grid.">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="#0B0F19">
  <style>
    :root {
      --bg: #0B0F19;
      --surface: #111827;
      --surface-elevated: #1F2937;
      --primary: #10B981;
      --accent: #06B6D4;
      --text: #F9FAFB;
      --text-muted: #9CA3AF;
      --border: #374151;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body {
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
      text-align: center;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      max-width: 440px;
      width: 100%;
      padding: 32px 24px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.15);
      color: var(--primary);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
      margin-bottom: 16px;
      text-transform: uppercase;
    }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 8px; letter-spacing: -0.5px; }
    p.sub { color: var(--text-muted); font-size: 14px; margin-bottom: 24px; }
    .code-box {
      background: var(--surface-elevated);
      border: 2px solid var(--primary);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .code-label { font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 1.5px; margin-bottom: 4px; }
    .code-value { font-size: 38px; font-weight: 900; letter-spacing: 6px; color: var(--text); }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      margin-bottom: 12px;
      transition: all 0.2s ease;
    }
    .btn-primary { background: var(--primary); color: #000; }
    .btn-primary:hover { opacity: 0.9; }
    .btn-secondary { background: var(--surface-elevated); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { background: #374151; }
    .footer-note { font-size: 12px; color: var(--text-muted); margin-top: 16px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Tactical Match Invite</div>
    <h1>GhostRun</h1>
    <p class="sub">You've been deployed to join <strong>${modeName}</strong></p>

    <div class="code-box">
      <div class="code-label">Lobby Code</div>
      <div class="code-value">${code}</div>
    </div>

    <a href="${deepLink}" class="btn btn-primary" id="open-app-btn">Open in GhostRun App</a>
    <a href="${playStoreUrl}" class="btn btn-secondary">Get the App on Play Store</a>

    <div class="footer-note">
      Already have the app installed? Tap <strong>Open in GhostRun App</strong> or enter code <strong>${code}</strong> in the Join screen.
    </div>
  </div>

  <script>
    // Automatically attempt to redirect to app scheme on mobile browsers
    window.addEventListener('load', function() {
      var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        setTimeout(function() {
          window.location.href = "${deepLink}";
        }, 300);
      }
    });
  </script>
</body>
</html>`;
}
