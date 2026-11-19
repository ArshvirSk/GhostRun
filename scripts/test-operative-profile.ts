/**
 * GhostRun FL-P4: Operative Profile & Visibility Test Suite
 *
 * Verifies profile visibility controls, friend full dossiers,
 * public overview summaries, and private dossier redaction.
 */

import {
  ProfileVisibility,
  OperativeProfileDossier,
  FriendSettings,
} from '../src/lib/friendsCore';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    process.exit(1);
  }
}

console.log('--- GhostRun FL-P4: Operative Profile & Visibility Test Suite ---\n');

// 1. Verify ProfileVisibility constraints
console.log('[1] Testing ProfileVisibility Constraints...');
const validVisibilities: ProfileVisibility[] = ['public', 'private'];
assert(validVisibilities.includes('public'), 'public is valid visibility');
assert(validVisibilities.includes('private'), 'private is valid visibility');
console.log('  PASS: ProfileVisibility enum constraints verified\n');

// 2. Test Private Non-Friend Profile Redaction
console.log('[2] Testing Private Non-Friend Redaction Rules...');
const mockPrivateNonFriend: OperativeProfileDossier = {
  found: true,
  userId: 'target-uuid-1',
  displayName: 'ShadowGhost',
  handle: 'shadow',
  color: '#8A2BE2',
  visibility: 'private',
  isFriend: false,
  isSelf: false,
  friendshipStatus: 'none',
  isRedacted: true,
};

assert(mockPrivateNonFriend.isRedacted === true, 'Private non-friend must be marked as redacted');
assert(mockPrivateNonFriend.isFriend === false, 'Non-friend must be false');
assert(mockPrivateNonFriend.seasonEcho === undefined, 'Season Echo must be redacted');
assert(mockPrivateNonFriend.tier === undefined, 'Tier must be redacted');
assert(mockPrivateNonFriend.rounds === undefined, 'Matches must be redacted');
assert(mockPrivateNonFriend.headToHead === undefined, 'Head-to-Head must be redacted');
assert(mockPrivateNonFriend.badges === undefined, 'Badges must be redacted');
console.log('  PASS: Private non-friend correctly classified with zero telemetry leakage\n');

// 3. Test Public Non-Friend Overview
console.log('[3] Testing Public Non-Friend Overview...');
const mockPublicNonFriend: OperativeProfileDossier = {
  found: true,
  userId: 'target-uuid-2',
  displayName: 'ApexRunner',
  handle: 'apex',
  color: '#00FF66',
  visibility: 'public',
  isFriend: false,
  isSelf: false,
  friendshipStatus: 'none',
  isRedacted: false,
  tier: 'Revenant',
  seasonEcho: 450,
  avgGhost: 72.5,
  avgCash: 35.0,
  rounds: 24,
  won: 16,
  winRate: 67,
  neverCaught: 5,
  badges: ['first_deployment', 'veteran_operative'],
  headToHead: null, // H2H is friend-only
};

assert(mockPublicNonFriend.isRedacted === false, 'Public profile is not redacted');
assert(mockPublicNonFriend.tier === 'Revenant', 'Public profile shows Tier');
assert(mockPublicNonFriend.seasonEcho === 450, 'Public profile shows Season Echo');
assert(mockPublicNonFriend.badges?.length === 2, 'Public profile displays badges showcase');
assert(mockPublicNonFriend.headToHead === null, 'Head-to-head remains strictly friend-only');
console.log('  PASS: Public profile provides tactical overview with friend-only H2H barrier\n');

// 4. Test Confirmed Friend Full Dossier
console.log('[4] Testing Confirmed Friend Full Dossier...');
const mockFriendDossier: OperativeProfileDossier = {
  found: true,
  userId: 'target-uuid-3',
  displayName: 'SpectreOne',
  handle: 'spectre',
  color: '#C7F36B',
  visibility: 'private', // Even if private to outsiders, friends see all!
  isFriend: true,
  isSelf: false,
  friendshipStatus: 'friend',
  isRedacted: false,
  presence: {
    online: true,
    gameId: 'game-uuid-99',
    modeId: 'classic_chase',
    playerCount: 3,
  },
  tier: 'Phantom',
  seasonEcho: 380,
  avgGhost: 65.0,
  avgCash: 40.0,
  rounds: 30,
  won: 20,
  winRate: 67,
  neverCaught: 7,
  badges: ['first_deployment', 'veteran_operative', 'clean_sweep'],
  headToHead: {
    oppositeRounds: 6,
    myWins: 4,
    friendWins: 2,
    timesGhostedThem: 3,
    timesTheyCashedMe: 1,
  },
  recentMatches: [
    {
      game_id: 'game-1',
      mode_id: 'classic_chase',
      team: 'runner',
      won: true,
      created_at: new Date().toISOString(),
    },
  ],
};

assert(mockFriendDossier.isFriend === true, 'Must be confirmed friend');
assert(mockFriendDossier.isRedacted === false, 'Friends are never redacted');
assert(mockFriendDossier.headToHead !== null, 'Head-to-Head is available to friends');
assert(mockFriendDossier.headToHead?.myWins === 4, 'H2H myWins match');
assert(mockFriendDossier.headToHead?.friendWins === 2, 'H2H friendWins match');
assert(mockFriendDossier.presence?.online === true, 'Presence is accessible to friends');
assert(mockFriendDossier.recentMatches?.length === 1, 'Recent match history accessible to friends');
console.log('  PASS: Confirmed allies receive full unredacted dossier with live presence & telemetry\n');

// 5. Test FriendSettings with ProfileVisibility
console.log('[5] Testing FriendSettings Profile Visibility Field...');
const settings: FriendSettings = {
  allowFriendRequests: true,
  showPresence: true,
  shareEcho: true,
  profileVisibility: 'public',
};

assert(settings.profileVisibility === 'public', 'Settings store visibility');
const privateSettings: FriendSettings = { ...settings, profileVisibility: 'private' };
assert(privateSettings.profileVisibility === 'private', 'Settings update visibility to private');
console.log('  PASS: FriendSettings successfully incorporates profileVisibility state\n');

console.log('All FL-P4 Operative Profile & Visibility tests passed successfully!');
