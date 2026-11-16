import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  ViewStyle,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import { triggerHaptic } from '../motion/haptics';

export interface TacticalRangeSelectorProps {
  radiusM: number;
  minRadiusM?: number;
  maxRadiusM?: number;
  stepM?: number;
  onChange: (radius: number) => void;
  style?: ViewStyle;
}

// 100m uniform steps from 200m to 2000m (strictly hard capped at 2.0km)
const DIAL_STEPS = Array.from({ length: 19 }, (_, i) => 200 + i * 100);

const ITEM_WIDTH = 68;
const DIAL_HEIGHT = 42;

export function TacticalRangeSelector({
  radiusM,
  minRadiusM = 200,
  maxRadiusM = 2000,
  onChange,
  style,
}: TacticalRangeSelectorProps) {
  const { colors, isDark } = useTheme();
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const isDraggingRef = useRef(false);
  const [windowWidth, setWindowWidth] = useState(0);

  const clampedRadius = Math.max(minRadiusM, Math.min(maxRadiusM, radiusM));
  const diameterM = clampedRadius * 2;

  const currentIdx = DIAL_STEPS.findIndex((s) => s === clampedRadius);
  const activeIndex = currentIdx !== -1 ? currentIdx : 4; // default to 600m
  const lastSnappedIndexRef = useRef(activeIndex);

  const accentBg = isDark ? 'rgba(184, 163, 255, 0.16)' : 'rgba(102, 80, 164, 0.12)';
  const dialBg = isDark ? '#12141A' : '#ECEEF2';
  const fadeEdgeColor = isDark ? '#12141A' : '#ECEEF2';

  const formatDistance = (m: number) => {
    if (m >= 1000) {
      const km = m / 1000;
      return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)}km`;
    }
    return `${m}m`;
  };

  const handleDecrement = () => {
    if (activeIndex <= 0) return;
    triggerHaptic('buttonTap');
    const nextIdx = activeIndex - 1;
    const nextVal = DIAL_STEPS[nextIdx];
    lastSnappedIndexRef.current = nextIdx;
    onChange(nextVal);
    scrollRef.current?.scrollTo({ x: nextIdx * ITEM_WIDTH, animated: true });
  };

  const handleIncrement = () => {
    if (activeIndex >= DIAL_STEPS.length - 1) return;
    triggerHaptic('buttonTap');
    const nextIdx = activeIndex + 1;
    const nextVal = DIAL_STEPS[nextIdx];
    lastSnappedIndexRef.current = nextIdx;
    onChange(nextVal);
    scrollRef.current?.scrollTo({ x: nextIdx * ITEM_WIDTH, animated: true });
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== windowWidth) {
      setWindowWidth(w);
    }
  };

  // Sync scroll position when clampedRadius changes externally (e.g. from state change or initial load)
  useEffect(() => {
    if (isDraggingRef.current) return;
    if (windowWidth > 0 && scrollRef.current) {
      scrollRef.current.scrollTo({
        x: activeIndex * ITEM_WIDTH,
        animated: true,
      });
      lastSnappedIndexRef.current = activeIndex;
    }
  }, [activeIndex, windowWidth]);

  // Stepped "tick-tick" friction scrolling
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const rawIdx = Math.round(offsetX / ITEM_WIDTH);
    const targetIdx = Math.max(0, Math.min(DIAL_STEPS.length - 1, rawIdx));

    if (targetIdx !== lastSnappedIndexRef.current) {
      lastSnappedIndexRef.current = targetIdx;
      triggerHaptic('buttonTap');
      onChange(DIAL_STEPS[targetIdx]);
    }
  };

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isDraggingRef.current = false;
    const offsetX = e.nativeEvent.contentOffset.x;
    const rawIdx = Math.round(offsetX / ITEM_WIDTH);
    const targetIdx = Math.max(0, Math.min(DIAL_STEPS.length - 1, rawIdx));
    scrollRef.current?.scrollTo({
      x: targetIdx * ITEM_WIDTH,
      animated: true,
    });
  };

  const canDecrement = activeIndex > 0;
  const canIncrement = activeIndex < DIAL_STEPS.length - 1;
  const paddingHorizontal = windowWidth > 0 ? (windowWidth - ITEM_WIDTH) / 2 : 80;

  return (
    <View style={[styles.container, style]}>
      {/* Readout Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.labelGroup}>
          <Ionicons name="scan-outline" size={13} color={colors.accent} />
          <Text
            variant="label"
            style={{
              color: colors.textMuted,
              fontSize: 10,
              letterSpacing: 0.8,
              fontWeight: '800',
            }}
          >
            ARENA ZONE RADIUS
          </Text>
        </View>

        <View style={styles.readoutGroup}>
          <Text
            style={[
              styles.readoutMain,
              { color: colors.accent },
            ]}
          >
            {formatDistance(clampedRadius)}
          </Text>
          <Text style={[styles.readoutDiameter, { color: colors.textMuted }]}>
            {`Ø ${formatDistance(diameterM)}`}
          </Text>
        </View>
      </View>

      {/* Stepper Controls & Stepped Tick-Tick Dial */}
      <View style={styles.stepperRow}>
        {/* Decrement Button [-] */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease zone radius"
          disabled={!canDecrement}
          onPress={handleDecrement}
          style={({ pressed }) => [
            styles.stepButton,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
              opacity: canDecrement ? (pressed ? 0.75 : 1) : 0.35,
            },
          ]}
        >
          <Ionicons
            name="remove"
            size={18}
            color={canDecrement ? colors.text : colors.textMuted}
          />
        </Pressable>

        {/* Dial Tape Window with Weight, Friction, Reticle & Gradient Edges */}
        <View
          onLayout={handleLayout}
          style={[
            styles.dialWindow,
            {
              backgroundColor: dialBg,
              borderColor: colors.borderLight,
            },
          ]}
        >
          {/* Centered Active Reticle Pill */}
          {windowWidth > 0 && (
            <View
              pointerEvents="none"
              style={[
                styles.reticle,
                {
                  left: (windowWidth - ITEM_WIDTH) / 2,
                  width: ITEM_WIDTH,
                  backgroundColor: accentBg,
                  borderColor: colors.accent,
                },
              ]}
            />
          )}

          {/* Stepped Swiping ScrollView with Friction & Momentum Snapping */}
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={ITEM_WIDTH}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum={true}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              isDraggingRef.current = true;
            }}
            onScroll={handleScroll}
            onScrollEndDrag={handleScrollEnd}
            onMomentumScrollEnd={handleScrollEnd}
            contentContainerStyle={[
              styles.dialScrollContent,
              { paddingHorizontal },
            ]}
          >
            {DIAL_STEPS.map((step, idx) => {
              const isActive = idx === activeIndex;
              return (
                <Pressable
                  key={step}
                  onPress={() => {
                    triggerHaptic('buttonTap');
                    lastSnappedIndexRef.current = idx;
                    onChange(step);
                    scrollRef.current?.scrollTo({
                      x: idx * ITEM_WIDTH,
                      animated: true,
                    });
                  }}
                  style={styles.dialItem}
                >
                  <Text
                    style={[
                      styles.dialItemText,
                      {
                        color: isActive ? colors.accent : colors.textMuted,
                        fontWeight: isActive ? '900' : '600',
                        fontSize: isActive ? 14 : 11,
                      },
                    ]}
                  >
                    {formatDistance(step)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Left Gradient Edge (Fades toward [-] button) */}
          <LinearGradient
            colors={[fadeEdgeColor, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.fadeLeft}
            pointerEvents="none"
          />

          {/* Right Gradient Edge (Fades toward [+] button) */}
          <LinearGradient
            colors={['transparent', fadeEdgeColor]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.fadeRight}
            pointerEvents="none"
          />
        </View>

        {/* Increment Button [+] */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase zone radius"
          disabled={!canIncrement}
          onPress={handleIncrement}
          style={({ pressed }) => [
            styles.stepButton,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.border,
              opacity: canIncrement ? (pressed ? 0.75 : 1) : 0.35,
            },
          ]}
        >
          <Ionicons
            name="add"
            size={18}
            color={canIncrement ? colors.text : colors.textMuted}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  labelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  readoutGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  readoutMain: {
    fontFamily: 'Archivo-Black',
    fontSize: 15,
    fontWeight: '900',
  },
  readoutDiameter: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    fontWeight: '700',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialWindow: {
    flex: 1,
    height: DIAL_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  reticle: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: 9,
    borderWidth: 1.5,
    zIndex: 1,
  },
  dialScrollContent: {
    alignItems: 'center',
    height: DIAL_HEIGHT,
  },
  dialItem: {
    width: ITEM_WIDTH,
    height: DIAL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  dialItemText: {
    fontFamily: 'Archivo-Bold',
    textAlign: 'center',
  },
  fadeLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 32,
    zIndex: 3,
  },
  fadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 32,
    zIndex: 3,
  },
});
