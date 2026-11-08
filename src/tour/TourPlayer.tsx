import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions } from 'react-native';
import { colors, spacing, radii } from '../theme/tokens';
import { Text } from '../ui/Text';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { PingRipple } from '../motion/PingRipple';
import { RadarSweep } from '../motion/RadarSweep';
import { HeatWash } from '../motion/HeatWash';
import { GhostEcho } from '../motion/GhostEcho';
import { useReducedMotion } from '../motion/reduced-motion';
import { TourScript } from './TourScript';

export interface TourPlayerProps {
  script: TourScript;
  onFinish?: () => void;
  onSkip?: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function TourPlayer({
  script,
  onFinish,
  onSkip,
}: TourPlayerProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [currentBeatIndex, setCurrentBeatIndex] = useState(0);

  const beat = script.beats[currentBeatIndex] || script.beats[0];
  const totalBeats = script.beats.length;
  const isLastBeat = currentBeatIndex === totalBeats - 1;

  // Auto-advance logic if not reduced motion and not on last beat
  useEffect(() => {
    if (reducedMotion || isLastBeat) return;

    const timer = setTimeout(() => {
      setCurrentBeatIndex((prev) => Math.min(prev + 1, totalBeats - 1));
    }, beat.durationMs);

    return () => clearTimeout(timer);
  }, [currentBeatIndex, reducedMotion, isLastBeat, beat.durationMs, totalBeats]);

  const handleNext = () => {
    if (isLastBeat) {
      onFinish?.();
    } else {
      setCurrentBeatIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentBeatIndex > 0) {
      setCurrentBeatIndex((prev) => prev - 1);
    }
  };

  const isHunterView = beat.viewMode === 'hunters';
  const roleColor = isHunterView ? colors.hunter : colors.runner;

  return (
    <View style={styles.container}>
      {/* Top Controls & Story Segments */}
      <View style={styles.topBar}>
        <View style={styles.segmentsRow}>
          {script.beats.map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.segment,
                {
                  backgroundColor:
                    idx === currentBeatIndex
                      ? colors.primary
                      : idx < currentBeatIndex
                      ? colors.textMuted
                      : colors.surfaceElevated,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip tour"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text variant="label" color={colors.textMuted}>
              SKIP
            </Text>
          </TouchableOpacity>

          <View style={styles.hudBadgeRow}>
            <Chip
              label={isHunterView ? "HUNTERS' VIEW" : "RUNNERS' VIEW"}
              variant={isHunterView ? 'hunter' : 'accent'}
              size="sm"
            />
            {beat.timeLeftSeconds !== undefined && beat.timeLeftSeconds > 0 && (
              <Chip
                label={`${Math.floor(beat.timeLeftSeconds / 60)}:${(
                  beat.timeLeftSeconds % 60
                )
                  .toString()
                  .padStart(2, '0')}`}
                variant="default"
                size="sm"
              />
            )}
          </View>
        </View>
      </View>

      {/* Interactive Map Visualizer Canvas */}
      <TouchableOpacity
        activeOpacity={0.95}
        onPress={handleNext}
        style={styles.canvasContainer}
        accessibilityRole="button"
        accessibilityLabel="Advance tour step"
      >
        {/* Background Grid Pattern */}
        <View style={styles.gridOverlay}>
          <View style={styles.gridLineH} />
          <View style={styles.gridLineV} />
          {/* Simulated Perimeter Boundary */}
          <View style={[styles.zonePerimeter, { borderColor: colors.borderAccent }]} />
        </View>

        {/* Animated Overlays */}
        {beat.overlays.map((ov, idx) => {
          if (ov.type === 'radarSweep') {
            return (
              <View key={idx} style={styles.overlayCenter}>
                <RadarSweep size={260} />
              </View>
            );
          }
          if (ov.type === 'pingRipple') {
            return (
              <View
                key={idx}
                style={[
                  styles.markerAbsolute,
                  { left: `${ov.x ?? 50}%`, top: `${ov.y ?? 50}%` },
                ]}
              >
                <PingRipple size={90} active />
              </View>
            );
          }
          if (ov.type === 'heatWashHot') {
            return <HeatWash key={idx} active type="hot" />;
          }
          if (ov.type === 'heatWashCold') {
            return <HeatWash key={idx} active type="cold" />;
          }
          return null;
        })}

        {/* Simulated Map Markers */}
        {beat.markers.map((marker) => {
          const isMarkerHunter = marker.role === 'hunter';
          const markerColor = isMarkerHunter ? colors.hunter : colors.runner;

          const MarkerContent = (
            <View
              style={[
                styles.markerDot,
                {
                  backgroundColor: marker.isEcho ? 'transparent' : markerColor,
                  borderColor: markerColor,
                  borderWidth: marker.isEcho ? 2 : 1,
                  opacity: marker.isEcho ? 0.6 : 1,
                },
              ]}
            >
              {marker.label && (
                <View style={styles.markerLabelContainer}>
                  <Text variant="caption" color={colors.textLight} style={styles.markerLabelText}>
                    {marker.label}
                  </Text>
                </View>
              )}
            </View>
          );

          return (
            <View
              key={marker.id}
              style={[
                styles.markerAbsolute,
                { left: `${marker.x}%`, top: `${marker.y}%` },
              ]}
            >
              {marker.isEcho ? (
                <GhostEcho active color={markerColor}>
                  {MarkerContent}
                </GhostEcho>
              ) : (
                MarkerContent
              )}
            </View>
          );
        })}
      </TouchableOpacity>

      {/* Bottom Sheet Beat Card */}
      <Card variant="elevated" style={styles.bottomCard}>
        <View style={styles.cardHeader}>
          <Text variant="mono" color={roleColor} style={styles.beatLabel}>
            BEAT {beat.beatNumber.toString().padStart(2, '0')} / {totalBeats.toString().padStart(2, '0')} • {beat.label}
          </Text>
          <Text variant="title" color={colors.text} style={styles.beatTitle}>
            {beat.title}
          </Text>
          <Text variant="body" color={colors.textMuted} style={styles.beatSubtitle}>
            {beat.subtitle}
          </Text>
        </View>

        <View style={styles.cardFooter}>
          {currentBeatIndex > 0 && (
            <Button
              title="BACK"
              variant="secondary"
              size="md"
              onPress={handlePrev}
              style={styles.backButton}
            />
          )}
          <Button
            title={isLastBeat ? 'ENTER THE GRID' : 'CONTINUE'}
            variant={isHunterView ? 'hunter' : 'primary'}
            size="md"
            onPress={handleNext}
            style={styles.continueButton}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
  },
  topBar: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.backgroundDark,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    zIndex: 10,
  },
  segmentsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 36,
  },
  hudBadgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
  },
  canvasContainer: {
    flex: 1,
    backgroundColor: colors.surfaceDark,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.borderLight,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.borderLight,
  },
  zonePerimeter: {
    width: SCREEN_WIDTH * 0.75,
    height: SCREEN_WIDTH * 0.75,
    borderRadius: (SCREEN_WIDTH * 0.75) / 2,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  overlayCenter: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerAbsolute: {
    position: 'absolute',
    transform: [{ translateX: -12 }, { translateY: -12 }],
  },
  markerDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerLabelContainer: {
    position: 'absolute',
    top: 26,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.xs,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 50,
    alignItems: 'center',
  },
  markerLabelText: {
    fontSize: 9,
    letterSpacing: 0.5,
  },
  bottomCard: {
    margin: spacing.base,
    padding: spacing.base,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    marginBottom: spacing.base,
  },
  beatLabel: {
    marginBottom: spacing.xs,
    letterSpacing: 1.5,
    fontSize: 11,
  },
  beatTitle: {
    marginBottom: spacing.xs,
  },
  beatSubtitle: {
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  backButton: {
    flex: 1,
  },
  continueButton: {
    flex: 2,
  },
});
