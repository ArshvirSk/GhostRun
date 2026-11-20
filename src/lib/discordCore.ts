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
 * Build a Discord announcement for a newly hosted match
 */
export function buildMatchCreationDiscordPayload(params: {
  code: string;
  modeName: string;
  hostName: string;
  areaName?: string | null;
  joinUrl?: string;
}): DiscordWebhookPayload {
  const fields: DiscordEmbedField[] = [
    { name: 'Operation Code', value: `\`${params.code.toUpperCase()}\``, inline: true },
    { name: 'Tactical Doctrine', value: params.modeName, inline: true },
    { name: 'Host Operative', value: params.hostName, inline: true },
  ];

  if (params.areaName) {
    fields.push({ name: 'Rendezvous Area', value: params.areaName, inline: false });
  }

  const joinLink = params.joinUrl || `https://ghostrun.app/join?code=${params.code.toUpperCase()}`;

  const embed: DiscordEmbed = {
    title: 'GhostRun Operation Mobilized',
    description: `A new match is assembling. Tap below or enter code **${params.code.toUpperCase()}** in the GhostRun app to deploy.`,
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
  const durationSec = Math.floor(params.durationSeconds % 60);
  const durationStr = `${durationMin}m ${durationSec}s`;

  const fields: DiscordEmbedField[] = [
    { name: 'Mode', value: params.modeName, inline: true },
    { name: 'Duration', value: durationStr, inline: true },
    { name: 'Victorious Unit', value: isRunnerWin ? 'RUNNERS (Evaded)' : 'HUNTERS (Intercepted)', inline: true },
  ];

  if (params.totalDistanceMeters) {
    const km = (params.totalDistanceMeters / 1000).toFixed(1);
    fields.push({ name: 'Patrol Coverage', value: `${km} km`, inline: true });
  }

  if (params.topSpeedKmh) {
    fields.push({ name: 'Top Sprint', value: `${params.topSpeedKmh} km/h`, inline: true });
  }

  const embed: DiscordEmbed = {
    title: `Debrief: Operation ${params.code.toUpperCase()}`,
    description: `Mission completed. ${isRunnerWin ? 'The ghosts evaded hunter radar.' : 'All runners were intercepted.'}`,
    color: isRunnerWin ? DISCORD_COLORS.primaryLime : DISCORD_COLORS.hunterCoral,
    fields,
    footer: { text: 'GhostRun Tactical Network' },
    timestamp: new Date().toISOString(),
  };

  return {
    username: 'GhostRun Radar Command',
    embeds: [embed],
  };
}
