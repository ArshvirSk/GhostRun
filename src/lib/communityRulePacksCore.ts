/**
 * NF-36: Community Rule Packs (Data-Only) Engine
 *
 * Security & Safety Principles:
 * 1. STRICTLY DATA-ONLY: No executable JavaScript, Lua, bytecode, or dynamic code execution.
 * 2. Immutable Safety Invariants: Vehicle transport and location spoofing can NEVER be permitted.
 * 3. Bounded Parameters: Tag radius, boundary radius, and ping timings must lie within validated physical safety ranges.
 */

export interface CommunityRulePack {
  schemaVersion: 1;
  id: string;
  name: string;
  author: string;
  version: string;
  description?: string;
  rules: {
    tagRadiusMeters: number; // 5m - 30m
    pingIntervalSeconds: number; // 10s - 120s
    headStartSeconds: number; // 0s - 300s
    boundaryRadiusMeters: number; // 100m - 2000m
    curfewIntervalSeconds?: number; // 300s - 1800s
    boundaryViolationAction: 'warn' | 'reveal_live' | 'auto_tag';
  };
}

export interface RulePackValidationResult {
  valid: boolean;
  rulePack?: CommunityRulePack;
  errors: string[];
}

/**
 * Validate a community rule pack against strict safety invariants
 */
export function validateCommunityRulePack(input: unknown): RulePackValidationResult {
  const errors: string[] = [];

  let obj: any = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return { valid: false, errors: ['Invalid JSON format'] };
    }
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['Rule pack must be a valid JSON object'] };
  }

  // Security: check for executable code / prototype pollution
  const rawString = JSON.stringify(obj);
  if (
    rawString.includes('function') ||
    rawString.includes('eval') ||
    rawString.includes('__proto__') ||
    rawString.includes('constructor')
  ) {
    return { valid: false, errors: ['Forbidden executable or prototype keys detected.'] };
  }

  if (obj.schemaVersion !== 1) {
    errors.push('Unsupported schemaVersion (expected 1).');
  }

  if (typeof obj.name !== 'string' || obj.name.trim().length < 3 || obj.name.length > 40) {
    errors.push('Rule pack name must be between 3 and 40 characters.');
  }

  if (typeof obj.author !== 'string' || obj.author.trim().length < 2 || obj.author.length > 30) {
    errors.push('Author must be between 2 and 30 characters.');
  }

  if (!obj.rules || typeof obj.rules !== 'object') {
    errors.push('Missing "rules" configuration block.');
    return { valid: false, errors };
  }

  const r = obj.rules;

  // Tag radius: 5m to 30m
  if (typeof r.tagRadiusMeters !== 'number' || r.tagRadiusMeters < 5 || r.tagRadiusMeters > 30) {
    errors.push('tagRadiusMeters must be between 5 and 30 meters.');
  }

  // Ping interval: 10s to 120s
  if (typeof r.pingIntervalSeconds !== 'number' || r.pingIntervalSeconds < 10 || r.pingIntervalSeconds > 120) {
    errors.push('pingIntervalSeconds must be between 10 and 120 seconds.');
  }

  // Head start: 0s to 300s
  if (typeof r.headStartSeconds !== 'number' || r.headStartSeconds < 0 || r.headStartSeconds > 300) {
    errors.push('headStartSeconds must be between 0 and 300 seconds.');
  }

  // Boundary radius: 100m to 2000m
  if (typeof r.boundaryRadiusMeters !== 'number' || r.boundaryRadiusMeters < 100 || r.boundaryRadiusMeters > 2000) {
    errors.push('boundaryRadiusMeters must be between 100 and 2000 meters.');
  }

  // Boundary violation action
  if (!['warn', 'reveal_live', 'auto_tag'].includes(r.boundaryViolationAction)) {
    errors.push('boundaryViolationAction must be "warn", "reveal_live", or "auto_tag".');
  }

  // Curfew interval (optional)
  if (r.curfewIntervalSeconds !== undefined) {
    if (typeof r.curfewIntervalSeconds !== 'number' || r.curfewIntervalSeconds < 300 || r.curfewIntervalSeconds > 1800) {
      errors.push('curfewIntervalSeconds must be between 300s (5m) and 1800s (30m).');
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const cleanPack: CommunityRulePack = {
    schemaVersion: 1,
    id: obj.id || `pack-${Date.now()}`,
    name: obj.name.trim(),
    author: obj.author.trim(),
    version: obj.version || '1.0.0',
    description: obj.description ? String(obj.description).slice(0, 200) : undefined,
    rules: {
      tagRadiusMeters: r.tagRadiusMeters,
      pingIntervalSeconds: r.pingIntervalSeconds,
      headStartSeconds: r.headStartSeconds,
      boundaryRadiusMeters: r.boundaryRadiusMeters,
      curfewIntervalSeconds: r.curfewIntervalSeconds,
      boundaryViolationAction: r.boundaryViolationAction,
    },
  };

  return { valid: true, rulePack: cleanPack, errors: [] };
}
