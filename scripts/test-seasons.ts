import assert from 'node:assert';
import {
  calculateSeasonCountdown,
  filterActiveBanners,
  AnnouncementBanner,
} from '../src/lib/seasonsCore';

console.log('--- Testing NF-31: Season Framework & Announcement Banners ---');

// Test 1: calculateSeasonCountdown - Multi-day remaining
{
  const now = new Date('2026-11-18T12:00:00Z');
  const future = new Date('2026-12-12T12:00:00Z'); // 24 days later
  const res = calculateSeasonCountdown(future, now);

  assert.strictEqual(res.daysRemaining, 24);
  assert.strictEqual(res.label, 'Season ends in 24 days');
  assert.strictEqual(res.isEnded, false);
  console.log('✓ Test 1: calculateSeasonCountdown computes remaining days correctly');
}

// Test 2: calculateSeasonCountdown - Single day remaining
{
  const now = new Date('2026-11-18T12:00:00Z');
  const tomorrow = new Date('2026-11-19T18:00:00Z'); // 30 hours later = 1 day 6 hours
  const res = calculateSeasonCountdown(tomorrow, now);

  assert.strictEqual(res.daysRemaining, 1);
  assert.strictEqual(res.label, 'Season ends in 1 day');
  assert.strictEqual(res.isEnded, false);
  console.log('✓ Test 2: calculateSeasonCountdown handles 1 day boundary');
}

// Test 3: calculateSeasonCountdown - Hours remaining (< 24h)
{
  const now = new Date('2026-11-18T12:00:00Z');
  const soon = new Date('2026-11-18T18:00:00Z'); // 6 hours
  const res = calculateSeasonCountdown(soon, now);

  assert.strictEqual(res.daysRemaining, 0);
  assert.strictEqual(res.hoursRemaining, 6);
  assert.strictEqual(res.label, 'Season ends in 6 hours');
  assert.strictEqual(res.isEnded, false);
  console.log('✓ Test 3: calculateSeasonCountdown formats hours remaining');
}

// Test 4: calculateSeasonCountdown - Expired / Ended
{
  const now = new Date('2026-11-18T12:00:00Z');
  const past = new Date('2026-11-17T12:00:00Z');
  const res = calculateSeasonCountdown(past, now);

  assert.strictEqual(res.daysRemaining, 0);
  assert.strictEqual(res.label, 'Season Ended');
  assert.strictEqual(res.isEnded, true);
  console.log('✓ Test 4: calculateSeasonCountdown marks ended seasons accurately');
}

// Test 5: filterActiveBanners - Time windows & active flags
{
  const now = new Date('2026-11-18T12:00:00Z');

  const banners: AnnouncementBanner[] = [
    {
      id: 'active-1',
      title: 'Current Event',
      starts_at: '2026-11-15T00:00:00Z',
      ends_at: '2026-11-20T00:00:00Z',
      is_active: true,
    },
    {
      id: 'future-1',
      title: 'Next Week Event',
      starts_at: '2026-11-25T00:00:00Z',
      ends_at: '2026-11-30T00:00:00Z',
      is_active: true,
    },
    {
      id: 'past-1',
      title: 'Old Event',
      starts_at: '2026-11-01T00:00:00Z',
      ends_at: '2026-11-10T00:00:00Z',
      is_active: true,
    },
    {
      id: 'disabled-1',
      title: 'Disabled Event',
      starts_at: '2026-11-15T00:00:00Z',
      ends_at: '2026-11-20T00:00:00Z',
      is_active: false,
    },
  ];

  const active = filterActiveBanners(banners, now);
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].id, 'active-1');
  console.log('✓ Test 5: filterActiveBanners filters expired, future, and inactive banners');
}

console.log('\nAll 5 NF-31 seasons & banners tests passed successfully!\n');
