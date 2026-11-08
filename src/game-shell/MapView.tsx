import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '../lib/map';
import { circleRing, type LngLat, type PointCollection } from '../lib/geo';
import { colors } from '../theme/tokens';
import type { GameArea, RoundPing, RoundPosition } from './types';

const MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

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
}: MapViewProps) {
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
  }, [teammates]);

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
    <View style={StyleSheet.absoluteFill}>
      <MapLibreMap
        attribution
        mapStyle={MAP_STYLE}
        onPress={onPressMap}
        style={StyleSheet.absoluteFill}
      >
        <Camera
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

        {targetPoint && (
          <GeoJSONSource id="target-point" data={targetPoint}>
            <Layer
              id="target-circle"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': colors.ghostTrail,
                'circle-stroke-width': 3,
                'circle-stroke-color': colors.textLight,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Teammates */}
        {teammatesData.features.length > 0 && (
          <GeoJSONSource id="teammates" data={teammatesData}>
            <Layer
              id="teammate-points"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 2,
                'circle-stroke-color': colors.textLight,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Delayed Radar Pings */}
        {pingsData.features.length > 0 && (
          <GeoJSONSource id="pings" data={pingsData}>
            <Layer
              id="ping-halo"
              type="circle"
              paint={{
                'circle-radius': 22,
                'circle-color': [
                  'case',
                  ['==', ['get', 'reason'], 'boundary'],
                  colors.warning,
                  ['==', ['get', 'reason'], 'noise'],
                  colors.danger,
                  ['==', ['get', 'reason'], 'camping'],
                  colors.hunter,
                  ['==', ['get', 'reason'], 'item'],
                  colors.ghostTrail,
                  colors.ghostTrail,
                ],
                'circle-opacity': 0.25,
                'circle-stroke-width': 2,
                'circle-stroke-color': [
                  'case',
                  ['==', ['get', 'reason'], 'boundary'],
                  colors.warning,
                  ['==', ['get', 'reason'], 'noise'],
                  colors.danger,
                  ['==', ['get', 'reason'], 'camping'],
                  colors.hunter,
                  ['==', ['get', 'reason'], 'item'],
                  colors.ghostTrail,
                  colors.ghostTrail,
                ],
                'circle-stroke-opacity': 0.65,
              }}
            />
            <Layer
              id="ping-points"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': [
                  'case',
                  ['==', ['get', 'reason'], 'boundary'],
                  colors.warning,
                  ['==', ['get', 'reason'], 'noise'],
                  colors.danger,
                  ['==', ['get', 'reason'], 'camping'],
                  colors.hunter,
                  ['==', ['get', 'reason'], 'item'],
                  colors.ghostTrail,
                  colors.ghostTrail,
                ],
                'circle-stroke-width': 2.5,
                'circle-stroke-color': colors.textLight,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Own Position */}
        {ownData && (
          <GeoJSONSource id="own-position" data={ownData}>
            <Layer
              id="own-point"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': colors.heatCold,
                'circle-stroke-width': 3,
                'circle-stroke-color': colors.textLight,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Mode-Specific Vector Map Layers */}
        {modeLayers}
      </MapLibreMap>
    </View>
  );
});
