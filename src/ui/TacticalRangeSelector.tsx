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

// 100m uniform steps from 200m to 2000m (strictly hard-capped at 2.0km)
const DIAL_STEPS = Array.from({ length: 19 }, (_, i) => 200 + i * 100);
const ITEM_WIDTH = 72;
const DIAL_HEIGHT = 44;
const SNAP_OFFSETS = DIAL_STEPS.map((_, i) => i * ITEM_WIDTH);

export function TacticalRangeSelector({
  radiusM,
  minRadiusM = 200,
  maxRadiusM = 2000,
  onChange,
  style,
}: TacticalRangeSelectorProps) {
  const { colors, isDark } = useTheme();
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const isInteractingRef = useRef(false);
  const [windowWidth, setWindowWidth] = useState(0);

  const clampedRadius = Math.max(minRadiusM, Math.min(maxRadiusM, radiusM));
  const diameterM = clampedRadius * 2;

  // Local index state for 120fps instant visual feedback without choking parent
  const initialIdx = DIAL_STEPS.findIndex((s) => s === clampedRadius);
  const [localIndex, setLocalIndex] = useState(initialIdx !== -1 ? initialIdx : 4);
  const localIndexRef = useRef(localIndex);
  localIndexRef.current = localIndex;

  const accentBg = isDark ? 'rgba(184, 163, 255, 0.18)' : 'rgba(102, 80, 164, 0.14)';
  const dialBg = isDark ? '#111318' : '#EAEDF2';
  const fadeEdgeColor = isDark ? '#111318' : '#EAEDF2';

  const formatDistance = (m: number) => {
    if (m >= 1000) {
      const km = m / 1000;
      return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)}km`;
    }
    return `${m}m`;
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== windowWidth) {
      setWindowWidth(w);
    }
  };

  // Sync scroll position when clampedRadius changes externally (and user is not dragging)
  useEffect(() => {
    if (isInteractingRef.current) return;
    const idx = DIAL_STEPS.findIndex((s) => s === clampedRadius);
    if (idx !== -1 && idx !== localIndexRef.current) {
      setLocalIndex(idx);
      if (windowWidth > 0) {
        scrollRef.current?.scrollTo({ x: idx * ITEM_WIDTH, animated: true });
      }
    }
  }, [clampedRadius, windowWidth]);

  // Initial center alignment when layout width is first known
  useEffect(() => {
    if (windowWidth > 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ x: localIndexRef.current * ITEM_WIDTH, animated: false });
    }
  }, [windowWidth]);

  // Snaps to the closest option based on distance and notifies parent
  const snapToClosest = (offsetX: number) => {
    const rawIdx = Math.round(offsetX / ITEM_WIDTH);
    const targetIdx = Math.max(0, Math.min(DIAL_STEPS.length - 1, rawIdx));

    setLocalIndex(targetIdx);
    scrollRef.current?.scrollTo({ x: targetIdx * ITEM_WIDTH, animated: true });

    if (DIAL_STEPS[targetIdx] !== clampedRadius) {
      triggerHaptic('buttonTap');
      onChange(DIAL_STEPS[targetIdx]);
    }
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const rawIdx = Math.round(offsetX / ITEM_WIDTH);
    const targetIdx = Math.max(0, Math.min(DIAL_STEPS.length - 1, rawIdx));

    if (targetIdx !== localIndexRef.current) {
      setLocalIndex(targetIdx);
      triggerHaptic('buttonTap');
    }
  };

  const handleScrollBeginDrag = () => {
    isInteractingRef.current = true;
  };

  const handleScrollEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // If low velocity or finger released gently, snap directly to closest
    const velocity = Math.abs(e.nativeEvent.velocity?.x ?? 0);
    if (velocity < 0.15) {
      isInteractingRef.current = false;
      snapToClosest(e.nativeEvent.contentOffset.x);
    }
  };

  const handleMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isInteractingRef.current = false;
    snapToClosest(e.nativeEvent.contentOffset.x);
  };

  const handleDecrement = () => {
    if (localIndex <= 0) return;
    triggerHaptic('buttonTap');
    const nextIdx = localIndex - 1;
    setLocalIndex(nextIdx);
    scrollRef.current?.scrollTo({ x: nextIdx * ITEM_WIDTH, animated: true });
    onChange(DIAL_STEPS[nextIdx]);
  };

  const handleIncrement = () => {
    if (localIndex >= DIAL_STEPS.length - 1) return;
    triggerHaptic('buttonTap');
    const nextIdx = localIndex + 1;
    setLocalIndex(nextIdx);
    scrollRef.current?.scrollTo({ x: nextIdx * ITEM_WIDTH, animated: true });
    onChange(DIAL_STEPS[nextIdx]);
  };

  const handleItemPress = (idx: number) => {
    triggerHaptic('buttonTap');
    setLocalIndex(idx);
    scrollRef.current?.scrollTo({ x: idx * ITEM_WIDTH, animated: true });
    onChange(DIAL_STEPS[idx]);
  };

  const canDecrement = localIndex > 0;
  const canIncrement = localIndex < DIAL_STEPS.length - 1;
  const paddingHorizontal = windowWidth > 0 ? (windowWidth - ITEM_WIDTH) / 2 : 100;

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
            {formatDistance(DIAL_STEPS[localIndex] || clampedRadius)}
          </Text>
          <Text style={[styles.readoutDiameter, { color: colors.textMuted }]}>
            {`Ø ${formatDistance((DIAL_STEPS[localIndex] || clampedRadius) * 2)}`}
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

        {/* Dial Tape Window with Reticle & Gradient Edge Fades */}
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

          {/* Stepped Swiping ScrollView with Fixed Snap Offsets & Momentum Snapping */}
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToOffsets={SNAP_OFFSETS}
            decelerationRate="fast"
            disableIntervalMomentum={true}
            scrollEventThrottle={16}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScroll={handleScroll}
            onScrollEndDrag={handleScrollEndDrag}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            contentContainerStyle={[
              styles.dialScrollContent,
              { paddingHorizontal },
            ]}
          >
            {DIAL_STEPS.map((step, idx) => {
              const isActive = idx === localIndex;
              return (
                <Pressable
                  key={step}
                  onPress={() => handleItemPress(idx)}
                  style={styles.dialItem}
                >
                  <Text
                    style={[
                      styles.dialItemText,
                      {
                        color: isActive ? colors.accent : colors.textMuted,
                        fontWeight: isActive ? '900' : '600',
                        fontSize: isActive ? 14 : 12,
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
    width: 34,
    zIndex: 3,
  },
  fadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 34,
    zIndex: 3,
  },
});
