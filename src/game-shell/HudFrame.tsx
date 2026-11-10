import React, { memo } from 'react';
import {
  LayoutAnimation,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../ui/Text';
import { useTheme } from '../theme/ThemeProvider';
import { colors } from '../theme/tokens';
import type { RoundState } from './types';
import {
  selectNextPingIn,
  selectRunnersRemaining,
  selectTimerLabel,
  selectTimerValue,
} from './selectors';

export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

interface HudFrameProps {
  state: RoundState;
  serverNow: number;
  isCompact: boolean;
  onToggleCompact: () => void;
  muted: boolean;
  onToggleMute: () => void;
  sfxMuted: boolean;
  onToggleSfx: () => void;
  extraChips?: React.ReactNode;
}

export const HudFrame = memo(function HudFrame({
  state,
  serverNow,
  isCompact,
  onToggleCompact,
  muted,
  onToggleMute,
  sfxMuted,
  onToggleSfx,
  extraChips,
}: HudFrameProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const timerValue = selectTimerValue(state, serverNow);
  const timerLabel = selectTimerLabel(state);
  const nextPingIn = selectNextPingIn(state, serverNow);
  const runnersRemaining = selectRunnersRemaining(state);

  const phase = state.game.status;
  const isLive = phase === 'live';

  const accent =
    state.my_team === 'runner'
      ? tokens.colors.accent
      : state.my_team === 'hunter'
        ? tokens.colors.danger
        : tokens.colors.primary;

  const eyebrow = `${state.game.status.toUpperCase()} · ${state.my_team.toUpperCase()}`;

  return (
    <Pressable
      accessibilityLabel={isCompact ? 'Expand round details' : 'Minimize round details'}
      accessibilityRole="button"
      onPress={() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        onToggleCompact();
      }}
      style={[
        styles.hud,
        {
          top: Math.max(insets.top, 16) + 8,
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.card,
        },
        isCompact && styles.hudCompact,
      ]}
    >
      {isCompact ? (
        <View style={styles.compactRow}>
          <View style={styles.compactLeft}>
            <View style={[styles.statusDot, { backgroundColor: accent }]} />
            <Text variant="mono" style={styles.compactEyebrow}>
              {eyebrow}
            </Text>
            {timerValue !== null && phase !== 'ended' && phase !== 'cancelled' && (
              <Text variant="numeric" style={[styles.compactTimer, { color: tokens.colors.text }]}>
                {formatClock(timerValue)}
              </Text>
            )}
          </View>

          <View style={styles.compactRight}>
            {extraChips ? (
              extraChips
            ) : (
              <>
                {isLive && nextPingIn !== null && (
                  <View style={[styles.chip, { backgroundColor: tokens.colors.surfaceAlt }]}>
                    <Text variant="label" style={styles.chipLabel}>
                      PING
                    </Text>
                    <Text variant="numeric" style={styles.chipValue}>
                      {formatClock(nextPingIn)}
                    </Text>
                  </View>
                )}
                {isLive && (
                  <View style={[styles.chip, { backgroundColor: tokens.colors.surfaceAlt }]}>
                    <Text variant="label" style={styles.chipLabel}>
                      RUNNERS
                    </Text>
                    <Text variant="numeric" style={styles.chipValue}>
                      {runnersRemaining}
                    </Text>
                  </View>
                )}
              </>
            )}

            <Pressable
              accessibilityLabel={muted ? 'Unmute alerts' : 'Mute alerts'}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onToggleMute}
              style={styles.iconButton}
            >
              <Ionicons
                color={muted ? tokens.colors.textMuted : tokens.colors.primary}
                name={muted ? 'notifications-off' : 'notifications'}
                size={16}
              />
            </Pressable>
            <Text variant="label" style={{ color: tokens.colors.textMuted }}>
              ▾
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.expandedContent}>
          <View style={styles.expandedHeaderRow}>
            <Text variant="mono" style={[styles.expandedEyebrow, { color: accent }]}>
              {eyebrow} · {state.game.code}
            </Text>
            <View style={styles.headerControls}>
              <Pressable
                accessibilityLabel={sfxMuted ? 'Unmute SFX' : 'Mute SFX'}
                accessibilityRole="button"
                onPress={onToggleSfx}
                style={[styles.togglePill, { backgroundColor: tokens.colors.surfaceAlt }]}
              >
                <Ionicons
                  color={sfxMuted ? tokens.colors.textMuted : tokens.colors.primary}
                  name={sfxMuted ? 'volume-mute' : 'volume-high'}
                  size={14}
                />
                <Text variant="label" style={styles.toggleText}>
                  {sfxMuted ? 'SFX Off' : 'SFX On'}
                </Text>
              </Pressable>

              <Pressable
                accessibilityLabel={muted ? 'Unmute alerts' : 'Mute alerts'}
                accessibilityRole="button"
                onPress={onToggleMute}
                style={[styles.togglePill, { backgroundColor: tokens.colors.surfaceAlt }]}
              >
                <Ionicons
                  color={muted ? tokens.colors.textMuted : tokens.colors.primary}
                  name={muted ? 'notifications-off' : 'notifications'}
                  size={14}
                />
                <Text variant="label" style={styles.toggleText}>
                  {muted ? 'Muted' : 'Alerts'}
                </Text>
              </Pressable>
              <Text variant="label" style={{ color: tokens.colors.textMuted }}>
                ▴
              </Text>
            </View>
          </View>

          <View style={styles.statsGrid}>
            {timerValue !== null && phase !== 'ended' && phase !== 'cancelled' && (
              <View style={styles.statBox}>
                <Text variant="label" style={{ color: tokens.colors.textMuted }}>
                  {timerLabel}
                </Text>
                <Text variant="display" style={{ color: tokens.colors.text }}>
                  {formatClock(timerValue)}
                </Text>
              </View>
            )}

            {isLive && nextPingIn !== null && (
              <View style={styles.statBox}>
                <Text variant="label" style={{ color: tokens.colors.textMuted }}>
                  NEXT PING
                </Text>
                <Text variant="title" style={{ color: tokens.colors.primary }}>
                  {formatClock(nextPingIn)}
                </Text>
              </View>
            )}

            {isLive && (
              <View style={styles.statBox}>
                <Text variant="label" style={{ color: tokens.colors.textMuted }}>
                  RUNNERS
                </Text>
                <Text variant="title" style={{ color: tokens.colors.accent }}>
                  {runnersRemaining}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  hud: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: colors.backgroundDark,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  hudCompact: {
    paddingVertical: 8,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  compactEyebrow: {
    fontSize: 11,
    letterSpacing: 0.5,
  },
  compactTimer: {
    fontSize: 14,
    fontWeight: '700',
  },
  compactRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipLabel: {
    fontSize: 9,
    color: colors.textMuted,
  },
  chipValue: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textLight,
  },
  iconButton: {
    padding: 4,
  },
  expandedContent: {
    gap: 12,
  },
  expandedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expandedEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  togglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  toggleText: {
    fontSize: 10,
    color: colors.textMuted,
  },
  statsGrid: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 20,
    paddingTop: 4,
  },
  statBox: {
    gap: 2,
  },
});
