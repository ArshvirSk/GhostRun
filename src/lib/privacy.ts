/**
 * Privacy policy versioning and copy.
 *
 * TODO(policy-url): set PRIVACY_POLICY_URL once the full policy page is hosted.
 * Until then the "Read full policy online" row is hidden. TODO(legal): the copy
 * below is a product draft, not a legally reviewed privacy policy.
 */

export const PRIVACY_VERSION = 1;

export const PRIVACY_CONTACT_EMAIL = 'arshvirsk26@gmail.com';

/** TODO(policy-url): replace with the hosted public policy page URL. */
export const PRIVACY_POLICY_URL: string | null = null;

/** Shown on the "What changed" prompt when PRIVACY_VERSION is bumped. */
export const PRIVACY_CHANGELOG: Record<number, string[]> = {
  1: ['First version: location use, replay sharing, retention and your controls.'],
};

export const PRIVACY_SHORT_VERSION = [
  'We use your location only while a game is live.',
  "Other players can't see where you are, except as the game allows.",
  'After a game, players can see routes only if you chose to share yours.',
  'Your routes are deleted after 30 days.',
  'Ghosts are optional and anonymous.',
  'You can export or delete everything.',
] as const;

export type ConsentType =
  | 'location'
  | 'policy_ack'
  | 'ghost'
  | 'leaderboard_name'
  | 'diagnostics';

export type PrivacySection = { title: string; body: string };

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    title: 'What we collect',
    body: 'Your display name and the email you sign in with. Your device location only while a game is in its head-start or live phase, including accuracy and speed. Game activity such as teams, tags, pings and events. Your privacy choices. Optional diagnostics only if you turn them on.',
  },
  {
    title: 'Why we collect it',
    body: 'To run the game fairly, enforce rules such as boundaries, tags and arrivals, show the map, and produce replays you can watch. Ghost routes and leaderboards only if you opt in.',
  },
  {
    title: 'Who can see what',
    body: 'During a game you and your teammates see each other live. Opponents see only what the rules allow, such as delayed pings. After a game, players see your route only if you chose to share it. The SOS button sends your last position to everyone in that game. The host sees nothing more than other players.',
  },
  {
    title: 'How long we keep it',
    body: 'Trails and events are deleted 30 days after a game. Live positions go with the game. Accounts stay until you delete them. Consent records are kept as proof of your choices until the account is deleted.',
  },
  {
    title: 'Services we use',
    body: 'Supabase (hosting and database). The map tile provider receives requests from your device, which can reveal the area you view and your IP. Expo/EAS is used only for building the app, not for collecting your data.',
  },
  {
    title: 'Safety, SOS and location',
    body: 'Location is collected only during live games. Play in public, safe places. SOS shares your last position with the players in that game.',
  },
  {
    title: 'Age and supervision',
    body: 'The app is for adults, or groups supervised by a guardian. We do not knowingly provide it to children without supervision.',
  },
  {
    title: 'Your rights and controls',
    body: `Change any choice at any time in Settings. Export your data. Delete your account and data. Questions or complaints: ${PRIVACY_CONTACT_EMAIL}.`,
  },
  {
    title: 'Changes to this policy',
    body: 'If we change the policy in a meaningful way, you will see a "What changed" screen and be asked to acknowledge the new version before continuing.',
  },
  {
    title: 'Contact',
    body: `Email ${PRIVACY_CONTACT_EMAIL}.`,
  },
];
