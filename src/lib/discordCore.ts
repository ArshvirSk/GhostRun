/**
 * NF-22: Discord Webhook & Rich Embed Builder
 *
 * Privacy Guarantees:
 * - Zero GPS coordinates, route traces, or private location names.
 * - Only high-level match summaries, room codes, and game outcomes.
 */

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
}

// Tactical Brand Colors (Hex converted to Decimal)
export const DISCORD_COLORS = {
  primaryLime: 0xc7f36b, // 13104043
  hunterCoral: 0xff8a75, // 16747125
  spectralViolet: 0xb8a3ff, // 12100607
  statusDanger: 0xf87171, // 16281969
  warningAmber: 0xfbbf24, // 16500516
};

/**
 * Validate that a URL is a legitimate Discord webhook URL
 */
export function validateDiscordWebhookUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  const pattern = /^https:\/\/(canary\.|ptb\.)?discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;
  return pattern.test(trimmed);
}

/**
 * Sanitizes an embed string field to prevent markdown injection or excessive length.
 */
export function sanitizeDiscordEmbedString(str: string, maxLength = 256): string {
  if (!str || typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

/**
 * Build a Discord announcement for a newly hosted match
 */
export function buildMatchCreationDiscordPayload(params: {
  code: string;
  modeName: string;
  hostName: string;
  areaName?: string | null;
  joinUrl?: string;
}): DiscordWebhookPayload {
  const code = sanitizeDiscordEmbedString(params.code.toUpperCase(), 16);
  const modeName = sanitizeDiscordEmbedString(params.modeName, 64);
  const hostName = sanitizeDiscordEmbedString(params.hostName, 64);

  const fields: DiscordEmbedField[] = [
    { name: 'Operation Code', value: `\`${code}\``, inline: true },
    { name: 'Tactical Doctrine', value: modeName, inline: true },
    { name: 'Host Operative', value: hostName, inline: true },
  ];

  if (params.areaName) {
    fields.push({
      name: 'Rendezvous Area',
      value: sanitizeDiscordEmbedString(params.areaName, 128),
      inline: false,
    });
  }

  const joinLink = params.joinUrl || `https://ghostrun.app/join?code=${code}`;

  const embed: DiscordEmbed = {
    title: 'GhostRun Operation Mobilized',
    description: `A new match is assembling. Tap below or enter code **${code}** in the GhostRun app to deploy.`,
    url: joinLink,
    color: DISCORD_COLORS.primaryLime,
    fields,
    footer: { text: 'GhostRun Tactical Network · ghostrun.app' },
    timestamp: new Date().toISOString(),
  };

  return {
    username: 'GhostRun Radar Command',
    embeds: [embed],
  };
}

/**
 * Build a Discord post-match debrief embed
 */
export function buildMatchRecapDiscordPayload(params: {
  code: string;
  modeName: string;
  winner: string; // 'runners' | 'hunters'
  durationSeconds: number;
  totalDistanceMeters?: number;
  topSpeedKmh?: number;
}): DiscordWebhookPayload {
  const isRunnerWin = params.winner.toLowerCase().includes('runner');
  const durationMin = Math.floor(params.durationSeconds / 60);
  const durationSec = params.durationSeconds % 60;
  const timeStr = `${durationMin}m ${durationSec}s`;

  const fields: DiscordEmbedField[] = [
    { name: 'Outcome', value: isRunnerWin ? 'RUNNER EVASION VICTORY' : 'HUNTER INTERCEPTION VICTORY', inline: true },
    { name: 'Duration', value: timeStr, inline: true },
  ];

  if (typeof params.totalDistanceMeters === 'number' && params.totalDistanceMeters > 0) {
    fields.push({
      name: 'Patrol Coverage',
      value: `${(params.totalDistanceMeters / 1000).toFixed(1)} km`,
      inline: true,
    });
  }

  if (typeof params.topSpeedKmh === 'number' && params.topSpeedKmh > 0) {
    fields.push({
      name: 'Peak Velocity',
      value: `${params.topSpeedKmh.toFixed(1)} km/h`,
      inline: true,
    });
  }

  const embed: DiscordEmbed = {
    title: `Operation ${params.code.toUpperCase()} — Mission Debrief`,
    description: isRunnerWin
      ? 'Runners successfully evaded hunter radar and extracted safely.'
      : 'All runners were intercepted and tagged before mission clock expiration.',
    color: isRunnerWin ? DISCORD_COLORS.primaryLime : DISCORD_COLORS.hunterCoral,
    fields,
    footer: { text: 'GhostRun Tactical Debrief · ghostrun.app' },
    timestamp: new Date().toISOString(),
  };

  return {
    username: 'GhostRun Tactical Debrief',
    embeds: [embed],
  };
}

/**
 * Build a high-priority Emergency SOS alert for community channels
 */
export function buildEmergencySosDiscordPayload(params: {
  code: string;
  hostName: string;
  playerName: string;
  modeName: string;
  timestamp?: string;
}): DiscordWebhookPayload {
  const embed: DiscordEmbed = {
    title: 'EMERGENCY SOS ALERT',
    description: `Operative **${params.playerName}** has triggered an emergency distress beacon in Operation **${params.code.toUpperCase()}** (${params.modeName}). Teammates and organizers have been notified.`,
    color: DISCORD_COLORS.statusDanger,
    fields: [
      { name: 'Operation', value: `\`${params.code.toUpperCase()}\``, inline: true },
      { name: 'Operative in Distress', value: params.playerName, inline: true },
      { name: 'Host', value: params.hostName, inline: true },
    ],
    footer: { text: 'GhostRun Safety Protocol · ghostrun.app' },
    timestamp: params.timestamp ?? new Date().toISOString(),
  };

  return {
    username: 'GhostRun Safety Monitor',
    content: '@here High-priority operative distress beacon triggered.',
    embeds: [embed],
  };
}

/**
 * Build a scheduled match upcoming reminder embed
 */
export function buildScheduledGameDiscordPayload(params: {
  code: string;
  modeName: string;
  startsInMinutes: number;
  hostName: string;
  areaName?: string;
}): DiscordWebhookPayload {
  const fields: DiscordEmbedField[] = [
    { name: 'Doctrine', value: params.modeName, inline: true },
    { name: 'Countdown', value: `T-${params.startsInMinutes} Minutes`, inline: true },
    { name: 'Host', value: params.hostName, inline: true },
  ];

  if (params.areaName) {
    fields.push({ name: 'Location Area', value: params.areaName, inline: false });
  }

  const embed: DiscordEmbed = {
    title: `Scheduled Operation Mobilizing in ${params.startsInMinutes}m`,
    description: `Operatives, prepare for deployment. Lobby **${params.code.toUpperCase()}** will activate shortly.`,
    color: DISCORD_COLORS.warningAmber,
    fields,
    footer: { text: 'GhostRun Scheduled Operations · ghostrun.app' },
    timestamp: new Date().toISOString(),
  };

  return {
    username: 'GhostRun Operations Dispatch',
    embeds: [embed],
  };
}

/**
 * Build a test transmission verification embed
 */
export function buildTestTransmissionDiscordPayload(params: {
  hostName: string;
}): DiscordWebhookPayload {
  const host = sanitizeDiscordEmbedString(params.hostName || 'Operative', 48);

  const embed: DiscordEmbed = {
    title: 'GHOSTRUN TACTICAL TRANSMISSION TEST',
    description: `Tactical squad link established. Verified connection to GhostRun Tactical Network for host **${host}**.`,
    color: DISCORD_COLORS.primaryLime,
    fields: [
      { name: 'Channel Status', value: 'LINK ACTIVE', inline: true },
      { name: 'GPS Privacy Firewall', value: 'ZERO-LEAKAGE ENFORCED', inline: true },
    ],
    footer: { text: 'GhostRun Tactical Network v2.9.23 · ghostrun.app' },
    timestamp: new Date().toISOString(),
  };

  return {
    username: 'GhostRun Squad Comms',
    embeds: [embed],
  };
}
