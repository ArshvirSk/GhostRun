import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  PanResponder,
  ViewStyle,
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
const ITEM_WIDTH = 76;
const DIAL_HEIGHT = 44;

export function TacticalRangeSelector({
  radiusM,
  minRadiusM = 200,
  maxRadiusM = 2000,
  onChange,
  style,
}: TacticalRangeSelectorProps) {
  const { colors, isDark } = useTheme();
  const [windowWidth, setWindowWidth] = useState(0);

  const clampedRadius = Math.max(minRadiusM, Math.min(maxRadiusM, radiusM));
  const initialIdx = DIAL_STEPS.findIndex((s) => s === clampedRadius);
  const safeInitialIdx = initialIdx !== -1 ? initialIdx : 4; // default to 600m

  const currentIndexRef = useRef(safeInitialIdx);
  const [displayIndex, setDisplayIndex] = useState(safeInitialIdx);

  const animX = useRef(new Animated.Value(0)).current;
  const isDraggingRef = useRef(false);
  const dragStartOffsetRef = useRef(0);
  const windowWidthRef = useRef(0);

  const accentBg = isDark ? 'rgba(184, 163, 255, 0.20)' : 'rgba(102, 80, 164, 0.16)';
  const dialBg = isDark ? '#111318' : '#EAEDF2';
  const fadeEdgeColor = isDark ? '#111318' : '#EAEDF2';

  const formatDistance = (m: number) => {
    if (m >= 1000) {
      const km = m / 1000;
      return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)}km`;
    }
    return `${m}m`;
  };

  // Calculates exact translateX so item at index `idx` is dead-center in the window
  const getOffsetForIndex = useCallback(
    (idx: number, w: number = windowWidthRef.current) => {
      if (w <= 0) return 0;
      const centerPadding = (w - ITEM_WIDTH) / 2;
      return centerPadding - idx * ITEM_WIDTH;
    },
    []
  );

  // Smoothly spring to a target index with tactile feedback
  const snapToIndex = useCallback(
    (idx: number, notify = true, animated = true) => {
      const clamped = Math.max(0, Math.min(DIAL_STEPS.length - 1, idx));
      currentIndexRef.current = clamped;
      setDisplayIndex(clamped);

      const targetX = getOffsetForIndex(clamped);
      if (animated) {
        Animated.spring(animX, {
          toValue: targetX,
          friction: 9,
          tension: 85,
          useNativeDriver: true,
        }).start();
      } else {
        animX.setValue(targetX);
      }

      if (notify && DIAL_STEPS[clamped] !== clampedRadius) {
        triggerHaptic('buttonTap');
        onChange(DIAL_STEPS[clamped]);
      }
    },
    [animX, clampedRadius, getOffsetForIndex, onChange]
  );

  const snapToIndexRef = useRef(snapToIndex);
  snapToIndexRef.current = snapToIndex;

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) {
      windowWidthRef.current = w;
      if (w !== windowWidth) {
        setWindowWidth(w);
        const targetX = (w - ITEM_WIDTH) / 2 - currentIndexRef.current * ITEM_WIDTH;
        animX.setValue(targetX);
      }
    }
  };

  // Sync with external radius changes (when not dragging)
  useEffect(() => {
    if (isDraggingRef.current) return;
    const idx = DIAL_STEPS.findIndex((s) => s === clampedRadius);
    if (idx !== -1 && idx !== currentIndexRef.current) {
      snapToIndex(idx, false, true);
    }
  }, [clampedRadius, snapToIndex]);

  // PanResponder for 120fps direct finger tracking, auto-snapping & anti-stuck physics
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4,
      onPanResponderGrant: () => {
        isDraggingRef.current = true;
        animX.stopAnimation((currentVal) => {
          dragStartOffsetRef.current = currentVal;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const w = windowWidthRef.current;
        if (w <= 0) return;
        const centerPadding = (w - ITEM_WIDTH) / 2;
        let newOffset = dragStartOffsetRef.current + gesture.dx;

        // Over-scroll boundary resistance
        const minOffset = centerPadding - (DIAL_STEPS.length - 1) * ITEM_WIDTH;
        const maxOffset = centerPadding;
        if (newOffset > maxOffset) {
          newOffset = maxOffset + (newOffset - maxOffset) * 0.25;
        } else if (newOffset < minOffset) {
          newOffset = minOffset + (newOffset - minOffset) * 0.25;
        }

        animX.setValue(newOffset);

        // Calculate current closest index for header & haptic ticks
        const rawIdx = Math.round((centerPadding - newOffset) / ITEM_WIDTH);
        const clamped = Math.max(0, Math.min(DIAL_STEPS.length - 1, rawIdx));
        if (clamped !== currentIndexRef.current) {
          currentIndexRef.current = clamped;
          setDisplayIndex(clamped);
          triggerHaptic('buttonTap');
        }
      },
      onPanResponderRelease: (_, gesture) => {
        isDraggingRef.current = false;
        const w = windowWidthRef.current;
        if (w <= 0) return;

        const centerPadding = (w - ITEM_WIDTH) / 2;
        // Include flick velocity to feel natural and weighted
        const projectedOffset =
          dragStartOffsetRef.current + gesture.dx + gesture.vx * 30;

        // Snaps to the closest size based on distance
        const targetIdx = Math.round((centerPadding - projectedOffset) / ITEM_WIDTH);
        const finalIdx = Math.max(0, Math.min(DIAL_STEPS.length - 1, targetIdx));

        snapToIndexRef.current(finalIdx, true, true);
      },
      onPanResponderTerminate: () => {
        isDraggingRef.current = false;
        snapToIndexRef.current(currentIndexRef.current, true, true);
      },
    })
  ).current;

  const handleDecrement = () => {
    if (currentIndexRef.current <= 0) return;
    snapToIndex(currentIndexRef.current - 1, true, true);
  };

  const handleIncrement = () => {
    if (currentIndexRef.current >= DIAL_STEPS.length - 1) return;
    snapToIndex(currentIndexRef.current + 1, true, true);
  };

  const canDecrement = displayIndex > 0;
  const canIncrement = displayIndex < DIAL_STEPS.length - 1;
  const currentRadius = DIAL_STEPS[displayIndex] || clampedRadius;

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
            {formatDistance(currentRadius)}
          </Text>
          <Text style={[styles.readoutDiameter, { color: colors.textMuted }]}>
            {`Ø ${formatDistance(currentRadius * 2)}`}
          </Text>
        </View>
      </View>

      {/* Stepper Controls & Continuous Spring Dial Tape */}
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

        {/* Dial Tape Window with Reticle, Gradients & Direct Finger Tracking */}
        <View
          onLayout={handleLayout}
          style={[
            styles.dialWindow,
            {
              backgroundColor: dialBg,
              borderColor: colors.borderLight,
            },
          ]}
          {...panResponder.panHandlers}
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

          {/* Stepped Track with 120fps Native Spring Translation */}
          <Animated.View
            style={[
              styles.dialTrack,
              {
                transform: [{ translateX: animX }],
              },
            ]}
          >
            {DIAL_STEPS.map((step, idx) => {
              const isActive = idx === displayIndex;
              return (
                <Pressable
                  key={step}
                  onPress={() => snapToIndex(idx, true, true)}
                  style={styles.dialItem}
                  hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
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
          </Animated.View>

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
  dialTrack: {
    flexDirection: 'row',
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
    width: 36,
    zIndex: 3,
  },
  fadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 36,
    zIndex: 3,
  },
});
