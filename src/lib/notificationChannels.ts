export const STORAGE_KEY_SILENT_ALERTS = '@ghostrun:tactical_silent_alerts';

export interface ChannelSpec {
  id: string;
  name: string;
  description: string;
  sound: string | null;
  vibrationPattern: number[];
  importance: number; // 4 = HIGH, 3 = DEFAULT in Android
}

export const TACTICAL_CHANNELS: ChannelSpec[] = [
  {
    id: 'tactical-alerts',
    name: 'Tactical Radar & Ping Alerts',
    description: 'Silent vibration pulses for radar pings, heat sweeps, and boundary alerts.',
    sound: null,
    vibrationPattern: [0, 150, 100, 150],
    importance: 4, // AndroidImportance.HIGH
  },
  {
    id: 'match-events',
    name: 'Match Lifecycle & Phase Shifts',
    description: 'Tactile notification pulses for match start, countdowns, and end of round.',
    sound: null,
    vibrationPattern: [0, 300, 150, 300],
    importance: 4, // AndroidImportance.HIGH
  },
  {
    id: 'lobby-comms',
    name: 'Lobby & Tactical Comms',
    description: 'Notifications for friend lobby invites and sensor checks.',
    sound: null,
    vibrationPattern: [0, 100, 100, 100],
    importance: 3, // AndroidImportance.DEFAULT
  },
];
