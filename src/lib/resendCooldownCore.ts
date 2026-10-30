/** Minimal key-value store needed by the resend cooldown. */
export type CooldownStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export const RESEND_COOLDOWN_STORAGE_KEY = 'ghostrun:resend-cooldowns';

type Cooldowns = Record<string, number>;

function normalize(email: string) {
  return email.trim().toLowerCase();
}

async function readCooldowns(storage: CooldownStorage): Promise<Cooldowns> {
  try {
    const raw = await storage.getItem(RESEND_COOLDOWN_STORAGE_KEY);
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

export function createResendCooldownStore(storage: CooldownStorage) {
  /** Remaining cooldown deadline for an email, or 0 when a resend is allowed. */
  async function get(email: string): Promise<number> {
    const cooldowns = await readCooldowns(storage);
    const until = cooldowns[normalize(email)] ?? 0;
    return until > Date.now() ? until : 0;
  }

  /** Stores a deadline and drops entries that have already expired. */
  async function set(email: string, until: number): Promise<void> {
    const now = Date.now();
    const cooldowns = await readCooldowns(storage);
    const next: Cooldowns = {};
    for (const [key, value] of Object.entries(cooldowns)) {
      if (value > now) next[key] = value;
    }
    next[normalize(email)] = until;

    try {
      await storage.setItem(RESEND_COOLDOWN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A storage failure only weakens the guard to this session.
    }
  }

  return { get, set };
}
