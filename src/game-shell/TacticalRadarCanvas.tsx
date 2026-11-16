import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { bearingDeg, distanceM, type LngLat } from '../lib/geo';
import { useTheme } from '../theme/ThemeProvider';
import { useUnits } from '../utils/units';
import { Text } from '../ui/Text';
import { triggerHaptic } from '../motion/haptics';
import { ProximityRadialBloom } from '../components/map';
import type { GameArea, GamePlayer, Role, RoundPing, RoundPosition } from './types';

interface TacticalRadarCanvasProps {
  area: GameArea;
  ownFix: LngLat | null;
  userHeading: number | null;
  pings?: RoundPing[];
  teammates?: RoundPosition[];
  players?: GamePlayer[];
  target?: LngLat | null;
  jail?: { latitude: number; longitude: number; radius_m: number } | null;
  extraction?: { latitude: number; longitude: number; radius_m: number } | null;
  safeZones?: { latitude: number; longitude: number; radius_m: number }[];
  myRole?: Role;
  tagRadiusM?: number;
}

const RADAR_RANGES = [150, 300, 600, 1200];

export function TacticalRadarCanvas({
  area,
  ownFix,
  userHeading = 0,
  pings = [],
  teammates = [],
  players = [],
  target = null,
  jail = null,
  extraction = null,
  safeZones = [],
  myRole = 'runner',
  tagRadiusM = 20,
}: TacticalRadarCanvasProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { formatDistance } = useUnits();

  // Selected radar range scale in meters
  const [maxRangeM, setMaxRangeM] = useState<number>(300);

  // Radar geometry
  const cx = screenWidth / 2;
  const cy = screenHeight / 2 - 20;
  const radarRadius = Math.min(screenWidth, screenHeight) * 0.44;

  // Sweep rotation animation
  const sweepAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweepAnim, {
        toValue: 1,
        duration: 3500,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweepAnim]);

  const sweepRotation = sweepAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Safe operative heading
  const heading = userHeading !== null && userHeading !== undefined ? userHeading : 0;

  // Calculate distance to boundary
  const zoneStats = useMemo(() => {
    if (!ownFix) return { distToCenter: 0, distToBoundary: area.radius_m, isOob: false };
    const distToCenter = distanceM(ownFix, { latitude: area.latitude, longitude: area.longitude });
    const isOob = distToCenter > area.radius_m;
    const distToBoundary = Math.abs(area.radius_m - distToCenter);
    return { distToCenter, distToBoundary, isOob };
  }, [ownFix, area]);

  // Project an arbitrary GPS coordinate to radar (px, py)
  const projectToRadar = (dest: LngLat) => {
    if (!ownFix) return null;
    const distM = distanceM(ownFix, dest);
    const absBearing = bearingDeg(ownFix, dest);
    const relBearing = (absBearing - heading + 360) % 360;
    const thetaRad = (relBearing * Math.PI) / 180;

    const isClamped = distM > maxRangeM;
    const r = isClamped
      ? radarRadius - 18
      : (distM / Math.max(1, maxRangeM)) * (radarRadius - 18);

    const px = cx + r * Math.sin(thetaRad);
    const py = cy - r * Math.cos(thetaRad);

    return { px, py, distM, relBearing, isClamped };
  };

  // Compile list of inner zones (Target, Jail, Extraction, Safe Zones)
  const innerZones = useMemo(() => {
    const list: Array<{
      id: string;
      label: string;
      icon: keyof typeof Ionicons.glyphMap;
      color: string;
      coords: LngLat;
    }> = [];

    if (target) {
      list.push({
        id: 'target',
        label: 'TARGET',
        icon: 'locate',
        color: colors.primary,
        coords: target,
      });
    }

    if (jail) {
      list.push({
        id: 'jail',
        label: 'JAIL',
        icon: 'lock-closed',
        color: colors.danger,
        coords: { latitude: jail.latitude, longitude: jail.longitude },
      });
    }

    if (extraction) {
      list.push({
        id: 'extraction',
        label: 'EXTRACTION',
        icon: 'flag',
        color: colors.runner,
        coords: { latitude: extraction.latitude, longitude: extraction.longitude },
      });
    }

    safeZones.forEach((sz, idx) => {
      list.push({
        id: `safe-${idx}`,
        label: `SAFE ZONE ${idx + 1}`,
        icon: 'shield-checkmark',
        color: colors.accent,
        coords: { latitude: sz.latitude, longitude: sz.longitude },
      });
    });

    return list;
  }, [target, jail, extraction, safeZones, colors]);

  // Project contacts (pings & teammates)
  const projectedContacts = useMemo(() => {
    if (!ownFix) return [];

    const contacts: Array<{
      id: string;
      px: number;
      py: number;
      distM: number;
      isHunter: boolean;
      label: string;
      ageS?: number;
    }> = [];

    pings.forEach((p) => {
      if (p.latitude === null || p.longitude === null) return;
      const proj = projectToRadar({ latitude: p.latitude, longitude: p.longitude });
      if (!proj) return;
      const player = players.find((pl) => pl.id === p.player_id);
      const isHunter = player ? player.team === 'hunter' : myRole !== 'hunter';
      contacts.push({
        id: `ping-${p.id}`,
        px: proj.px,
        py: proj.py,
        distM: proj.distM,
        isHunter,
        label: isHunter ? 'HUNTER' : 'SEEKER',
      });
    });

    teammates.forEach((tm) => {
      const proj = projectToRadar({ latitude: tm.latitude, longitude: tm.longitude });
      if (!proj) return;
      contacts.push({
        id: `tm-${tm.player_id}`,
        px: proj.px,
        py: proj.py,
        distM: proj.distM,
        isHunter: tm.team === 'hunter',
        label: tm.display_name || tm.team.toUpperCase(),
      });
    });

    return contacts;
  }, [ownFix, pings, teammates, players, myRole, heading, maxRangeM]);

  // Concentric radar range rings fractions: 25%, 50%, 75%, 100%
  const rangeRingFractions = [0.25, 0.5, 0.75, 1];

  return (
    <View style={[styles.canvas, { backgroundColor: '#070A10' }]}>
      {/* Top Tactical Telemetry Bar */}
      <View
        style={[
          styles.topTelemetry,
          {
            top: Math.max(insets.top, 16) + 8,
          },
        ]}
      >
        <View style={styles.telemetryBadgeRow}>
          <View style={[styles.modeTag, { borderColor: colors.danger, backgroundColor: '#1A0B12' }]}>
            <Ionicons name="radio" size={12} color={colors.danger} />
            <Text variant="caption" style={{ color: colors.danger, fontWeight: '800', marginLeft: 4, fontSize: 10 }}>
              EXTREME · BLACKOUT RADAR
            </Text>
          </View>

          <View style={[styles.modeTag, { borderColor: colors.borderDark, backgroundColor: '#0D131F' }]}>
            <Ionicons name="compass-outline" size={12} color={colors.primary} />
            <Text variant="caption" style={{ color: colors.primary, fontWeight: '700', marginLeft: 4, fontSize: 10 }}>
              {Math.round(heading)}° AZIMUTH
            </Text>
          </View>
        </View>

        {/* Boundary proximity banner */}
        <View
          style={[
            styles.boundaryBanner,
            {
              backgroundColor: zoneStats.isOob ? 'rgba(255, 42, 85, 0.2)' : 'rgba(0, 240, 255, 0.08)',
              borderColor: zoneStats.isOob ? colors.danger : colors.borderDark,
            },
          ]}
        >
          <Ionicons
            name={zoneStats.isOob ? 'alert-circle' : 'shield-outline'}
            size={14}
            color={zoneStats.isOob ? colors.danger : colors.primary}
          />
          <Text
            variant="caption"
            style={{
              color: zoneStats.isOob ? colors.danger : colors.text,
              fontWeight: '700',
              marginLeft: 6,
              fontSize: 11,
            }}
          >
            {zoneStats.isOob
              ? `PERIMETER EXCEEDED · ${formatDistance(zoneStats.distToBoundary).toUpperCase()} TO SAFETY`
              : `ZONE BOUNDARY · ${formatDistance(zoneStats.distToBoundary).toUpperCase()} REMAINING`}
          </Text>
        </View>
      </View>

      {/* ==================== RADAR CIRCULAR CANVAS ==================== */}
      <View style={styles.radarWrapper} pointerEvents="none">
        {/* Outer Bearing Compass Dial Ring */}
        <View
          style={[
            styles.outerDialRing,
            {
              width: radarRadius * 2,
              height: radarRadius * 2,
              left: cx - radarRadius,
              top: cy - radarRadius,
              borderColor: 'rgba(0, 240, 255, 0.35)',
            },
          ]}
        />

        {/* Concentric Range Rings */}
        {rangeRingFractions.map((frac) => {
          const ringR = radarRadius * frac;
          const ringDistM = maxRangeM * frac;
          return (
            <View
              key={frac}
              style={[
                styles.rangeRing,
                {
                  width: ringR * 2,
                  height: ringR * 2,
                  left: cx - ringR,
                  top: cy - ringR,
                  borderColor: frac === 1 ? 'rgba(0, 240, 255, 0.45)' : 'rgba(0, 240, 255, 0.15)',
                },
              ]}
            >
              <Text style={styles.rangeRingText}>{formatDistance(ringDistM)}</Text>
            </View>
          );
        })}

        {/* Axis Crosshairs */}
        <View style={[styles.crosshairH, { left: cx - radarRadius, top: cy, width: radarRadius * 2 }]} />
        <View style={[styles.crosshairV, { left: cx, top: cy - radarRadius, height: radarRadius * 2 }]} />

        {/* Rotating Sonar Sweep Beam */}
        <Animated.View
          style={[
            styles.sweepBeam,
            {
              left: cx,
              top: cy,
              height: radarRadius,
              transform: [{ rotate: sweepRotation }, { translateY: -radarRadius / 2 }],
            },
          ]}
        />

        {/* Relative North Indicator on outer ring */}
        {(() => {
          const relNorthAngle = (-heading + 360) % 360;
          const northRad = (relNorthAngle * Math.PI) / 180;
          const nx = cx + (radarRadius + 14) * Math.sin(northRad);
          const ny = cy - (radarRadius + 14) * Math.cos(northRad);
          return (
            <View style={[styles.cardinalNorth, { left: nx - 10, top: ny - 10 }]}>
              <Text style={styles.cardinalNorthText}>N</Text>
            </View>
          );
        })()}

        {/* ==================== INNER ZONES & STRAIGHT DOTTED LINES ==================== */}
        {innerZones.map((z) => {
          const proj = projectToRadar(z.coords);
          if (!proj) return null;
          const { px, py, distM } = proj;

          // Render straight dotted line from center (cx, cy) to inner zone (px, py)
          const deltaX = px - cx;
          const deltaY = py - cy;
          const lineLength = Math.hypot(deltaX, deltaY);
          const numDots = Math.max(4, Math.floor(lineLength / 18));
          const dots = Array.from({ length: numDots - 1 }, (_, i) => i + 1);

          return (
            <React.Fragment key={z.id}>
              {/* Straight Dotted Vector Line */}
              {dots.map((dotIdx) => {
                const frac = dotIdx / numDots;
                const dotX = cx + deltaX * frac;
                const dotY = cy + deltaY * frac;
                return (
                  <View
                    key={`${z.id}-dot-${dotIdx}`}
                    style={[
                      styles.dottedBead,
                      {
                        left: dotX - 2,
                        top: dotY - 2,
                        backgroundColor: z.color,
                      },
                    ]}
                  />
                );
              })}

              {/* Destination Icon Badge */}
              <View
                style={[
                  styles.innerZoneBadge,
                  {
                    left: px - 40,
                    top: py - 28,
                    borderColor: z.color,
                    backgroundColor: 'rgba(7, 10, 16, 0.92)',
                  },
                ]}
              >
                <Ionicons name={z.icon} size={14} color={z.color} />
                <View style={{ marginLeft: 4 }}>
                  <Text style={[styles.innerZoneLabel, { color: z.color }]}>{z.label}</Text>
                  <Text style={styles.innerZoneDist}>{formatDistance(distM)}</Text>
                </View>
              </View>
            </React.Fragment>
          );
        })}

        {/* ==================== CONTACTS & RADIAL HEATMAP ==================== */}
        {projectedContacts.map((c) => {
          const contactColor = c.isHunter ? colors.danger : colors.runner;

          return (
            <View
              key={c.id}
              style={[
                styles.contactWrapper,
                {
                  left: c.px - 60,
                  top: c.py - 60,
                  width: 120,
                  height: 120,
                },
              ]}
            >
              {/* PlayCulture-Inspired Smooth Two-Color Radiant Proximity Bloom (Red/Blue) */}
              <ProximityRadialBloom
                isHunter={c.isHunter}
                distanceM={c.distM}
                dangerThresholdM={tagRadiusM * 1.5}
                maxRangeM={maxRangeM}
                minSize={30}
                maxSize={104}
              />

              {/* Hot Core Blip */}
              <View
                style={[
                  styles.heatCore,
                  {
                    backgroundColor: contactColor,
                    shadowColor: contactColor,
                  },
                ]}
              />

              {/* Proximity Distance Tag */}
              <View
                style={[
                  styles.contactTag,
                  {
                    borderColor: contactColor,
                    bottom: 12,
                  },
                ]}
              >
                <Text style={[styles.contactTagText, { color: contactColor }]}>
                  {formatDistance(c.distM)}
                </Text>
              </View>
            </View>
          );
        })}

        {/* ==================== USER CENTERED OPERATIVE ==================== */}
        <View style={[styles.operativeCenter, { left: cx - 24, top: cy - 24 }]}>
          <View style={[styles.operativeHalo, { borderColor: colors.primary }]} />
          <View
            style={[
              styles.operativeIconBg,
              {
                backgroundColor: colors.primary,
                transform: [{ rotate: `${Math.round(heading)}deg` }],
              },
            ]}
          >
            <Ionicons name="navigate" size={16} color="#000000" />
          </View>
          <View style={[styles.operativeZeroBadge, { backgroundColor: '#070A10', borderColor: colors.primary }]}>
            <Text style={[styles.operativeZeroBadgeText, { color: colors.primary }]}>0m · YOU</Text>
          </View>
        </View>
      </View>

      {/* Bottom Range Zoom Selector */}
      <View
        style={[
          styles.rangeControls,
          {
            bottom: Math.max(insets.bottom, 16) + 12,
          },
        ]}
      >
        <Text variant="caption" style={{ color: colors.textMuted, fontSize: 10, marginBottom: 4, letterSpacing: 1 }}>
          RADAR SCALE RANGE
        </Text>
        <View style={styles.rangeChipsRow}>
          {RADAR_RANGES.map((r) => {
            const isSelected = maxRangeM === r;
            return (
              <Pressable
                key={r}
                accessibilityRole="button"
                accessibilityLabel={`Radar range ${formatDistance(r)}`}
                onPress={() => {
                  triggerHaptic('buttonTap');
                  setMaxRangeM(r);
                }}
                style={[
                  styles.rangeChip,
                  {
                    backgroundColor: isSelected ? colors.primary : 'rgba(15, 23, 42, 0.8)',
                    borderColor: isSelected ? colors.primary : colors.borderDark,
                  },
                ]}
              >
                <Text
                  style={{
                    color: isSelected ? '#000000' : colors.textMuted,
                    fontWeight: '800',
                    fontSize: 11,
                  }}
                >
                  {formatDistance(r)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  topTelemetry: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 40,
    gap: 8,
  },
  telemetryBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  boundaryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  radarWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  outerDialRing: {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 1.5,
  },
  rangeRing: {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  rangeRingText: {
    color: 'rgba(0, 240, 255, 0.4)',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
    backgroundColor: '#070A10',
    paddingHorizontal: 4,
  },
  crosshairH: {
    position: 'absolute',
    height: 1,
    backgroundColor: 'rgba(0, 240, 255, 0.12)',
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'rgba(0, 240, 255, 0.12)',
  },
  sweepBeam: {
    position: 'absolute',
    width: 2,
    backgroundColor: 'rgba(0, 240, 255, 0.55)',
    shadowColor: '#00F0FF',
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  cardinalNorth: {
    position: 'absolute',
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardinalNorthText: {
    color: '#FF2A55',
    fontWeight: '900',
    fontSize: 13,
  },
  dottedBead: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    shadowOpacity: 0.8,
    shadowRadius: 2,
  },
  innerZoneBadge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    zIndex: 35,
  },
  innerZoneLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  innerZoneDist: {
    color: '#E2E8F0',
    fontSize: 8,
    fontWeight: '700',
  },
  contactWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  heatAura: {
    position: 'absolute',
  },
  heatCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
  },
  contactTag: {
    position: 'absolute',
    backgroundColor: 'rgba(7, 10, 16, 0.9)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.8,
  },
  contactTagText: {
    fontSize: 8,
    fontWeight: '800',
  },
  operativeCenter: {
    position: 'absolute',
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  operativeHalo: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    opacity: 0.5,
  },
  operativeIconBg: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00F0FF',
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  operativeZeroBadge: {
    position: 'absolute',
    bottom: -10,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 0.8,
  },
  operativeZeroBadgeText: {
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  rangeControls: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 40,
  },
  rangeChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rangeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
});
