import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { useTheme } from '../../theme/ThemeProvider';
import type { HudWidgetProps } from '../types';
import { selectTimerLabel, selectTimerValue } from '../selectors';
import { formatClock } from '../HudFrame';

interface SprintLayoutProps extends HudWidgetProps {
  onExitSprint: () => void;
  onOpenSos: () => void;
  primaryAction?: React.ReactNode;
}

export const SprintLayout = memo(function SprintLayout({
  state,
  serverNow,
  myRole,
  onExitSprint,
  onOpenSos,
  primaryAction,
}: SprintLayoutProps) {
  const { tokens } = useTheme();
  const timerValue = selectTimerValue(state, serverNow);
  const timerLabel = selectTimerLabel(state);

  const isRunner = myRole === 'runner';
  const roleColor = isRunner ? tokens.colors.accent : tokens.colors.danger;

  return (
    <View style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.badge}>
          <MaterialCommunityIcons color="#000000" name="run-fast" size={16} />
          <Text variant="mono" style={styles.badgeText}>
            SPRINT MODE
          </Text>
        </View>

        <Pressable
          accessibilityLabel="Exit Sprint Mode"
          accessibilityRole="button"
          onPress={onExitSprint}
          style={styles.exitButton}
        >
          <Ionicons color="#FFFFFF" name="close" size={20} />
          <Text variant="label" style={{ color: '#FFFFFF' }}>
            Standard View
          </Text>
        </Pressable>
      </View>

      {/* Oversized Critical HUD Data */}
      <View style={styles.centerBlock}>
        <Text variant="mono" style={styles.timerLabel}>
          {timerLabel}
        </Text>
        <Text variant="display" style={styles.giantTimer}>
          {timerValue !== null ? formatClock(timerValue) : '--:--'}
        </Text>

        <View style={[styles.roleIndicator, { borderColor: roleColor }]}>
          <Text variant="title" style={{ color: roleColor, fontWeight: '900' }}>
            {state.my_team.toUpperCase()} · {state.game.code}
          </Text>
        </View>

        {/* Direction cue / target proximity */}
        {state.target && isRunner && (
          <View style={styles.cueBox}>
            <Ionicons color="#00FF66" name="navigate" size={28} />
            <Text variant="title" style={{ color: '#FFFFFF' }}>
              TARGET ACTIVE
            </Text>
          </View>
        )}
      </View>

      {/* Primary Action Button (Giant) */}
      <View style={styles.bottomBar}>
        {primaryAction ? (
          <View style={styles.primaryActionSlot}>{primaryAction}</View>
        ) : (
          <View style={styles.infoPill}>
            <Text variant="title" style={{ color: '#FFFFFF' }}>
              KEEP MOVING
            </Text>
          </View>
        )}

        {/* SOS Emergency Button */}
        <Pressable
          accessibilityLabel="Emergency SOS"
          accessibilityRole="button"
          onPress={onOpenSos}
          style={styles.sosButton}
        >
          <Ionicons color="#FFFFFF" name="alert-circle" size={20} />
          <Text variant="label" style={styles.sosText}>
            SOS
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#050709',
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 30,
    justifyContent: 'space-between',
    zIndex: 50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#3DFFA2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#000000',
  },
  exitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  timerLabel: {
    fontSize: 16,
    letterSpacing: 2,
    color: '#94A3B8',
    fontWeight: '700',
  },
  giantTimer: {
    fontSize: 72,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  roleIndicator: {
    borderWidth: 2,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cueBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1E293B',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 16,
    marginTop: 10,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  primaryActionSlot: {
    flex: 1,
  },
  infoPill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  sosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#DC2626',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderRadius: 16,
  },
  sosText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
  },
});
