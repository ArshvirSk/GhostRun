import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type CameraRef,
} from '../src/lib/map';
import { distanceM } from '../src/lib/geo';
import {
  buildTurfHexFeature,
  fetchCityWorldState,
  submitCityBountyClaim,
  type CityBounty,
  type CityWorldState,
} from '../src/lib/cityWorld';
import { PinpointViewfinder } from '../src/components/PinpointViewfinder';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { triggerHaptic } from '../src/motion/haptics';

const DAY_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const DARK_MAP_STYLE =
  process.env.EXPO_PUBLIC_MAP_DARK_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';

export default function CityWorldScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const cameraRef = useRef<CameraRef>(null);

  const [ownFix, setOwnFix] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [headingDeg, setHeadingDeg] = useState<number>(0);
  const [worldState, setWorldState] = useState<CityWorldState | null>(null);
  const [selectedBountyId, setSelectedBountyId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [viewfinderOpen, setViewfinderOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [claimBanner, setClaimBanner] = useState<{
    score: number;
    echoPts: number;
    turfFlipped: boolean;
    distanceM: number;
  } | null>(null);

  const loadWorld = useCallback(async (lat: number, lng: number) => {
    setLoading(true);
    setErrorMsg('');
    const res = await fetchCityWorldState(lat, lng);
    if (res.ok && res.state) {
      setWorldState(res.state);
      if (res.state.bounties.length > 0) {
        setSelectedBountyId((prev) => prev || res.state!.bounties[0].id);
      }
    } else {
      setErrorMsg(res.error || 'Could not load City World');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    let headingSub: Location.LocationSubscription | null = null;
    let posSub: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (active) {
            setErrorMsg('Location permission is required for City World.');
            setLoading(false);
          }
          return;
        }

        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!active) return;
        const fix = {
          latitude: initial.coords.latitude,
          longitude: initial.coords.longitude,
          accuracy: initial.coords.accuracy ?? 12,
        };
        setOwnFix(fix);
        void loadWorld(fix.latitude, fix.longitude);

        posSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 4000 },
          (loc) => {
            if (!active) return;
            setOwnFix({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy ?? 10,
            });
          }
        );

        headingSub = await Location.watchHeadingAsync((h) => {
          if (!active) return;
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (!isNaN(deg)) setHeadingDeg(deg);
        });
      } catch (err: any) {
        if (active) {
          setErrorMsg(err?.message || 'GPS unavailable');
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      posSub?.remove();
      headingSub?.remove();
    };
  }, [loadWorld]);

  const bounties = worldState?.bounties ?? [];
  const selectedBounty: CityBounty | null =
    bounties.find((b) => b.id === selectedBountyId) ?? bounties[0] ?? null;

  const turfGeoJson = useMemo(() => {
    const zones = worldState?.turf_zones ?? [];
    return {
      type: 'FeatureCollection' as const,
      features: zones.map((z) => buildTurfHexFeature(z, 120)),
    };
  }, [worldState?.turf_zones]);

  const bountyPinsGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: bounties.map((b) => ({
        type: 'Feature' as const,
        properties: {
          id: b.id,
          slot: b.slot_index,
          claimed: b.my_claim ? 1 : 0,
          selected: b.id === selectedBounty?.id ? 1 : 0,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [b.longitude, b.latitude],
        },
      })),
    };
  }, [bounties, selectedBounty?.id]);

  const ownFixGeoJson = useMemo(() => {
    if (!ownFix) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Point' as const,
            coordinates: [ownFix.longitude, ownFix.latitude],
          },
        },
      ],
    };
  }, [ownFix]);

  const handleFocusBounty = (bounty: CityBounty) => {
    triggerHaptic('buttonTap');
    setSelectedBountyId(bounty.id);
    cameraRef.current?.flyTo({
      center: [bounty.longitude, bounty.latitude],
      zoom: 16,
      duration: 500,
    });
  };

  const handleSubmitBountyShot = async (_opacityUsed: number, photoUri?: string) => {
    if (!selectedBounty || !ownFix || submitting) return;
    setSubmitting(true);
    setViewfinderOpen(false);
    try {
      const res = await submitCityBountyClaim({
        bountyId: selectedBounty.id,
        photoUri,
        fallbackPhotoUrl: selectedBounty.photo_url,
        lat: ownFix.latitude,
        lng: ownFix.longitude,
        heading: headingDeg,
      });
      if (res.ok) {
        triggerHaptic('tagConfirmed');
        setClaimBanner({
          score: res.score ?? 0,
          echoPts: res.echo_pts_awarded ?? 25,
          turfFlipped: Boolean(res.turf_flipped),
          distanceM: res.distance_error_meters ?? 0,
        });
        await loadWorld(ownFix.latitude, ownFix.longitude);
      } else {
        setErrorMsg(res.error || 'Could not claim bounty');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <MapLibreMap
        style={styles.map}
        mapStyle={isDark ? DARK_MAP_STYLE : DAY_MAP_STYLE}
        attribution={false}
        compass={false}
        logo={false}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: ownFix ? [ownFix.longitude, ownFix.latitude] : [72.842, 19.16],
            zoom: 15,
          }}
        />

        {turfGeoJson.features.length > 0 && (
          <GeoJSONSource id="city-turf-src" data={turfGeoJson}>
            <Layer
              id="city-turf-fill"
              type="fill"
              paint={{
                'fill-color': ['get', 'owner_color'],
                'fill-opacity': 0.22,
              }}
            />
            <Layer
              id="city-turf-line"
              type="line"
              paint={{
                'line-color': ['get', 'owner_color'],
                'line-width': 2,
                'line-opacity': 0.85,
              }}
            />
          </GeoJSONSource>
        )}

        {bountyPinsGeoJson.features.length > 0 && (
          <GeoJSONSource id="city-bounties-src" data={bountyPinsGeoJson}>
            <Layer
              id="city-bounties-ring"
              type="circle"
              paint={{
                'circle-radius': ['case', ['==', ['get', 'selected'], 1], 14, 10],
                'circle-color': ['case', ['==', ['get', 'claimed'], 1], '#10B981', '#00F0FF'],
                'circle-opacity': 0.28,
              }}
            />
            <Layer
              id="city-bounties-dot"
              type="circle"
              paint={{
                'circle-radius': 6,
                'circle-color': ['case', ['==', ['get', 'claimed'], 1], '#10B981', '#00F0FF'],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#0A0A0F',
              }}
            />
          </GeoJSONSource>
        )}

        {ownFixGeoJson && (
          <GeoJSONSource id="city-own-src" data={ownFixGeoJson}>
            <Layer
              id="city-own-dot"
              type="circle"
              paint={{
                'circle-radius': 7,
                'circle-color': '#C8FF00',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#0A0A0F',
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      {/* Top Tactical Header */}
      <View
        style={[
          styles.topBar,
          { paddingTop: Math.max(insets.top, 12) + 4 },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Play Hub"
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Pressable>

        <View style={[styles.headerPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={styles.headerEyebrow}>CITY WORLD // ZERO-LOBBY</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {worldState?.my_crew ? `CREW: ${worldState.my_crew.name}` : 'DAILY BOUNTIES & TURF'}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recenter map on GPS"
          onPress={() => {
            if (!ownFix) return;
            cameraRef.current?.flyTo({
              center: [ownFix.longitude, ownFix.latitude],
              zoom: 15.5,
              duration: 450,
            });
          }}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="locate" size={20} color="#C8FF00" />
        </Pressable>
      </View>

      {/* Claim Result Toast Banner */}
      {claimBanner && (
        <View style={[styles.claimToast, { top: Math.max(insets.top, 12) + 70 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.claimToastTitle}>
              BOUNTY CLAIMED // +{claimBanner.score} PTS (+{claimBanner.echoPts} ECHO)
            </Text>
            <Text style={styles.claimToastSub}>
              {claimBanner.distanceM.toFixed(1)}m from target
              {claimBanner.turfFlipped ? ' • TURF ZONE CAPTURED!' : ''}
            </Text>
          </View>
          <Pressable onPress={() => setClaimBanner(null)} hitSlop={10}>
            <Ionicons name="close" size={18} color="#94A3B8" />
          </Pressable>
        </View>
      )}

      {/* Bottom Daily Bounties Deck */}
      <View
        style={[
          styles.bottomDeck,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 14) + 8,
          },
        ]}
      >
        <View style={styles.deckHeaderRow}>
          <Text style={[styles.deckTitle, { flex: 1 }]} numberOfLines={1}>
            TODAY&apos;S BOUNTIES ({bounties.filter((b) => Boolean(b.my_claim)).length}/{bounties.length})
          </Text>
          <Text style={styles.deckMeta}>
            {worldState?.turf_zones.length ?? 0} TURF HEX
          </Text>
        </View>

        {loading && bounties.length === 0 ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#00F0FF" />
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>
              Scanning local OSM & Wikimedia landmarks…
            </Text>
          </View>
        ) : errorMsg && bounties.length === 0 ? (
          <Text style={{ color: '#FF5A5F', fontSize: 12, paddingVertical: 12 }}>{errorMsg}</Text>
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.bountyStrip}
            >
              {bounties.map((b) => {
                const isSelected = b.id === selectedBounty?.id;
                const dist = ownFix
                  ? Math.round(distanceM(ownFix, { latitude: b.latitude, longitude: b.longitude }))
                  : null;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => handleFocusBounty(b)}
                    style={[
                      styles.bountyCard,
                      {
                        borderColor: isSelected ? '#00F0FF' : colors.border,
                        backgroundColor: isSelected ? 'rgba(0, 240, 255, 0.08)' : colors.surfaceMuted,
                      },
                    ]}
                  >
                    <Image source={{ uri: b.photo_url }} style={styles.bountyThumb} resizeMode="cover" />
                    <View style={styles.bountyInfo}>
                      <Text style={styles.bountyTitle} numberOfLines={1}>
                        {b.title}
                      </Text>
                      <Text style={styles.bountySub}>
                        {dist !== null ? `${dist}m away` : 'Nearby'} • TOP {b.top_score}
                      </Text>
                      {b.my_claim ? (
                        <Text style={styles.bountyClaimed}>
                          CLAIMED • +{b.my_claim.echo_pts_awarded} ECHO
                        </Text>
                      ) : (
                        <Text style={styles.bountyOpen}>UNCLAIMED • +100 ECHO MAX</Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            {selectedBounty && (
              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={() => {
                  triggerHaptic('buttonTap');
                  setViewfinderOpen(true);
                }}
                style={[styles.huntBtn, submitting && { opacity: 0.6 }]}
              >
                {submitting ? (
                  <ActivityIndicator color="#0A0A0F" />
                ) : (
                  <>
                    <Ionicons name="camera" size={18} color="#0A0A0F" />
                    <Text style={styles.huntBtnText}>
                      {selectedBounty.my_claim ? 'RE-CAPTURE & BEAT SCORE' : 'HUNT & CAPTURE BOUNTY'}
                    </Text>
                  </>
                )}
              </Pressable>
            )}
          </>
        )}
      </View>

      {selectedBounty && (
        <PinpointViewfinder
          visible={viewfinderOpen}
          targetPhotoUrl={selectedBounty.photo_url}
          roundNumber={selectedBounty.slot_index}
          totalRounds={bounties.length || 3}
          currentHeadingDeg={headingDeg}
          gpsAccuracyM={ownFix?.accuracy ?? 10}
          mode="hunt"
          onClose={() => setViewfinderOpen(false)}
          onSubmitShot={(opacity, uri) => void handleSubmitBountyShot(opacity, uri)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 20,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPill: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  headerEyebrow: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    color: '#00F0FF',
    letterSpacing: 1,
  },
  headerTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    marginTop: 1,
  },
  claimToast: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 25,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#C8FF00',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  claimToastTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    color: '#C8FF00',
  },
  claimToastSub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 11,
    color: '#E2E8F0',
    marginTop: 2,
  },
  bottomDeck: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 14,
    zIndex: 20,
  },
  deckHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  deckTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    color: '#00F0FF',
    letterSpacing: 0.6,
  },
  deckMeta: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#94A3B8',
    letterSpacing: 0.6,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  bountyStrip: {
    gap: 10,
    paddingBottom: 12,
  },
  bountyCard: {
    width: 225,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 8,
  },
  bountyThumb: {
    width: 56,
    height: 56,
    borderRadius: 6,
  },
  bountyInfo: {
    flex: 1,
    gap: 2,
  },
  bountyTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    color: '#F1F5F9',
  },
  bountySub: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    color: '#94A3B8',
  },
  bountyClaimed: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#10B981',
  },
  bountyOpen: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#C8FF00',
  },
  huntBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#C8FF00',
    borderRadius: 10,
    paddingVertical: 13,
  },
  huntBtnText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    color: '#0A0A0F',
    letterSpacing: 0.8,
  },
});
