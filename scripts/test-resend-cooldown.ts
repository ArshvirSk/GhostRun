/**
 * Checks the resend cooldown store against an in-memory backend.
 *
 * Run with: npm run test:cooldown
 */
import {
  createResendCooldownStore,
  RESEND_COOLDOWN_STORAGE_KEY,
  type CooldownStorage,
} from '../src/lib/resendCooldownCore';

let failures = 0;

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(label: string, detail: string) {
  failures += 1;
  console.error(`FAIL ${label} (${detail})`);
}

function expect(condition: boolean, label: string, detail = '') {
  if (condition) pass(label);
  else fail(label, detail);
}

class MemoryStorage implements CooldownStorage {
  readonly items = new Map<string, string>();
  failWrites = false;

  async getItem(key: string) {
    return this.items.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('write failed');
    this.items.set(key, value);
  }

  readCooldowns(): Record<string, number> {
    const raw = this.items.get(RESEND_COOLDOWN_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  }
}

async function main() {
  const storage = new MemoryStorage();
  const store = createResendCooldownStore(storage);

  expect((await store.get('nobody@example.com')) === 0, 'empty storage allows a resend');

  const until = Date.now() + 60_000;
  await store.set('  Alice@Example.COM ', until);
  expect((await store.get('alice@example.com')) === until, 'future deadlines are returned');
  expect(
    storage.readCooldowns()['alice@example.com'] === until,
    'emails are normalized when stored',
  );

  const other = Date.now() + 120_000;
  await store.set('bob@example.com', other);
  expect((await store.get('bob@example.com')) === other, 'deadlines are isolated per email');
  expect(
    (await store.get('alice@example.com')) === until,
    'a second email keeps the first deadline',
  );

  const seeded = new MemoryStorage();
  seeded.items.set(
    RESEND_COOLDOWN_STORAGE_KEY,
    JSON.stringify({
      'old@example.com': Date.now() - 1000,
      'keep@example.com': Date.now() + 60_000,
    }),
  );
  const seededStore = createResendCooldownStore(seeded);
  expect((await seededStore.get('old@example.com')) === 0, 'expired deadlines allow a resend');

  await seededStore.set('new@example.com', Date.now() + 60_000);
  const written = seeded.readCooldowns();
  expect(!('old@example.com' in written), 'expired entries are pruned on write');
  expect(written['keep@example.com'] > Date.now(), 'active entries survive a write');
  expect(written['new@example.com'] > Date.now(), 'the new deadline is written');

  const broken = new MemoryStorage();
  broken.items.set(RESEND_COOLDOWN_STORAGE_KEY, 'not json');
  const brokenStore = createResendCooldownStore(broken);
  expect((await brokenStore.get('any@example.com')) === 0, 'bad JSON is treated as empty');
  await brokenStore.set('any@example.com', Date.now() + 60_000);
  expect((await brokenStore.get('any@example.com')) > Date.now(), 'bad JSON is replaced on write');

  const failing = new MemoryStorage();
  failing.failWrites = true;
  const failingStore = createResendCooldownStore(failing);
  let threw = false;
  try {
    await failingStore.set('a@example.com', Date.now() + 60_000);
  } catch {
    threw = true;
  }
  expect(!threw, 'write failures are swallowed');
  expect(
    (await failingStore.get('a@example.com')) === 0,
    'write failures leave no usable deadline',
  );

  console.log(failures === 0 ? '\nAll cooldown checks passed.' : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exit(1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
