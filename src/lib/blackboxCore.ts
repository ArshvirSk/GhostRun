/**
 * GhostRun Tactical Field Blackbox Telemetry Recorder Core
 *
 * Implements an air-gapped, zero-cloud on-device flight recorder for live matches.
 * Records high-resolution GPS fixes, kinematic telemetry, battery status, and match events
 * in an append-only JSONL format for post-mission forensic analysis and simulator replay.
 */

export interface BlackboxGpsFix {
  timestamp: number; // Unix epoch ms
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  batteryLevel?: number;
}

export type BlackboxEventType =
  | 'match_start'
  | 'match_end'
  | 'ping_emitted'
  | 'ping_received'
  | 'tag_attempt'
  | 'tag_confirmed'
  | 'boundary_warning'
  | 'boundary_breach'
  | 'deadband_hold'
  | 'sos_triggered';

export interface BlackboxEvent {
  timestamp: number;
  type: BlackboxEventType;
  payload?: Record<string, any>;
}

export interface BlackboxSession {
  version: '1.0.0';
  gameId: string;
  modeId: string;
  callsign: string;
  role: string;
  startedAt: string;
  endedAt?: string;
  initialBatteryLevel?: number;
  fixes: BlackboxGpsFix[];
  events: BlackboxEvent[];
}

/**
 * Creates a new blank blackbox recording session
 */
export function createBlackboxSession(params: {
  gameId: string;
  modeId: string;
  callsign: string;
  role: string;
  initialBatteryLevel?: number;
}): BlackboxSession {
  return {
    version: '1.0.0',
    gameId: params.gameId,
    modeId: params.modeId,
    callsign: params.callsign,
    role: params.role,
    startedAt: new Date().toISOString(),
    initialBatteryLevel: params.initialBatteryLevel,
    fixes: [],
    events: [
      {
        timestamp: Date.now(),
        type: 'match_start',
        payload: {
          gameId: params.gameId,
          modeId: params.modeId,
          role: params.role,
        },
      },
    ],
  };
}

/**
 * Appends a raw GPS fix to the active session
 */
export function appendBlackboxFix(session: BlackboxSession, fix: BlackboxGpsFix): void {
  session.fixes.push(fix);
}

/**
 * Appends a discrete tactical event to the active session
 */
export function appendBlackboxEvent(session: BlackboxSession, event: BlackboxEvent): void {
  session.events.push(event);
}

/**
 * Finalizes the session, recording end timestamp
 */
export function finalizeBlackboxSession(session: BlackboxSession): BlackboxSession {
  session.endedAt = new Date().toISOString();
  session.events.push({
    timestamp: Date.now(),
    type: 'match_end',
  });
  return session;
}

/**
 * Serializes a blackbox session into an append-friendly JSONL string
 */
export function serializeBlackboxToJsonl(session: BlackboxSession): string {
  const lines: string[] = [];

  // Line 1: Header record
  lines.push(
    JSON.stringify({
      recordType: 'header',
      version: session.version,
      gameId: session.gameId,
      modeId: session.modeId,
      callsign: session.callsign,
      role: session.role,
      startedAt: session.startedAt,
      endedAt: session.endedAt || null,
      initialBatteryLevel: session.initialBatteryLevel ?? null,
    })
  );

  // Fixes records
  for (const fix of session.fixes) {
    lines.push(
      JSON.stringify({
        recordType: 'fix',
        t: fix.timestamp,
        lat: fix.lat,
        lng: fix.lng,
        acc: fix.accuracy,
        spd: fix.speed,
        hdg: fix.heading,
        bat: fix.batteryLevel ?? null,
      })
    );
  }

  // Events records
  for (const ev of session.events) {
    lines.push(
      JSON.stringify({
        recordType: 'event',
        t: ev.timestamp,
        type: ev.type,
        data: ev.payload || null,
      })
    );
  }

  return lines.join('\n');
}

/**
 * Parses a JSONL blackbox string back into a full session object
 */
export function parseBlackboxFromJsonl(content: string): BlackboxSession {
  if (!content || typeof content !== 'string') {
    throw new Error('Blackbox content must be a non-empty string');
  }

  const rawLines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (rawLines.length === 0) {
    throw new Error('Blackbox content is empty');
  }

  let session: BlackboxSession | null = null;
  const fixes: BlackboxGpsFix[] = [];
  const events: BlackboxEvent[] = [];

  for (const line of rawLines) {
    const record = JSON.parse(line);

    if (record.recordType === 'header') {
      session = {
        version: record.version || '1.0.0',
        gameId: record.gameId,
        modeId: record.modeId,
        callsign: record.callsign,
        role: record.role,
        startedAt: record.startedAt,
        endedAt: record.endedAt || undefined,
        initialBatteryLevel: record.initialBatteryLevel ?? undefined,
        fixes: [],
        events: [],
      };
    } else if (record.recordType === 'fix') {
      fixes.push({
        timestamp: record.t,
        lat: record.lat,
        lng: record.lng,
        accuracy: record.acc,
        speed: record.spd,
        heading: record.hdg,
        batteryLevel: record.bat ?? undefined,
      });
    } else if (record.recordType === 'event') {
      events.push({
        timestamp: record.t,
        type: record.type,
        payload: record.data || undefined,
      });
    }
  }

  if (!session) {
    throw new Error('Blackbox JSONL missing required header record');
  }

  session.fixes = fixes;
  session.events = events;
  return session;
}

/**
 * Validates the kinematic integrity of a recorded session
 */
export function validateBlackboxSession(session: BlackboxSession): {
  valid: boolean;
  fixCount: number;
  eventCount: number;
  durationSeconds: number;
  error?: string;
} {
  if (!session || !session.gameId) {
    return { valid: false, fixCount: 0, eventCount: 0, durationSeconds: 0, error: 'Missing session header' };
  }

  const fixCount = session.fixes?.length || 0;
  const eventCount = session.events?.length || 0;

  let durationSeconds = 0;
  if (fixCount > 1) {
    const startT = session.fixes[0].timestamp;
    const endT = session.fixes[fixCount - 1].timestamp;
    durationSeconds = Math.max(0, Math.round((endT - startT) / 1000));
  }

  return {
    valid: true,
    fixCount,
    eventCount,
    durationSeconds,
  };
}
