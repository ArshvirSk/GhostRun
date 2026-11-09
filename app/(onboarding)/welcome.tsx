import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RadarSweep } from '../../src/motion/RadarSweep';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { Button } from '../../src/ui/Button';
import { Text } from '../../src/ui/Text';

const GHOSTRUN_LOGO = require('../../assets/logos/android-chrome-512x512.png');

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Ambient Radar Background */}
      <View pointerEvents="none" style={styles.ambientContainer}>
        <RadarSweep color={colors.primaryLight} size={320} />
      </View>

      {/* Main Hero Section */}
      <View style={styles.heroSection}>
        <View style={styles.logoWrapper}>
          <Image
            accessibilityLabel="GhostRun Tactical Logo"
            fadeDuration={0}
            source={GHOSTRUN_LOGO}
            style={styles.logo}
          />
        </View>

        <Text style={styles.eyebrow} variant="label">
          REAL-WORLD GPS CHASE
        </Text>

        <Text style={styles.title} variant="hero">
          GHOSTRUN
        </Text>

        <Text style={styles.tagline} variant="subtitle">
          Step onto the radar. Outrun your friends, evade delayed pings, and hunt the ghosts in
          the streets.
        </Text>
      </View>

      {/* Action Section */}
      <View style={styles.actionSection}>
        <Button
          accessibilityHint="Starts player registration and takes you to codename selection"
          onPress={() => router.push('/signup/name' as any)}
          size="lg"
          title="Enter the Grid"
          variant="primary"
        />

        <View style={styles.secondaryActions}>
          <Button
            accessibilityHint="Sign in with existing credentials"
            onPress={() => router.push('/signin' as any)}
            size="md"
            title="I already have an account"
            variant="secondary"
          />

          <Button
            accessibilityHint="Watch the 8-beat animated briefing tour"
            onPress={() => router.push('/briefing' as any)}
            size="sm"
            title="Preview Briefing Tour"
            variant="ghost"
          />
        </View>

        <Text style={styles.disclaimer} variant="caption">
          Outdoor play requires GPS location and movement in safe public areas.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  ambientContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.35,
  },
  heroSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxl,
  },
  logoWrapper: {
    width: 96,
    height: 96,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  logo: {
    width: 72,
    height: 72,
    resizeMode: 'contain',
  },
  eyebrow: {
    color: colors.primary,
    letterSpacing: 3,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  title: {
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  tagline: {
    textAlign: 'center',
    color: colors.textMuted,
    lineHeight: 24,
    maxWidth: 320,
  },
  actionSection: {
    width: '100%',
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  secondaryActions: {
    gap: spacing.xs,
  },
  disclaimer: {
    textAlign: 'center',
    color: colors.textSubtle,
    marginTop: spacing.xs,
  },
});
