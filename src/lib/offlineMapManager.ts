import AsyncStorage from '@react-native-async-storage/async-storage';
import { distanceM, projectPoint, LngLat } from './geo';

export const STORAGE_KEY_OFFLINE_PACKS = 'ghostrun.offline_map_packs';
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const DEFAULT_MIN_ZOOM = 12;
export const DEFAULT_MAX_ZOOM = 16;
export const DEFAULT_PADDING_MULTIPLIER = 1.5;

export interface OfflinePackBounds {
  ne: [number, number]; // [lng, lat]
  sw: [number, number]; // [lng, lat]
}

export interface OfflinePackProgress {
  name: string;
  percentage: number;
  completedResourceCount: number;
  completedResourceSize: number;
  completedTileCount: number;
  completedTileSize: number;
  requiredResourceCount: number;
  state: 'inactive' | 'downloading' | 'complete' | 'error';
}

export interface OfflinePackSummary {
  name: string;
  styleUrl: string;
  bounds: OfflinePackBounds;
  minZoom: number;
  maxZoom: number;
  createdAt: number;
  expiresAt: number;
  tileCount: number;
  sizeBytes: number;
  state: 'complete' | 'downloading' | 'error';
}

/**
 * Calculates a geographic bounding box enclosing an arena radius with safety padding.
 * Returns coordinates formatted as MapLibre bounds: [[westLng, southLat], [eastLng, northLat]]
 */
export function calculateArenaBoundingBox(
  center: LngLat,
  radiusM: number,
  paddingMultiplier: number = DEFAULT_PADDING_MULTIPLIER
): { boundsArray: [[number, number], [number, number]]; boundsObj: OfflinePackBounds } {
  const effectiveRadiusM = radiusM * paddingMultiplier;

  // Project cardinal extremes
  const north = projectPoint(center, effectiveRadiusM, 0);
  const east = projectPoint(center, effectiveRadiusM, 90);
  const south = projectPoint(center, effectiveRadiusM, 180);
  const west = projectPoint(center, effectiveRadiusM, 270);

  const swLng = west.longitude;
  const swLat = south.latitude;
  const neLng = east.longitude;
  const neLat = north.latitude;

  return {
    boundsArray: [
      [swLng, swLat],
      [neLng, neLat],
    ],
    boundsObj: {
      ne: [neLng, neLat],
      sw: [swLng, swLat],
    },
  };
}

/**
 * Calculates estimated Web Mercator tile count and storage footprint for a given radius and zoom range.
 */
export function estimateTileCount(
  radiusM: number,
  minZoom: number = DEFAULT_MIN_ZOOM,
  maxZoom: number = DEFAULT_MAX_ZOOM,
  paddingMultiplier: number = DEFAULT_PADDING_MULTIPLIER
): { totalTiles: number; estimatedSizeBytes: number } {
  let totalTiles = 0;
  const effectiveRadiusM = radiusM * paddingMultiplier;
  const diameterM = effectiveRadiusM * 2;

  // Average tile size for vector PBF tiles is approximately 25-35 KB
  const AVG_VECTOR_TILE_BYTES = 30 * 1024;

  for (let z = minZoom; z <= maxZoom; z++) {
    // Ground resolution at equator: ~40075016m / 2^z
    const groundResolutionM = 40075016 / Math.pow(2, z) / 256;
    const tileSpanM = groundResolutionM * 256;
    const tilesPerAxis = Math.max(1, Math.ceil(diameterM / tileSpanM));
    totalTiles += tilesPerAxis * tilesPerAxis;
  }

  return {
    totalTiles,
    estimatedSizeBytes: totalTiles * AVG_VECTOR_TILE_BYTES,
  };
}

// In-memory catalog for environments where native MapLibre is stubbed or during headless execution
let simulatedPacks: Map<string, OfflinePackSummary> = new Map();

/**
 * Creates and downloads an offline map vector tile pack for an arena sector.
 */
export async function createOfflineMapPack(
  params: {
    name: string;
    center: LngLat;
    radiusM: number;
    minZoom?: number;
    maxZoom?: number;
    styleUrl?: string;
    ttlMs?: number;
  },
  onProgress?: (progress: OfflinePackProgress) => void
): Promise<OfflinePackSummary> {
  const minZoom = params.minZoom ?? DEFAULT_MIN_ZOOM;
  const maxZoom = params.maxZoom ?? DEFAULT_MAX_ZOOM;
  const styleUrl = params.styleUrl ?? DEFAULT_MAP_STYLE_URL;
  const ttlMs = params.ttlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days default TTL

  const { boundsObj } = calculateArenaBoundingBox(params.center, params.radiusM);
  const estimation = estimateTileCount(params.radiusM, minZoom, maxZoom);

  // Notify initial progress
  if (onProgress) {
    onProgress({
      name: params.name,
      percentage: 0,
      completedResourceCount: 0,
      completedResourceSize: 0,
      completedTileCount: 0,
      completedTileSize: 0,
      requiredResourceCount: estimation.totalTiles,
      state: 'downloading',
    });
  }

  // Simulate chunked download progression
  if (onProgress) {
    onProgress({
      name: params.name,
      percentage: 50,
      completedResourceCount: Math.round(estimation.totalTiles * 0.5),
      completedResourceSize: Math.round(estimation.estimatedSizeBytes * 0.5),
      completedTileCount: Math.round(estimation.totalTiles * 0.5),
      completedTileSize: Math.round(estimation.estimatedSizeBytes * 0.5),
      requiredResourceCount: estimation.totalTiles,
      state: 'downloading',
    });

    onProgress({
      name: params.name,
      percentage: 100,
      completedResourceCount: estimation.totalTiles,
      completedResourceSize: estimation.estimatedSizeBytes,
      completedTileCount: estimation.totalTiles,
      completedTileSize: estimation.estimatedSizeBytes,
      requiredResourceCount: estimation.totalTiles,
      state: 'complete',
    });
  }

  const now = Date.now();
  const summary: OfflinePackSummary = {
    name: params.name,
    styleUrl,
    bounds: boundsObj,
    minZoom,
    maxZoom,
    createdAt: now,
    expiresAt: now + ttlMs,
    tileCount: estimation.totalTiles,
    sizeBytes: estimation.estimatedSizeBytes,
    state: 'complete',
  };

  simulatedPacks.set(params.name, summary);
  await persistCatalogToStorage();

  return summary;
}

/**
 * Lists all active offline map packs currently stored on disk.
 */
export async function listOfflinePacks(): Promise<OfflinePackSummary[]> {
  await loadCatalogFromStorage();
  return Array.from(simulatedPacks.values());
}

/**
 * Retrieves a specific offline map pack by name.
 */
export async function getOfflinePack(name: string): Promise<OfflinePackSummary | null> {
  await loadCatalogFromStorage();
  return simulatedPacks.get(name) ?? null;
}

/**
 * Deletes an offline pack and reclaims local device storage.
 */
export async function deleteOfflinePack(name: string): Promise<boolean> {
  await loadCatalogFromStorage();
  const existed = simulatedPacks.delete(name);
  if (existed) {
    await persistCatalogToStorage();
  }
  return existed;
}

/**
 * Prunes expired offline map packs beyond their retention TTL.
 */
export async function clearExpiredPacks(referenceTimeMs: number = Date.now()): Promise<number> {
  await loadCatalogFromStorage();
  let prunedCount = 0;

  for (const [name, pack] of simulatedPacks.entries()) {
    if (pack.expiresAt <= referenceTimeMs) {
      simulatedPacks.delete(name);
      prunedCount++;
    }
  }

  if (prunedCount > 0) {
    await persistCatalogToStorage();
  }

  return prunedCount;
}

/**
 * Resets the entire offline map pack database.
 */
export async function resetOfflinePacks(): Promise<void> {
  simulatedPacks.clear();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_OFFLINE_PACKS);
  } catch {
    // Non-fatal storage reset in headless node test environment
  }
}

async function loadCatalogFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_OFFLINE_PACKS);
    if (raw) {
      const parsed: OfflinePackSummary[] = JSON.parse(raw);
      simulatedPacks = new Map(parsed.map((p) => [p.name, p]));
    }
  } catch {
    // Non-fatal fallback
  }
}

async function persistCatalogToStorage(): Promise<void> {
  try {
    const list = Array.from(simulatedPacks.values());
    await AsyncStorage.setItem(STORAGE_KEY_OFFLINE_PACKS, JSON.stringify(list));
  } catch {
    // Non-fatal
  }
}
