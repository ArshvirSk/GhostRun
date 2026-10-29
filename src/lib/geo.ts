export type LngLat = { longitude: number; latitude: number };

export type PointProperties = { [key: string]: string | number | boolean | null };

export type PointFeature = {
  type: 'Feature';
  properties: PointProperties;
  geometry: { type: 'Point'; coordinates: [number, number] };
};

export type PointCollection = {
  type: 'FeatureCollection';
  features: PointFeature[];
};

export type CircleFeature = {
  type: 'Feature';
  properties: PointProperties;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
};

const EARTH_RADIUS_M = 6371008.8;

export function distanceM(a: LngLat, b: LngLat): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A closed ring of coordinates approximating a circle of `radiusM` metres. */
export function circleRing(center: LngLat, radiusM: number): CircleFeature {
  const steps = 96;
  const latDelta = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lngDelta = latDelta / Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([
      center.longitude + Math.cos(angle) * lngDelta,
      center.latitude + Math.sin(angle) * latDelta,
    ]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

/** "2m ago" style age label used by ping markers and the HUD. */
export function formatAge(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value}s ago`;
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
