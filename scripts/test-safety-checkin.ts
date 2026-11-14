let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`PASS: ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

console.log('--- NF-06 Safety Check-in & Curfew Unit Tests ---');

// Test 1: Curfew evaluation
function isCurfewExpired(curfewIso: string, nowMs: number): boolean {
  const curfewMs = Date.parse(curfewIso);
  return Number.isFinite(curfewMs) && nowMs >= curfewMs;
}

const futureCurfew = new Date(Date.now() + 3600000).toISOString();
const pastCurfew = new Date(Date.now() - 60000).toISOString();

assert(!isCurfewExpired(futureCurfew, Date.now()), 'Future curfew is not expired');
assert(isCurfewExpired(pastCurfew, Date.now()), 'Past curfew evaluates as expired');

// Test 2: Target audience for missed checkin
function getMissedCheckinAudience(modeId: string, playerTeam: string): string {
  if (['ghost_duel', 'assassin_ring'].includes(modeId)) {
    return 'all';
  }
  return playerTeam;
}

assert(getMissedCheckinAudience('classic_chase', 'runner') === 'runner', 'Classic Chase runner missed checkin reaches runner teammates only');
assert(getMissedCheckinAudience('tag_hunt', 'hunter') === 'hunter', 'Tag Hunt hunter missed checkin reaches hunter teammates only');
assert(getMissedCheckinAudience('ghost_duel', 'runner') === 'all', 'Solo Ghost Duel missed checkin reaches all participants');

// Test 3: Checkin interval selection
function resolveCheckinIntervalMinutes(safetyParams: { checkin_interval_m?: number } | undefined, isNight: boolean): number {
  if (safetyParams?.checkin_interval_m && safetyParams.checkin_interval_m > 0) {
    return safetyParams.checkin_interval_m;
  }
  return isNight ? 10 : 15;
}

assert(resolveCheckinIntervalMinutes({ checkin_interval_m: 20 }, false) === 20, 'Host override interval respected');
assert(resolveCheckinIntervalMinutes(undefined, true) === 10, 'Night matches default to 10m checkin');
assert(resolveCheckinIntervalMinutes(undefined, false) === 15, 'Day matches default to 15m checkin');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
