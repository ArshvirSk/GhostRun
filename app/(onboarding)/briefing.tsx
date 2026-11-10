import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';
import { CORE_TOUR_SCRIPT } from '../../src/tour/scripts/core';
import { TourPlayer } from '../../src/tour/TourPlayer';

export default function BriefingScreen() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (data?.session) {
          setIsAuthenticated(true);
        }
      });
    }
  }, []);

  const handleSignUp = () => {
    router.push('/signup/name' as any);
  };

  const handleSignIn = () => {
    router.push('/signin' as any);
  };

  const handleHostGame = async () => {
    await AsyncStorage.setItem('@ghostrun:onboarded', 'true');
    if (isAuthenticated) {
      router.push('/host/mode' as any);
    } else {
      router.push('/signin' as any);
    }
  };

  const handleJoinCode = async () => {
    await AsyncStorage.setItem('@ghostrun:onboarded', 'true');
    if (isAuthenticated) {
      router.push('/join' as any);
    } else {
      router.push('/signin' as any);
    }
  };

  const handleDemoRound = async () => {
    await AsyncStorage.setItem('@ghostrun:onboarded', 'true');
    if (isAuthenticated) {
      router.push('/play' as any);
    } else {
      router.push('/signin' as any);
    }
  };

  const handleFinish = async () => {
    await AsyncStorage.setItem('@ghostrun:onboarded', 'true');
    if (isAuthenticated) {
      router.replace('/play' as any);
    } else {
      router.push('/signin' as any);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.playerContainer}>
        <TourPlayer
          isAuthenticated={isAuthenticated}
          onFinish={handleFinish}
          onSignIn={handleSignIn}
          onSignUp={handleSignUp}
          onHostGame={handleHostGame}
          onJoinCode={handleJoinCode}
          onDemoRound={handleDemoRound}
          script={CORE_TOUR_SCRIPT}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  playerContainer: {
    flex: 1,
  },
});
