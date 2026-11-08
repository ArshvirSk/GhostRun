import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { triggerHaptic } from '../motion/haptics';

export interface SegmentItem {
  id: string;
  label: string;
  badge?: string | number;
}

export interface SegmentBarProps {
  items: SegmentItem[];
  selectedId?: string;
  activeId?: string;
  onSelect?: (id: string) => void;
  onChange?: (id: string) => void;
  style?: ViewStyle;
}

export function SegmentBar({
  items,
  selectedId,
  activeId,
  onSelect,
  onChange,
  style,
}: SegmentBarProps) {
  const { colors, radii } = useTheme();
  const currentSelected = activeId ?? selectedId ?? items[0]?.id;

  const handleSelect = (id: string) => {
    onSelect?.(id);
    onChange?.(id);
  };

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.borderDark,
          borderRadius: radii.pill,
        },
        style,
      ]}
    >
      {items.map((item) => {
        const isSelected = item.id === currentSelected;

        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            onPress={() => {
              if (item.id !== currentSelected) {
                triggerHaptic('buttonTap');
                handleSelect(item.id);
              }
            }}
            style={[
              styles.segment,
              {
                backgroundColor: isSelected ? colors.surface : 'transparent',
                borderRadius: radii.pill,
                borderColor: isSelected ? colors.border : 'transparent',
                borderWidth: isSelected ? 1 : 0,
              },
            ]}
          >
            <Text
              variant="label"
              style={{
                color: isSelected ? colors.accent : colors.textMuted,
                fontWeight: isSelected ? '800' : '600',
                letterSpacing: 0.8,
              }}
            >
              {item.label}
            </Text>
            {item.badge !== undefined && (
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: isSelected ? colors.accent : colors.surfaceMuted,
                    borderRadius: radii.full,
                  },
                ]}
              >
                <Text
                  variant="caption"
                  style={{
                    color: isSelected ? colors.successText : colors.textMuted,
                    fontSize: 9,
                    fontWeight: '900',
                  }}
                >
                  {String(item.badge)}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderWidth: 1,
    gap: 4,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 38,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
