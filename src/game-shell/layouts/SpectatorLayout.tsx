import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { useTheme } from '../../theme/ThemeProvider';
import type { HudWidgetProps } from '../types';

interface SpectatorLayoutProps extends HudWidgetProps {
  topWidgets: React.ReactNode;
  bannerWidgets: React.ReactNode;
  overlayWidgets: React.ReactNode;
  sheetWidgets: React.ReactNode;
}

export const SpectatorLayout = memo(function SpectatorLayout({
  topWidgets,
  bannerWidgets,
  overlayWidgets,
  sheetWidgets,
}: SpectatorLayoutProps) {
  const { tokens } = useTheme();

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Top Slot */}
      {topWidgets}

      {/* Spectator Status Banner */}
      <View pointerEvents="box-none" style={styles.bannerContainer}>
        <View
          style={[
            styles.spectatorBanner,
            {
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.border,
              borderRadius: tokens.radii.card,
              shadowColor: tokens.colors.backgroundDark,
            },
          ]}
        >
          <MaterialCommunityIcons color={tokens.colors.danger} name="ghost" size={20} />
          <View style={{ flex: 1 }}>
            <Text variant="label" style={{ color: tokens.colors.danger }}>
              SPECTATOR CHANNEL ACTIVE
            </Text>
            <Text variant="body" style={{ color: tokens.colors.textMuted, fontSize: 11 }}>
              You were tagged or are observing. Live match updates are active.
            </Text>
          </View>
        </View>

        {bannerWidgets}
      </View>

      {/* Overlay Slot */}
      {overlayWidgets}

      {/* Sheet Slot */}
      {sheetWidgets}
    </View>
  );
});

const styles = StyleSheet.create({
  bannerContainer: {
    position: 'absolute',
    top: 130,
    left: 0,
    right: 0,
    zIndex: 18,
    gap: 8,
  },
  spectatorBanner: {
    marginHorizontal: 16,
    padding: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
});
