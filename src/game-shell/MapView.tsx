import React, { memo, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, Marker, type CameraRef } from '../lib/map';
import { circleRing, distanceM, type LngLat, type PointCollection } from '../lib/geo';
import { useTheme } from '../theme/ThemeProvider';
import {
  AnimatedExtractionTarget,
  AnimatedPlayerPointer,
  AnimatedRadarPing,
  AnimatedTeammateMarker,
  ProximityRadialBloom,
} from '../components/map';
import type { GameArea, Role, RoundPing, RoundPosition } from './types';

const DAY_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const DARK_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_DARK_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';

interface MapViewProps {
  area: GameArea;
  target?: LngLat | null;
  targetRadiusM?: number;
  tagRadiusM?: number;
  teammates: RoundPosition[];
  pings: RoundPing[];
  ownFix: LngLat | null;
  modeLayers?: React.ReactNode;
  onPressMap?: () => void;
  isMapLocked?: boolean;
  userHeading?: number | null;
  role?: Role;
}

export const MapView = memo(function MapView({
  area,
  target,
  targetRadiusM = 25,
  tagRadiusM,
  teammates,
  pings,
  ownFix,
  modeLayers,
  onPressMap,
  isMapLocked = false,
  userHeading = null,
  role = 'runner',
}: MapViewProps) {
  const { colors, isDark } = useTheme();
  const cameraRef = useRef<CameraRef>(null);
  const lastCameraCenterRef = useRef<[number, number] | null>(null);

  // Smooth camera following with stationary deadband & rock-solid North-Up orientation.
  // Suppresses stationary GPS micro-wander (< 4m) and eliminates compass-induced map spinning.
  useEffect(() => {
    if (!ownFix || !cameraRef.current) return;

    if (lastCameraCenterRef.current) {
      const prevLngLat = { longitude: lastCameraCenterRef.current[0], latitude: lastCameraCenterRef.current[1] };
      const dist = distanceM(prevLngLat, ownFix);
      // Suppress stationary GPS jitter when stationary
      if (dist < 4.0) {
        return;
      }
    }

    lastCameraCenterRef.current = [ownFix.longitude, ownFix.latitude];
    cameraRef.current.easeTo({
      center: [ownFix.longitude, ownFix.latitude],
      bearing: 0, // Always North-Up: map NEVER spins or goes crazy when phone is tilted
      zoom: 16.5,
      duration: 800, // Smooth glide when actually moving
    });
  }, [ownFix]);
  // Memoized GeoJSON features
  const areaRing = useMemo(() => {
    return circleRing({ longitude: area.longitude, latitude: area.latitude }, area.radius_m);
  }, [area.latitude, area.longitude, area.radius_m]);

  const targetRing = useMemo(() => {
    if (!target) return null;
    return circleRing(target, targetRadiusM);
  }, [target, targetRadiusM]);

  const targetPoint = useMemo(() => {
    if (!target) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [target.longitude, target.latitude],
          },
          properties: {},
        },
      ],
    };
  }, [target]);

  const tagRing = useMemo(() => {
    if (!ownFix || !tagRadiusM) return null;
    return circleRing(ownFix, tagRadiusM);
  }, [ownFix, tagRadiusM]);

  const teammatesData = useMemo<PointCollection>(() => {
    return {
      type: 'FeatureCollection',
      features: teammates.map((mate) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [mate.longitude, mate.latitude],
        },
        properties: {
          id: mate.player_id,
          name: mate.display_name,
          color: mate.color || colors.heatCold,
        },
      })),
    };
  }, [teammates, colors.heatCold]);

  const pingsData = useMemo<PointCollection>(() => {
    return {
      type: 'FeatureCollection',
      features: pings
        .filter((p) => p.longitude !== null && p.latitude !== null)
        .map((p) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [p.longitude!, p.latitude!],
          },
          properties: {
            id: p.id,
            reason: p.reason,
          },
        })),
    };
  }, [pings]);

  const ownData = useMemo<PointCollection | null>(() => {
    if (!ownFix) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [ownFix.longitude, ownFix.latitude],
          },
          properties: {},
        },
      ],
    };
  }, [ownFix]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={isMapLocked ? 'none' : 'auto'}>
      <MapLibreMap
        attribution={false}
        compass={false}
        logo={false}
        mapStyle={isDark ? DARK_MAP_STYLE : DAY_MAP_STYLE}
        onPress={isMapLocked ? undefined : onPressMap}
        style={StyleSheet.absoluteFill}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [area.longitude, area.latitude],
            zoom: 15,
          }}
        />

        {/* Play Boundary */}
        <GeoJSONSource id="play-area" data={areaRing}>
          <Layer
            id="play-area-fill"
            type="fill"
            paint={{ 'fill-color': colors.heatCold, 'fill-opacity': 0.06 }}
          />
          <Layer
            id="play-area-outline"
            type="line"
            paint={{ 'line-color': colors.heatCold, 'line-width': 2, 'line-dasharray': [2, 2] }}
          />
        </GeoJSONSource>

        {/* Tag radius */}
        {tagRing && (
          <GeoJSONSource id="tag-radius" data={tagRing}>
            <Layer
              id="tag-radius-fill"
              type="fill"
              paint={{ 'fill-color': colors.danger, 'fill-opacity': 0.05 }}
            />
            <Layer
              id="tag-radius-line"
              type="line"
              paint={{ 'line-color': colors.danger, 'line-width': 1.5, 'line-dasharray': [2, 2] }}
            />
          </GeoJSONSource>
        )}

        {/* Secret Target (if visible) */}
        {targetRing && (
          <GeoJSONSource id="target-radius" data={targetRing}>
            <Layer
              id="target-radius-fill"
              type="fill"
              paint={{ 'fill-color': colors.ghostTrail, 'fill-opacity': 0.08 }}
            />
            <Layer
              id="target-radius-line"
              type="line"
              paint={{ 'line-color': colors.ghostTrail, 'line-width': 1.5, 'line-dasharray': [2, 2] }}
            />
          </GeoJSONSource>
        )}

        {/* PlayCulture Two-Color Radiant Proximity Blooms (Underlay beneath markers) */}
        {/* 1. Teammates / Seekers Radiant Blooms (Blue) */}
        {teammates.map((m) => {
          const distM = ownFix
            ? distanceM(ownFix, { latitude: m.latitude, longitude: m.longitude })
            : 100;
          return (
            <Marker
              key={`bloom-teammate-${m.player_id}`}
              id={`bloom-teammate-${m.player_id}`}
              lngLat={[m.longitude, m.latitude]}
            >
              <ProximityRadialBloom
                isHunter={m.team === 'hunter'}
                distanceM={distM}
                dangerThresholdM={tagRadiusM || 20}
                maxRangeM={180}
                minSize={36}
                maxSize={120}
              />
            </Marker>
          );
        })}

        {/* 2. Radar Ping Contacts Radiant Blooms (Red for Hunters/Zombies, Blue for Runners) */}
        {pings.map((p) => {
          if (p.longitude === null || p.latitude === null) return null;
          const distM = ownFix
            ? distanceM(ownFix, { latitude: p.latitude, longitude: p.longitude })
            : 100;
          const isEnemyHunter = role !== 'hunter';
          return (
            <Marker
              key={`bloom-ping-${p.id}`}
              id={`bloom-ping-${p.id}`}
              lngLat={[p.longitude, p.latitude]}
            >
              <ProximityRadialBloom
                isHunter={isEnemyHunter}
                distanceM={distM}
                dangerThresholdM={tagRadiusM || 20}
                maxRangeM={180}
                minSize={36}
                maxSize={120}
              />
            </Marker>
          );
        })}

        {/* Animated Secret Target Beacon */}
        {target && (
          <Marker id="animated-target" lngLat={[target.longitude, target.latitude]}>
            <AnimatedExtractionTarget size={52} />
          </Marker>
        )}

        {/* Animated Teammate Operatives */}
        {teammates.map((m) => (
          <Marker
            key={`teammate-${m.player_id}`}
            id={`teammate-${m.player_id}`}
            lngLat={[m.longitude, m.latitude]}
          >
            <AnimatedTeammateMarker name={m.display_name} size={42} color={m.color} />
          </Marker>
        ))}

        {/* Animated Delayed Radar Pings */}
        {pings.map((p) =>
          p.longitude !== null && p.latitude !== null ? (
            <Marker key={`ping-${p.id}`} id={`ping-${p.id}`} lngLat={[p.longitude, p.latitude]}>
              <AnimatedRadarPing size={44} />
            </Marker>
          ) : null
        )}

        {/* Animated Own Player Heading Pointer */}
        {ownFix && (
          <Marker id="own-pointer" lngLat={[ownFix.longitude, ownFix.latitude]}>
            <AnimatedPlayerPointer
              role={role === 'hunter' ? 'hunter' : 'runner'}
              heading={userHeading ?? 0}
              size={52}
            />
          </Marker>
        )}

        {/* Mode-Specific Vector Map Layers */}
        {modeLayers}
      </MapLibreMap>
    </View>
  );
});
