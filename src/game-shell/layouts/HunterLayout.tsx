import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { HudWidgetProps } from '../types';

interface HunterLayoutProps extends HudWidgetProps {
  topWidgets: React.ReactNode;
  bannerWidgets: React.ReactNode;
  actionWidgets: React.ReactNode[];
  overlayWidgets: React.ReactNode;
  sheetWidgets: React.ReactNode;
}

export const HunterLayout = memo(function HunterLayout({
  topWidgets,
  bannerWidgets,
  actionWidgets,
  overlayWidgets,
  sheetWidgets,
}: HunterLayoutProps) {
  const { tokens } = useTheme();

  // Enforce max 3 actions in hunter bar
  const visibleActions = actionWidgets.slice(0, 3);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Top Slot */}
      {topWidgets}

      {/* Banner Slot */}
      <View pointerEvents="box-none" style={styles.bannerContainer}>
        {bannerWidgets}
      </View>

      {/* Overlay Slot */}
      {overlayWidgets}

      {/* Hunter Floating Action Bar (Max 3 buttons) */}
      {visibleActions.length > 0 && (
        <View pointerEvents="box-none" style={styles.actionBar}>
          <View
            style={[
              styles.actionsPill,
              {
                backgroundColor: tokens.colors.surface,
                borderColor: tokens.colors.danger,
                borderRadius: tokens.radii.card,
                shadowColor: tokens.colors.backgroundDark,
              },
            ]}
          >
            {visibleActions.map((action, i) => (
              <React.Fragment key={i}>{action}</React.Fragment>
            ))}
          </View>
        </View>
      )}

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
  },
  actionBar: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
    zIndex: 25,
    alignItems: 'center',
  },
  actionsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
});
