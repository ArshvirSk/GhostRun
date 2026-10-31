import { Camera, Map, UserLocation } from '../src/lib/map';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';

import { supabase } from '../src/lib/supabase';

const DEFAULT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const MAP_STYLE = process.env.EXPO_PUBLIC_MAP_STYLE_URL || DEFAULT_MAP_STYLE;

type Profile = { display_name: string; color: string };

export default function HomeScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [permission, setPermission] = useState<Location.LocationPermissionResponse | null>(null);
  const [permissionError, setPermissionError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (supabase) {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          const { data, error } = await supabase
            .from('profiles')
            .select('display_name, color')
            .eq('id', userData.user.id)
            .maybeSingle();
          if (mounted) {
            if (error) setProfileError(error.message);
            else setProfile(data);
          }
        }
      }

      const existingPermission = await Location.getForegroundPermissionsAsync();
      if (mounted) setPermission(existingPermission);
    }

    void load().catch((error: unknown) => {
      if (mounted)
        setPermissionError(
          error instanceof Error ? error.message : 'Could not check location permission.',
        );
    });

    return () => {
      mounted = false;
    };
  }, []);

  async function signOut() {
    if (!supabase || signingOut) return;
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setProfileError(error.message);
      setSigningOut(false);
      return;
    }
    router.replace('/auth');
  }

  async function requestLocation() {
    setRequesting(true);
    setPermissionError('');
    try {
      const result = await Location.requestForegroundPermissionsAsync();
      setPermission(result);
      if (!result.granted)
        setPermissionError('Location permission is needed to show your position on the map.');
    } catch (error: unknown) {
      setPermissionError(
        error instanceof Error ? error.message : 'Could not request location permission.',
      );
    } finally {
      setRequesting(false);
    }
  }

  return (
    <View style={styles.screen}>
      {permission?.granted ? (
        <Map attribution mapStyle={MAP_STYLE} style={StyleSheet.absoluteFill}>
          <Camera initialViewState={{ center: [-97, 38], zoom: 3 }} trackUserLocation="default" />
          <UserLocation accuracy />
        </Map>
      ) : (
        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapIcon}>◎</Text>
          <Text style={styles.mapTitle}>Your map starts here</Text>
          <Text style={styles.mapDescription}>
            GhostRun needs foreground location permission to show your current position. It is not
            uploaded from this home screen.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={requesting}
            onPress={() => void requestLocation()}
            style={styles.permissionButton}
          >
            {requesting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.permissionButtonText}>Allow location</Text>
            )}
          </Pressable>
          {permissionError !== '' && (
            <Text accessibilityRole="alert" style={styles.error}>
              {permissionError}
            </Text>
          )}
        </View>
      )}

      <View style={styles.topCard}>
        <View style={[styles.avatar, { backgroundColor: profile?.color ?? '#1D4ED8' }]}>
          <Text style={styles.avatarText}>
            {profile?.display_name?.slice(0, 1).toUpperCase() ?? 'G'}
          </Text>
        </View>
        <View style={styles.profileText}>
          <Text style={styles.brand}>GHOSTRUN</Text>
          <Text style={styles.welcome}>
            {profile ? `Welcome, ${profile.display_name}` : 'Your location map'}
          </Text>
          {profileError !== '' && (
            <Text accessibilityRole="alert" style={styles.profileError}>
              {profileError}
            </Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={signingOut}
          onPress={() => void signOut()}
          style={styles.signOut}
        >
          {signingOut ? (
            <ActivityIndicator color="#1D4ED8" size="small" />
          ) : (
            <Text style={styles.signOutText}>Sign out</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.bottomCard}>
        <Text style={styles.bottomTitle}>Ready when your crew is.</Text>
        <Text style={styles.bottomText}>Create a lobby or join your crew with a code.</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/create')}
            style={styles.primaryAction}
          >
            <Text style={styles.primaryActionText}>Create game</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/join')}
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>Join game</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#E2E8F0', flex: 1 },
  mapPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  mapIcon: { color: '#1D4ED8', fontSize: 64, lineHeight: 74 },
  mapTitle: { color: '#0F172A', fontSize: 24, fontWeight: '800', marginTop: 12 },
  mapDescription: {
    color: '#334155',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
    textAlign: 'center',
  },
  permissionButton: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 22,
    minHeight: 52,
    paddingHorizontal: 24,
  },
  permissionButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  error: { color: '#991B1B', fontSize: 14, marginTop: 14, textAlign: 'center' },
  topCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    elevation: 5,
    flexDirection: 'row',
    left: 18,
    padding: 14,
    position: 'absolute',
    right: 18,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    top: 54,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  avatarText: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  profileText: { flex: 1, marginLeft: 12 },
  brand: { color: '#1D4ED8', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  welcome: { color: '#0F172A', fontSize: 16, fontWeight: '800', marginTop: 3 },
  profileError: { color: '#B91C1C', fontSize: 11, marginTop: 4 },
  signOut: { justifyContent: 'center', marginLeft: 8, minHeight: 40, paddingHorizontal: 6 },
  signOutText: { color: '#1D4ED8', fontSize: 13, fontWeight: '800' },
  bottomCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    bottom: 26,
    elevation: 5,
    left: 18,
    padding: 18,
    position: 'absolute',
    right: 18,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  bottomTitle: { color: '#0F172A', fontSize: 18, fontWeight: '800' },
  bottomText: { color: '#475569', fontSize: 14, lineHeight: 20, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 11,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryActionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: '#DBEAFE',
    borderRadius: 11,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryActionText: { color: '#1D4ED8', fontSize: 15, fontWeight: '800' },
});
