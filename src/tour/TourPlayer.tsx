import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
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
  const { colors } = useTheme();
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Controls & Story Segments */}
      <View style={[styles.topBar, { backgroundColor: colors.backgroundDark, borderBottomColor: colors.borderLight }]}>
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
        style={[styles.canvasContainer, { backgroundColor: colors.surfaceDark }]}
        accessibilityRole="button"
        accessibilityLabel="Advance tour step"
      >
        {/* Background Grid Pattern */}
        <View style={styles.gridOverlay}>
          <View style={[styles.gridLineH, { backgroundColor: colors.borderLight }]} />
          <View style={[styles.gridLineV, { backgroundColor: colors.borderLight }]} />
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
          const isLabelTop = marker.labelPosition === 'top';

          const MarkerDotContent = (
            <View
              style={[
                styles.markerDot,
                {
                  backgroundColor: marker.isEcho ? 'transparent' : markerColor,
                  borderColor: markerColor,
                  borderWidth: marker.isEcho ? 2 : 1.5,
                  opacity: marker.isEcho ? 0.75 : 1,
                },
              ]}
            />
          );

          return (
            <View
              key={marker.id}
              style={[
                styles.markerAbsolute,
                { left: `${marker.x}%`, top: `${marker.y}%` },
              ]}
            >
              <View style={styles.markerAnchor}>
                {marker.label && isLabelTop && (
                  <View
                    style={[
                      styles.markerLabelContainer,
                      styles.markerLabelTop,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.borderDark,
                      },
                    ]}
                  >
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      style={[styles.markerLabelText, { color: colors.text }]}
                    >
                      {marker.label}
                    </Text>
                  </View>
                )}

                {marker.isEcho ? (
                  <GhostEcho active color={markerColor}>
                    {MarkerDotContent}
                  </GhostEcho>
                ) : (
                  MarkerDotContent
                )}

                {marker.label && !isLabelTop && (
                  <View
                    style={[
                      styles.markerLabelContainer,
                      styles.markerLabelBottom,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.borderDark,
                      },
                    ]}
                  >
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      style={[styles.markerLabelText, { color: colors.text }]}
                    >
                      {marker.label}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </TouchableOpacity>

      {/* Bottom Sheet Beat Card */}
      <Card variant="elevated" style={[styles.bottomCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
    justifyContent: 'space-between',
  },
  topBar: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  segmentsRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
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
    gap: 6,
    alignItems: 'center',
  },
  canvasContainer: {
    flex: 1,
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
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
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
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerAnchor: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  markerDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerLabelContainer: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    minWidth: 36,
    maxWidth: 140,
  },
  markerLabelTop: {
    marginBottom: 4,
  },
  markerLabelBottom: {
    marginTop: 4,
  },
  markerLabelText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
    includeFontPadding: false,
  },
  bottomCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardHeader: {
    marginBottom: 16,
  },
  beatLabel: {
    marginBottom: 4,
    letterSpacing: 1.5,
    fontSize: 11,
  },
  beatTitle: {
    marginBottom: 4,
  },
  beatSubtitle: {
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    gap: 8,
  },
  backButton: {
    flex: 1,
  },
  continueButton: {
    flex: 2,
  },
});
