import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CORE_TOUR_SCRIPT } from '../../src/tour/scripts/core';
import { TourPlayer } from '../../src/tour/TourPlayer';
import { colors } from '../../src/theme/tokens';

export default function BriefingScreen() {
  const router = useRouter();

  const handleFinish = () => {
    router.replace('/play' as any);
  };

  const handleSkip = () => {
    router.replace('/play' as any);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.playerContainer}>
        <TourPlayer
          onFinish={handleFinish}
          onSkip={handleSkip}
          script={CORE_TOUR_SCRIPT}
        />
      </View>
    </SafeAreaView>
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
