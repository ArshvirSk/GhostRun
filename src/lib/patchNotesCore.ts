/**
 * GhostRun Tactical Patch Notes & Dynamic What's New Engine
 *
 * Provides version comparison, remote patch note resolution,
 * and display triggers for in-app tactical debrief announcements.
 */

export interface PatchNoteItem {
  id: string;
  title: string;
  description: string;
  category?: 'mode' | 'tactical' | 'audio' | 'safety' | 'perf';
}

export interface PatchNotesPayload {
  version: string;
  release_date: string;
  title: string;
  subtitle: string;
  highlights: PatchNoteItem[];
}

/**
 * Built-in tactical release notes for v2.9.23
 */
export const LOCAL_PATCH_NOTES: PatchNotesPayload = {
  version: '2.9.23',
  release_date: '2026-11-24',
  title: 'OPERATION NIGHTFALL v2.9.23',
  subtitle: 'Tactical Overhaul, Accessibility, and Community Discord Integration',
  highlights: [
    {
      id: 'discord-int',
      title: 'Squad Discord Integration',
      description: 'Automated lobby dispatch, match debriefs, and emergency SOS routing directly to Discord squad channels with zero GPS coordinate leakage.',
      category: 'tactical',
    },
    {
      id: 'a11y-radar',
      title: 'Calibrated Colorblind Radar',
      description: 'Scientifically tuned palettes for Protanopia, Deuteranopia, and Tritanopia, plus direct sunlight high-contrast overlay.',
      category: 'tactical',
    },
    {
      id: 'admin-config',
      title: 'Dynamic Remote Config & Safeguards',
      description: 'Instant remote kill-switches and emergency mode controls without requiring new app downloads. Free community hosting locked.',
      category: 'safety',
    },
    {
      id: 'audio-immersion',
      title: 'Tactical Audio & Wrist HUD',
      description: 'Zero-latency binaural ping cues, background deadband wander suppression, and Wear OS companion wrist navigation.',
      category: 'audio',
    },
  ],
};

/**
 * Compares two semantic version strings
 * Returns true if vA > vB
 */
export function isVersionNewer(vA: string, vB: string): boolean {
  if (!vB) return true;
  if (!vA) return false;

  const parse = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0);
  const partsA = parse(vA);
  const partsB = parse(vB);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const a = partsA[i] || 0;
    const b = partsB[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/**
 * Determines whether the "What's New" modal should be presented to the user
 */
export function shouldDisplayPatchNotes(params: {
  currentVersion: string;
  lastSeenVersion: string | null;
  patchNotes?: PatchNotesPayload;
}): boolean {
  const notes = params.patchNotes || LOCAL_PATCH_NOTES;
  if (!notes || !Array.isArray(notes.highlights) || notes.highlights.length === 0) {
    return false;
  }

  // If user has never seen any patch notes, show them
  if (!params.lastSeenVersion) {
    return true;
  }

  // Show if the available patch notes are strictly newer than the last acknowledged version
  return isVersionNewer(notes.version, params.lastSeenVersion);
}
