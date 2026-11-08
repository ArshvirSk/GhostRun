import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../ui/Text';
import { useTheme } from '../../theme/ThemeProvider';
import type { HudWidgetProps } from '../types';

interface OperatorLayoutProps extends HudWidgetProps {
  topWidgets: React.ReactNode;
  bannerWidgets: React.ReactNode;
  actionWidgets: React.ReactNode[];
  overlayWidgets: React.ReactNode;
  sheetWidgets: React.ReactNode;
}

export const OperatorLayout = memo(function OperatorLayout({
  topWidgets,
  bannerWidgets,
  actionWidgets,
  overlayWidgets,
  sheetWidgets,
}: OperatorLayoutProps) {
  const { tokens } = useTheme();
  const visibleActions = actionWidgets.slice(0, 3);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Top Slot */}
      {topWidgets}

      {/* Operator Status Banner */}
      <View pointerEvents="box-none" style={styles.bannerContainer}>
        <View
          style={[
            styles.operatorBanner,
            {
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.accent,
              borderRadius: tokens.radii.card,
            },
          ]}
        >
          <Ionicons color={tokens.colors.accent} name="radio" size={18} />
          <View style={{ flex: 1 }}>
            <Text variant="label" style={{ color: tokens.colors.accent }}>
              TACTICAL OPERATOR CONSOLE
            </Text>
            <Text variant="body" style={{ color: tokens.colors.textMuted, fontSize: 11 }}>
              Remote coordinator. GPS tracking bypassed. Tag immunity active.
            </Text>
          </View>
        </View>

        {bannerWidgets}
      </View>

      {/* Overlay Slot */}
      {overlayWidgets}

      {/* Operator Action Bar */}
      {visibleActions.length > 0 && (
        <View pointerEvents="box-none" style={styles.actionBar}>
          <View
            style={[
              styles.actionsPill,
              {
                backgroundColor: tokens.colors.surface,
                borderColor: tokens.colors.accent,
                borderRadius: tokens.radii.card,
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
    gap: 8,
  },
  operatorBanner: {
    marginHorizontal: 16,
    padding: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
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
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
});
