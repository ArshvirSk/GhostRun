/**
 * NF-24: Wear OS Companion Dispatcher & Listener
 */

import {
  WatchMessageType,
  WatchHudUpdatePayload,
  WatchHapticPulsePayload,
  WatchMessage,
  packWatchMessage,
  unpackWatchMessage,
  validateWatchCommand,
} from './wearOsProtocolCore';

export * from './wearOsProtocolCore';

let incomingCommandHandler: ((msg: WatchMessage) => void) | null = null;

export function registerWatchCommandHandler(handler: (msg: WatchMessage) => void): void {
  incomingCommandHandler = handler;
}

export function handleIncomingWatchData(rawJson: string): boolean {
  const res = unpackWatchMessage(rawJson);
  if (!res.valid || !res.message) return false;

  if (validateWatchCommand(res.message) && incomingCommandHandler) {
    incomingCommandHandler(res.message);
    return true;
  }
  return false;
}

export function createWatchHudPacket(payload: WatchHudUpdatePayload): string {
  return packWatchMessage('HUD_UPDATE', payload);
}

export function createWatchHapticPacket(payload: WatchHapticPulsePayload): string {
  return packWatchMessage('HAPTIC_PULSE', payload);
}
