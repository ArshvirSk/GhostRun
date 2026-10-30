import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ghostrun:resend-cooldowns';

type Cooldowns = Record<string, number>;

function normalize(email: string) {
  return email.trim().toLowerCase();
}

async function readCooldowns(): Promise<Cooldowns> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const cooldowns: Cooldowns = {};
    for (const [email, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) cooldowns[email] = value;
    }
    return cooldowns;
  } catch {
    return {};
  }
}

/** Remaining cooldown deadline for an email, or 0 when a resend is allowed. */
export async function getResendCooldown(email: string): Promise<number> {
  const cooldowns = await readCooldowns();
  const until = cooldowns[normalize(email)] ?? 0;
  return until > Date.now() ? until : 0;
}

/** Stores a deadline and drops entries that have already expired. */
export async function setResendCooldown(email: string, until: number): Promise<void> {
  const now = Date.now();
  const cooldowns = await readCooldowns();
  const next: Cooldowns = {};
  for (const [key, value] of Object.entries(cooldowns)) {
    if (value > now) next[key] = value;
  }
  next[normalize(email)] = until;

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A storage failure only weakens the guard to this session.
  }
}
