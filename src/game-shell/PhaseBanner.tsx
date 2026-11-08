import React, { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../ui/Text';
import { useTheme } from '../theme/ThemeProvider';
import { colors } from '../theme/tokens';
import type { RoundState, ShellActions } from './types';
import {
  selectCurfewRemainingS,
  selectIsPaused,
  selectSafetyState,
} from './selectors';
import { formatClock } from './HudFrame';

interface PhaseBannerProps {
  state: RoundState;
  actions: ShellActions;
  serverNow: number;
  isOutOfBounds: boolean;
  remainingGraceS: number;
  vehicleWarning?: boolean;
}

export const PhaseBanner = memo(function PhaseBanner({
  state,
  actions,
  serverNow,
  isOutOfBounds,
  remainingGraceS,
  vehicleWarning,
}: PhaseBannerProps) {
  const { tokens } = useTheme();
  const [resuming, setResuming] = React.useState(false);
  const isPaused = selectIsPaused(state);
  const safety = selectSafetyState(state);
  const curfewRemainingS = selectCurfewRemainingS(state, serverNow);

  const handleResume = async () => {
    setResuming(true);
    await actions.resumeGame();
    setResuming(false);
  };

  if (isPaused) {
    const isSos = safety?.pause_reason === 'emergency_sos';
    return (
      <View
        style={[
          styles.banner,
          styles.pausedBanner,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.warning,
            borderRadius: tokens.radii.card,
          },
        ]}
      >
        <View style={styles.bannerHeader}>
          <MaterialCommunityIcons
            color={tokens.colors.warning}
            name="pause-circle"
            size={24}
          />
          <Text variant="title" style={{ color: tokens.colors.warning }}>
            {isSos ? 'EMERGENCY SOS ACTIVE' : 'GAME PAUSED'}
          </Text>
        </View>
        <Text variant="body" style={styles.bannerBody}>
          Paused by {safety?.paused_by_name || 'a player'} (
          {safety?.pause_reason || 'Safety Pause'}). Timers are frozen.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={resuming}
          onPress={handleResume}
          style={[styles.resumeButton, { backgroundColor: tokens.colors.primary }]}
        >
          {resuming ? (
            <ActivityIndicator color={colors.textLight} size="small" />
          ) : (
            <Text variant="label" style={styles.resumeText}>
              ▶ Resume Game
            </Text>
          )}
        </Pressable>
      </View>
    );
  }

  if (vehicleWarning) {
    return (
      <View
        style={[
          styles.banner,
          styles.vehicleBanner,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.danger,
            borderRadius: tokens.radii.card,
          },
        ]}
      >
        <MaterialCommunityIcons color={tokens.colors.danger} name="speedometer-slow" size={20} />
        <Text variant="label" style={{ color: tokens.colors.danger, flex: 1 }}>
          SPEED WARNING: Vehicle speed detected (&gt;8 m/s). GhostRun is on-foot!
        </Text>
      </View>
    );
  }

  if (isOutOfBounds) {
    return (
      <View
        style={[
          styles.banner,
          styles.outOfBoundsBanner,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.danger,
            borderRadius: tokens.radii.card,
          },
        ]}
      >
        <Ionicons color={tokens.colors.danger} name="warning" size={20} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" style={{ color: tokens.colors.danger }}>
            {remainingGraceS > 0
              ? `OUT OF BOUNDS (${remainingGraceS}s grace)`
              : 'BOUNDARY GRACE EXPIRED'}
          </Text>
          <Text variant="body" style={{ color: tokens.colors.textMuted, fontSize: 11 }}>
            {remainingGraceS > 0
              ? 'Return to the active play boundary immediately.'
              : 'Your coordinates may be exposed as an extra radar ping.'}
          </Text>
        </View>
      </View>
    );
  }

  if (curfewRemainingS !== null && curfewRemainingS <= 300) {
    return (
      <View
        style={[
          styles.banner,
          styles.curfewBanner,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.warning,
            borderRadius: tokens.radii.card,
          },
        ]}
      >
        <Ionicons color={tokens.colors.warning} name="moon" size={18} />
        <Text variant="label" style={{ color: tokens.colors.warning }}>
          CURFEW APPROACHING: {formatClock(curfewRemainingS)} remaining until auto-end.
        </Text>
      </View>
    );
  }

  return null;
});

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 15,
    shadowColor: colors.backgroundDark,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  pausedBanner: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerBody: {
    fontSize: 12,
    color: colors.textMuted,
  },
  resumeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 4,
  },
  resumeText: {
    color: colors.textLight,
    fontWeight: '700',
  },
  vehicleBanner: {},
  outOfBoundsBanner: {},
  curfewBanner: {},
});
