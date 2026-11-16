import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
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

  const [containerWidth, setContainerWidth] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === currentSelected)
  );

  const itemWidth = containerWidth > 8 ? (containerWidth - 8) / items.length : 0;

  useEffect(() => {
    if (itemWidth > 0) {
      Animated.spring(slideAnim, {
        toValue: selectedIndex * itemWidth + 4,
        friction: 8,
        tension: 75,
        useNativeDriver: true,
      }).start();
    }
  }, [selectedIndex, itemWidth, slideAnim]);

  const handleSelect = (id: string) => {
    onSelect?.(id);
    onChange?.(id);
  };

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
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
      {/* Sliding Active Pill Background */}
      {itemWidth > 0 && (
        <Animated.View
          style={[
            styles.sliderPill,
            {
              width: itemWidth,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.pill,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        />
      )}

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
            style={[styles.segment, { zIndex: 2 }]}
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
                  {item.badge}
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
    padding: 4,
    borderWidth: 1,
    position: 'relative',
    height: 48,
    alignItems: 'center',
  },
  sliderPill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderWidth: 1,
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  segment: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: 'transparent',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
});
