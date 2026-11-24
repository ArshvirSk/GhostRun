import assert from 'node:assert';
import {
  validateDiscordWebhookUrl,
  sanitizeDiscordEmbedString,
  buildMatchCreationDiscordPayload,
  buildMatchRecapDiscordPayload,
  buildEmergencySosDiscordPayload,
  buildScheduledGameDiscordPayload,
  buildTestTransmissionDiscordPayload,
  DISCORD_COLORS,
} from '../src/lib/discordCore';

console.log('--- Testing NF-22: Discord Integration Engine ---');

// Test 1: validateDiscordWebhookUrl
{
  const validUrl = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_1234567890';
  assert.strictEqual(validateDiscordWebhookUrl(validUrl), true, 'Valid Discord webhook URL must pass');

  const canaryUrl = 'https://canary.discord.com/api/webhooks/9876543210/some-token-here';
  assert.strictEqual(validateDiscordWebhookUrl(canaryUrl), true, 'Canary Discord webhook URL must pass');

  assert.strictEqual(validateDiscordWebhookUrl('https://evil-site.com/api/webhooks/123/abc'), false, 'Non-Discord URL must fail');
  assert.strictEqual(validateDiscordWebhookUrl('https://discord.com/api/other/123'), false, 'Non-webhook path must fail');
  assert.strictEqual(validateDiscordWebhookUrl(''), false, 'Empty URL must fail');
  console.log('✓ Test 1: validateDiscordWebhookUrl strictly accepts authentic Discord endpoints');
}

// Test 2: sanitizeDiscordEmbedString
{
  assert.strictEqual(sanitizeDiscordEmbedString('  Clean String  '), 'Clean String');
  assert.strictEqual(sanitizeDiscordEmbedString('A'.repeat(300), 50).length, 50);
  assert.strictEqual(sanitizeDiscordEmbedString(null as any), '');
  console.log('✓ Test 2: sanitizeDiscordEmbedString trims and truncates safely');
}

// Test 3: buildMatchCreationDiscordPayload
{
  const payload = buildMatchCreationDiscordPayload({
    code: 'WXYZ',
    modeName: 'Classic Chase',
    hostName: 'Viper',
    areaName: 'Sunset Park Plaza',
  });

  assert.strictEqual(payload.username, 'GhostRun Radar Command');
  assert.ok(payload.embeds && payload.embeds.length === 1);
  const embed = payload.embeds[0];
  assert.strictEqual(embed.color, DISCORD_COLORS.primaryLime);
  assert.ok(embed.title.includes('GhostRun Operation Mobilized'));
  assert.ok(embed.description?.includes('WXYZ'));

  const codeField = embed.fields?.find((f) => f.name === 'Operation Code');
  assert.strictEqual(codeField?.value, '`WXYZ`');

  const areaField = embed.fields?.find((f) => f.name === 'Rendezvous Area');
  assert.strictEqual(areaField?.value, 'Sunset Park Plaza');

  // Verify privacy
  const rawString = JSON.stringify(payload);
  assert.ok(!rawString.includes('latitude'));
  assert.ok(!rawString.includes('longitude'));
  console.log('✓ Test 3: buildMatchCreationDiscordPayload generates valid match creation embed with privacy');
}

// Test 4: buildMatchRecapDiscordPayload - Runner Win
{
  const payload = buildMatchRecapDiscordPayload({
    code: 'WXYZ',
    modeName: 'Tag Hunt',
    winner: 'runners',
    durationSeconds: 745,
    totalDistanceMeters: 4200,
    topSpeedKmh: 21.6,
  });

  const embed = payload.embeds![0];
  assert.strictEqual(embed.color, DISCORD_COLORS.primaryLime);
  assert.ok(embed.title.includes('Operation WXYZ'));
  assert.ok(embed.description?.includes('evaded hunter radar'));

  const durationField = embed.fields?.find((f) => f.name === 'Duration');
  assert.strictEqual(durationField?.value, '12m 25s');

  const coverageField = embed.fields?.find((f) => f.name === 'Patrol Coverage');
  assert.strictEqual(coverageField?.value, '4.2 km');

  console.log('✓ Test 4: buildMatchRecapDiscordPayload formats runner victory recap accurately');
}

// Test 5: buildMatchRecapDiscordPayload - Hunter Win
{
  const payload = buildMatchRecapDiscordPayload({
    code: 'ALPHA',
    modeName: 'Jailbreak',
    winner: 'hunters',
    durationSeconds: 480,
  });

  const embed = payload.embeds![0];
  assert.strictEqual(embed.color, DISCORD_COLORS.hunterCoral);
  assert.ok(embed.description?.includes('All runners were intercepted'));
  console.log('✓ Test 5: buildMatchRecapDiscordPayload formats hunter victory with coral theme');
}

// Test 6: buildEmergencySosDiscordPayload
{
  const sos = buildEmergencySosDiscordPayload({
    code: 'BETA',
    hostName: 'Viper',
    playerName: 'GhostRunner9',
    modeName: 'Territory Pulse',
  });
  assert.strictEqual(sos.embeds![0].color, DISCORD_COLORS.statusDanger);
  assert.ok(sos.content?.includes('@here'));
  assert.ok(sos.embeds![0].title.includes('EMERGENCY SOS'));
  assert.ok(sos.embeds![0].description?.includes('GhostRunner9'));
  console.log('✓ Test 6: buildEmergencySosDiscordPayload formats high-priority distress alert');
}

// Test 7: buildScheduledGameDiscordPayload
{
  const scheduled = buildScheduledGameDiscordPayload({
    code: 'DELTA',
    modeName: 'Relay Heist',
    startsInMinutes: 15,
    hostName: 'Viper',
    areaName: 'Downtown Waterfront',
  });
  assert.strictEqual(scheduled.embeds![0].color, DISCORD_COLORS.warningAmber);
  assert.ok(scheduled.embeds![0].title.includes('15m'));
  const countdownField = scheduled.embeds![0].fields?.find((f) => f.name === 'Countdown');
  assert.strictEqual(countdownField?.value, 'T-15 Minutes');
  console.log('✓ Test 7: buildScheduledGameDiscordPayload formats upcoming reminder embed');
}

// Test 8: buildTestTransmissionDiscordPayload
{
  const testPayload = buildTestTransmissionDiscordPayload({
    hostName: 'GhostLead',
  });
  assert.strictEqual(testPayload.username, 'GhostRun Squad Comms');
  assert.ok(testPayload.embeds && testPayload.embeds.length === 1);
  const embed = testPayload.embeds[0];
  assert.strictEqual(embed.color, DISCORD_COLORS.primaryLime);
  assert.ok(embed.title.includes('GHOSTRUN TACTICAL TRANSMISSION TEST'));
  assert.ok(embed.description?.includes('GhostLead'));
  console.log('✓ Test 8: buildTestTransmissionDiscordPayload produces verified test transmission embed');
}

console.log('\nAll 8 NF-22 Discord integration tests passed successfully!\n');
