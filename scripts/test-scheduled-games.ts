import assert from 'node:assert';
import {
  formatIcsDate,
  escapeIcsText,
  foldIcsLine,
  generateIcsCalendar,
  IcsEvent,
} from '../src/lib/icalendarCore';
import {
  validateScheduledGameInput,
  buildGameIcsContent,
  summarizeRsvps,
  ScheduledGame,
  ScheduledGameRsvp,
} from '../src/lib/scheduledGamesCore';

console.log('--- Testing NF-13: Scheduled Games & Calendar Reminders ---');

// Test 1: formatIcsDate
{
  const date = new Date(Date.UTC(2026, 10, 18, 15, 30, 45)); // Nov 18 2026 15:30:45 UTC
  const formatted = formatIcsDate(date);
  assert.strictEqual(formatted, '20261118T153045Z', 'ICS Date format should match YYYYMMDDTHHMMSSZ');
  console.log('✓ Test 1: formatIcsDate complies with RFC 5545 UTC pattern');
}

// Test 2: escapeIcsText
{
  const raw = 'Attention; Special, mission:\nReport\\Proceed';
  const escaped = escapeIcsText(raw);
  assert.strictEqual(
    escaped,
    'Attention\\; Special\\, mission:\\nReport\\\\Proceed',
    'Special characters must be escaped'
  );
  console.log('✓ Test 2: escapeIcsText properly escapes semicolons, commas, backslashes, and newlines');
}

// Test 3: foldIcsLine
{
  const shortLine = 'SUMMARY:Quick Mission';
  assert.strictEqual(foldIcsLine(shortLine), shortLine, 'Short lines should not be folded');

  const longLine = 'DESCRIPTION:' + 'A'.repeat(80);
  const folded = foldIcsLine(longLine);
  assert.ok(folded.includes('\r\n '), 'Long lines must contain CRLF followed by space');
  console.log('✓ Test 3: foldIcsLine correctly wraps lines exceeding 75 octets');
}

// Test 4: generateIcsCalendar
{
  const event: IcsEvent = {
    uid: 'ghostrun-123@ghostrun.app',
    title: 'Friday Night Raid',
    description: 'Bring tactical gear and high energy.',
    location: 'Sunset Park',
    startTime: new Date(Date.UTC(2026, 10, 20, 19, 0, 0)),
    endTime: new Date(Date.UTC(2026, 10, 20, 20, 0, 0)),
    created: new Date(Date.UTC(2026, 10, 18, 12, 0, 0)),
  };

  const ics = generateIcsCalendar(event);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'), 'Must start with BEGIN:VCALENDAR');
  assert.ok(ics.includes('BEGIN:VEVENT\r\n'), 'Must include BEGIN:VEVENT');
  assert.ok(ics.includes('UID:ghostrun-123@ghostrun.app\r\n'), 'Must include correct UID');
  assert.ok(ics.includes('DTSTART:20261120T190000Z\r\n'), 'Must include correct DTSTART');
  assert.ok(ics.includes('DTEND:20261120T200000Z\r\n'), 'Must include correct DTEND');
  assert.ok(ics.includes('SUMMARY:Friday Night Raid\r\n'), 'Must include correct SUMMARY');
  assert.ok(ics.includes('LOCATION:Sunset Park\r\n'), 'Must include LOCATION');
  assert.ok(ics.includes('STATUS:CONFIRMED\r\n'), 'Must include STATUS:CONFIRMED');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'), 'Must end with END:VCALENDAR');
  console.log('✓ Test 4: generateIcsCalendar produces valid RFC 5545 VCALENDAR payload');
}

// Test 5: Validation - Title bounds
{
  const now = new Date('2026-11-18T12:00:00Z');
  const future = new Date('2026-11-18T13:00:00Z');

  const shortRes = validateScheduledGameInput(
    { title: 'ab', modeId: 'classic_chase', scheduledAt: future },
    now
  );
  assert.strictEqual(shortRes.valid, false, 'Title under 3 chars must fail');

  const longRes = validateScheduledGameInput(
    { title: 'x'.repeat(61), modeId: 'classic_chase', scheduledAt: future },
    now
  );
  assert.strictEqual(longRes.valid, false, 'Title over 60 chars must fail');

  console.log('✓ Test 5: validateScheduledGameInput enforces title bounds');
}

// Test 6: Validation - Future timestamp & mode
{
  const now = new Date('2026-11-18T12:00:00Z');
  const past = new Date('2026-11-18T11:00:00Z');
  const tooSoon = new Date('2026-11-18T12:02:00Z');

  const pastRes = validateScheduledGameInput(
    { title: 'Valid Title', modeId: 'classic_chase', scheduledAt: past },
    now
  );
  assert.strictEqual(pastRes.valid, false, 'Past timestamp must fail');

  const soonRes = validateScheduledGameInput(
    { title: 'Valid Title', modeId: 'classic_chase', scheduledAt: tooSoon },
    now
  );
  assert.strictEqual(soonRes.valid, false, 'Time under 5 min ahead must fail');

  const noModeRes = validateScheduledGameInput(
    { title: 'Valid Title', modeId: '', scheduledAt: new Date('2026-11-18T13:00:00Z') },
    now
  );
  assert.strictEqual(noModeRes.valid, false, 'Empty mode must fail');

  console.log('✓ Test 6: validateScheduledGameInput enforces future timing and valid mode');
}

// Test 7: Validation - Privacy coordinate guard
{
  const now = new Date('2026-11-18T12:00:00Z');
  const future = new Date('2026-11-18T13:00:00Z');

  const coordRes = validateScheduledGameInput(
    {
      title: 'Tactical Meet',
      modeId: 'tag_hunt',
      scheduledAt: future,
      areaName: '37.7749, -122.4194',
    },
    now
  );
  assert.strictEqual(coordRes.valid, false, 'Exact coordinates must be rejected to protect privacy');
  assert.ok(coordRes.error?.includes('Do not use exact coordinates'));

  const safeRes = validateScheduledGameInput(
    {
      title: 'Tactical Meet',
      modeId: 'tag_hunt',
      scheduledAt: future,
      areaName: 'Mission Dolores Park Plaza',
    },
    now
  );
  assert.strictEqual(safeRes.valid, true, 'General area name must pass');

  console.log('✓ Test 7: validateScheduledGameInput rejects raw coordinates for privacy');
}

// Test 8: buildGameIcsContent
{
  const game: ScheduledGame = {
    id: 'b6f17e04-7182-4f70-a359-994df512bce1',
    host_id: 'host-uid-1',
    title: 'Downtown Manhunt',
    mode_id: 'classic_chase',
    scheduled_at: '2026-11-20T22:00:00Z',
    area_name: 'Metro Center',
    notes: 'Bring flashlight and radio headset.',
    created_at: '2026-11-18T12:00:00Z',
  };

  const ics = buildGameIcsContent(game, 90);
  assert.ok(ics.includes('SUMMARY:GhostRun: Downtown Manhunt\r\n'));
  assert.ok(ics.includes('DTSTART:20261120T220000Z\r\n'));
  assert.ok(ics.includes('DTEND:20261120T233000Z\r\n'));
  assert.ok(ics.includes('LOCATION:Metro Center\r\n'));
  assert.ok(ics.includes('Bring flashlight and radio headset'));
  console.log('✓ Test 8: buildGameIcsContent formats complete scheduled game payload');
}

// Test 9: summarizeRsvps
{
  const rsvps: ScheduledGameRsvp[] = [
    { scheduled_game_id: 'g1', user_id: 'u1', response: 'attending', updated_at: '' },
    { scheduled_game_id: 'g1', user_id: 'u2', response: 'attending', updated_at: '' },
    { scheduled_game_id: 'g1', user_id: 'u3', response: 'tentative', updated_at: '' },
    { scheduled_game_id: 'g1', user_id: 'u4', response: 'declined', updated_at: '' },
  ];

  const summary = summarizeRsvps(rsvps);
  assert.strictEqual(summary.attending, 2);
  assert.strictEqual(summary.tentative, 1);
  assert.strictEqual(summary.declined, 1);
  assert.strictEqual(summary.total, 4);
  console.log('✓ Test 9: summarizeRsvps aggregates player responses correctly');
}

console.log('\nAll 9 NF-13 scheduled game tests passed successfully!\n');
