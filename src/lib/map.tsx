import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type MaplibreModule = typeof import('@maplibre/maplibre-react-native');

/**
 * Expo Go ships a fixed set of native modules and has no MapLibre, so requiring
 * the package there throws `MLRNCameraModule could not be found`. Loading it
 * lazily keeps every other screen usable in Expo Go; the map screens show a
 * placeholder instead. A development build loads the real components.
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const maplibre: MaplibreModule | null = isExpoGo
  ? null
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@maplibre/maplibre-react-native');

type StubProps = { children?: ReactNode; [key: string]: unknown };

function MapPlaceholder({ style }: StubProps) {
  return (
    <View style={[styles.placeholder, style as never]}>
      <Text style={styles.title}>Map needs a development build</Text>
      <Text style={styles.body}>
        Expo Go cannot load MapLibre. Everything else works here; run the app as a development build
        to see the map.
      </Text>
    </View>
  );
}

function EmptyComponent() {
  return null;
}

/** Drop-in stand-ins that mirror MapLibre&apos;s exports without its native code. */
export const Map = (maplibre?.Map ?? MapPlaceholder) as MaplibreModule['Map'];
export const Camera = (maplibre?.Camera ?? EmptyComponent) as unknown as MaplibreModule['Camera'];
export const UserLocation = (maplibre?.UserLocation ??
  EmptyComponent) as unknown as MaplibreModule['UserLocation'];
export const GeoJSONSource = (maplibre?.GeoJSONSource ??
  EmptyComponent) as unknown as MaplibreModule['GeoJSONSource'];
export const Layer = (maplibre?.Layer ?? EmptyComponent) as unknown as MaplibreModule['Layer'];
export type { CameraRef } from '@maplibre/maplibre-react-native';

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#0F172A', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  body: { color: '#475569', fontSize: 13, lineHeight: 18, marginTop: 6, textAlign: 'center' },
});
