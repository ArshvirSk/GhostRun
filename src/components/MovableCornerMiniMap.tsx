import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { triggerHaptic } from '../motion/haptics';
import {
  getClosestCorner,
  getCornerCoordinates,
  MINIMAP_WIDTH,
  MINIMAP_HEIGHT,
  MINIMAP_MARGIN_H,
  STORAGE_KEY_MINIMAP_CORNER,
  STORAGE_KEY_MINIMAP_ENABLED,
  type MiniMapCorner,
} from '../lib/minimapCore';

export {
  getClosestCorner,
  getCornerCoordinates,
  MINIMAP_WIDTH,
  MINIMAP_HEIGHT,
  MINIMAP_MARGIN_H,
  STORAGE_KEY_MINIMAP_CORNER,
  STORAGE_KEY_MINIMAP_ENABLED,
  type MiniMapCorner,
};

interface MovableCornerMiniMapProps {
  children: React.ReactNode;
  initialCorner?: MiniMapCorner;
  borderColor?: string;
  backgroundColor?: string;
  onCornerChange?: (corner: MiniMapCorner) => void;
  style?: ViewStyle;
}

export function MovableCornerMiniMap({
  children,
  initialCorner = 'top-right',
  borderColor = '#00F0FF',
  backgroundColor = '#0B0F17',
  onCornerChange,
  style,
}: MovableCornerMiniMapProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [activeCorner, setActiveCorner] = useState<MiniMapCorner>(initialCorner);
  const [isDragging, setIsDragging] = useState(false);

  const initialCoord = getCornerCoordinates(
    initialCorner,
    screenWidth,
    screenHeight,
    insets.top,
    insets.bottom,
  );

  const pan = useRef(new Animated.ValueXY(initialCoord)).current;
  const activeCoordRef = useRef<{ x: number; y: number }>(initialCoord);

  // Sync initial coordinate on mount and load user preference
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY_MINIMAP_CORNER);
        if (
          saved &&
          (saved === 'top-left' ||
            saved === 'top-right' ||
            saved === 'bottom-left' ||
            saved === 'bottom-right')
        ) {
          if (!mounted) return;
          const corner = saved as MiniMapCorner;
          setActiveCorner(corner);
          const coord = getCornerCoordinates(
            corner,
            screenWidth,
            screenHeight,
            insets.top,
            insets.bottom,
          );
          activeCoordRef.current = coord;
          pan.setValue(coord);
        }
      } catch {
        // Fall back to initialCoord
      }
    })();
    return () => {
      mounted = false;
    };
  }, [insets.bottom, insets.top, pan, screenHeight, screenWidth]);

  // PanResponder to track dragging & snap to 4 corners only
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => {
        return Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3;
      },
      onPanResponderGrant: () => {
        setIsDragging(true);
        triggerHaptic('buttonTap');
        pan.setOffset({
          x: activeCoordRef.current.x,
          y: activeCoordRef.current.y,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_, gesture) => {
        setIsDragging(false);
        pan.flattenOffset();
        const rawX = activeCoordRef.current.x + gesture.dx;
        const rawY = activeCoordRef.current.y + gesture.dy;

        const closest = getClosestCorner(
          rawX,
          rawY,
          screenWidth,
          screenHeight,
          MINIMAP_WIDTH,
          MINIMAP_HEIGHT,
        );

        const target = getCornerCoordinates(
          closest,
          screenWidth,
          screenHeight,
          insets.top,
          insets.bottom,
        );

        activeCoordRef.current = target;
        setActiveCorner(closest);
        triggerHaptic('buttonTap');

        Animated.spring(pan, {
          toValue: target,
          friction: 7,
          tension: 45,
          useNativeDriver: false,
        }).start();

        void AsyncStorage.setItem(STORAGE_KEY_MINIMAP_CORNER, closest);
        onCornerChange?.(closest);
      },
    }),
  ).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.miniMapBox,
        {
          borderColor,
          backgroundColor,
          transform: pan.getTranslateTransform(),
          shadowOpacity: isDragging ? 0.8 : 0.45,
          elevation: isDragging ? 18 : 10,
        },
        style,
      ]}
    >
      {/* Tactical Drag Grip Bar */}
      <View style={styles.dragGripContainer} pointerEvents="none">
        <View style={[styles.dragGripHandle, { backgroundColor: borderColor }]} />
      </View>

      {/* Mini-Map Content */}
      <View style={styles.contentWrapper} pointerEvents="none">
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  miniMapBox: {
    position: 'absolute',
    width: MINIMAP_WIDTH,
    height: MINIMAP_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    zIndex: 60,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  dragGripContainer: {
    position: 'absolute',
    top: 5,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 70,
  },
  dragGripHandle: {
    width: 28,
    height: 3,
    borderRadius: 2,
    opacity: 0.85,
  },
  contentWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
