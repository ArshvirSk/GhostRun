/**
 * NF-13: RFC 5545 iCalendar Pure Generator
 *
 * Formats tactical scheduled game sessions into standard .ics format
 * for export to iOS Calendar, Google Calendar, Outlook, etc.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  created?: Date;
}

/**
 * Format a JavaScript Date to UTC iCalendar format: YYYYMMDDTHHMMSSZ
 */
export function formatIcsDate(date: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Escape text according to RFC 5545 (commas, semicolons, backslashes, newlines)
 */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

/**
 * Fold lines exceeding 75 characters as specified in RFC 5545 §3.1
 */
export function foldIcsLine(line: string): string {
  const MAX_LEN = 75;
  if (line.length <= MAX_LEN) return line;

  let folded = '';
  let remaining = line;

  // First chunk
  folded += remaining.slice(0, MAX_LEN) + '\r\n';
  remaining = remaining.slice(MAX_LEN);

  // Subsequent chunks start with space
  while (remaining.length > 74) {
    folded += ' ' + remaining.slice(0, 74) + '\r\n';
    remaining = remaining.slice(74);
  }

  if (remaining.length > 0) {
    folded += ' ' + remaining;
  }

  return folded;
}

/**
 * Generate a complete RFC 5545 VCALENDAR payload
 */
export function generateIcsCalendar(event: IcsEvent): string {
  const now = event.created || new Date();
  const dtstamp = formatIcsDate(now);
  const dtstart = formatIcsDate(event.startTime);
  const dtend = formatIcsDate(event.endTime);
  const summary = escapeIcsText(event.title);
  const description = event.description ? escapeIcsText(event.description) : '';
  const location = event.location ? escapeIcsText(event.location) : '';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GhostRun//GhostRun Tactical Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${summary}`,
  ];

  if (description) {
    lines.push(`DESCRIPTION:${description}`);
  }

  if (location) {
    lines.push(`LOCATION:${location}`);
  }

  lines.push('STATUS:CONFIRMED');
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
