import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

export type SoundName =
  | 'ping'
  | 'heat_hot'
  | 'heat_cold'
  | 'tag'
  | 'whisper'
  | 'victory'
  | 'defeat'
  | 'countdown'
  | 'scan_success';

const STORAGE_KEY_MUTED = '@ghostrun:sfx_muted';

let isMutedState: boolean = false;
let isInitialized: boolean = false;

const SOUND_SOURCES: Record<SoundName, any> = {
  ping: require('../../assets/sounds/ping.wav'),
  heat_hot: require('../../assets/sounds/heat_hot.wav'),
  heat_cold: require('../../assets/sounds/heat_cold.wav'),
  tag: require('../../assets/sounds/tag.wav'),
  whisper: require('../../assets/sounds/whisper.wav'),
  victory: require('../../assets/sounds/victory.wav'),
  defeat: require('../../assets/sounds/defeat.wav'),
  countdown: require('../../assets/sounds/countdown.wav'),
  scan_success: require('../../assets/sounds/scan_success.wav'),
};

const players: Partial<Record<SoundName, AudioPlayer>> = {};

/** Initializes mute state from storage. */
export async function initAudio(): Promise<boolean> {
  if (isInitialized) return isMutedState;
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_MUTED);
    isMutedState = stored === 'true';
    isInitialized = true;
  } catch {
    isMutedState = false;
  }
  return isMutedState;
}

/** Returns whether audio SFX are currently muted. */
export function isAudioMuted(): boolean {
  return isMutedState;
}

/** Sets master audio SFX mute state. */
export async function setAudioMuted(muted: boolean): Promise<void> {
  isMutedState = muted;
  try {
    await AsyncStorage.setItem(STORAGE_KEY_MUTED, muted ? 'true' : 'false');
  } catch {
    // Ignore storage errors
  }
}

/** Toggles audio SFX mute state. */
export async function toggleAudioMuted(): Promise<boolean> {
  const next = !isMutedState;
  await setAudioMuted(next);
  return next;
}

/** Plays the specified sound effect if SFX are not muted. */
export function playSound(name: SoundName): void {
  if (isMutedState) return;

  try {
    let player = players[name];
    if (!player) {
      player = createAudioPlayer(SOUND_SOURCES[name]);
      players[name] = player;
    } else {
      player.seekTo(0);
    }
    player.play();
  } catch (err) {
    // Graceful degradation on unsupported audio environments
    if (__DEV__) {
      console.warn(`[audio] Failed to play sound "${name}":`, err);
    }
  }
}
