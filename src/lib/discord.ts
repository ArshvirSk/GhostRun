/**
 * NF-22: Discord Dispatcher Module
 */

import {
  DiscordWebhookPayload,
  validateDiscordWebhookUrl,
  buildMatchCreationDiscordPayload,
  buildMatchRecapDiscordPayload,
  buildTestTransmissionDiscordPayload,
} from './discordCore';

export * from './discordCore';

/**
 * Dispatches a payload to a Discord incoming webhook
 */
export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: DiscordWebhookPayload
): Promise<{ success: boolean; error?: string }> {
  if (!validateDiscordWebhookUrl(webhookUrl)) {
    return { success: false, error: 'Invalid Discord webhook URL format' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Discord returned error status');
      return { success: false, error: `Discord error (${response.status}): ${errText}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error delivering Discord webhook' };
  }
}

/**
 * Transmits a verification test embed to a Discord webhook URL
 */
export async function testDiscordWebhookTransmission(
  webhookUrl: string,
  hostName: string
): Promise<{ success: boolean; error?: string }> {
  const payload = buildTestTransmissionDiscordPayload({ hostName });
  return sendDiscordWebhook(webhookUrl, payload);
}
