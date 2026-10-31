import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { supabase } from '../src/lib/supabase';

const GHOSTRUN_LOGO = require('../assets/logos/android-chrome-512x512.png');

interface SlideData {
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  description: string;
  bullets: { icon: string; title: string; desc: string }[];
  sceneType: 'chase' | 'target' | 'safety';
}

const SLIDES: SlideData[] = [
  {
    badge: 'GAME MODE 01 · CHASE',
    badgeColor: '#38BDF8',
    title: 'Classic Chase',
    subtitle: 'Live-Action Real-World Manhunt',
    description:
      'Runners scatter across physical streets to hide. Hunters receive periodic radar pings showing where runners were, requiring deduction, timing, and stealth.',
    bullets: [
      {
        icon: '🏃',
        title: 'Head Start',
        desc: 'Runners get physical time to scatter and hide before hunters unlock.',
      },
      {
        icon: '📡',
        title: 'Delayed Radar',
        desc: 'Hunters only see historical pings, never live real-time runner dots.',
      },
      {
        icon: '🎯',
        title: 'Physical Tag (20m)',
        desc: 'Close the distance to within the tag radius and hit TAG to catch runners.',
      },
    ],
    sceneType: 'chase',
  },
  {
    badge: 'GAME MODE 02 · EXTRACTION',
    badgeColor: '#F43F5E',
    title: 'The Secret Target',
    subtitle: 'High-Stakes Extraction Race',
    description:
      'Runners race against the round timer to reach an undisclosed secret extraction point, while hunters patrol the territory to intercept them before they arrive.',
    bullets: [
      {
        icon: '📍',
        title: 'Runners-Only Intel',
        desc: 'The target location is secret and only visible to the runner team.',
      },
      {
        icon: '🏆',
        title: 'Instant Extraction Win',
        desc: 'Touch the secret target before time expires to win the match!',
      },
      {
        icon: '⚠️',
        title: 'Boundary Penalties',
        desc: 'Straying outside the arena perimeter triggers extra pings for hunters.',
      },
    ],
    sceneType: 'target',
  },
  {
    badge: 'ESSENTIALS · SAFETY FIRST',
    badgeColor: '#10B981',
    title: 'Tactics & Safety',
    subtitle: 'Play Smart. Stay Protected.',
    description:
      'Coordinate with teammates via live encrypted location, spectate if tagged, and rely on real-world safety with our 1-tap Emergency SOS broadcast.',
    bullets: [
      {
        icon: '👥',
        title: 'Team Location Sharing',
        desc: 'Teammates see your live position in real time; enemies only see pings.',
      },
      {
        icon: '👁️',
        title: 'Tactical Spectator Mode',
        desc: 'Tagged players watch the remainder of the battle unfold live on the radar.',
      },
      {
        icon: '🚨',
        title: 'Emergency SOS & 112',
        desc: '1-tap emergency broadcast to all players and direct dialer to emergency services.',
      },
    ],
    sceneType: 'safety',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<import('react').ElementRef<typeof ScrollView>>(null);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / screenWidth);
    if (index !== activeIndex && index >= 0 && index < SLIDES.length) {
      setActiveIndex(index);
    }
  };

  const handleNext = () => {
    if (activeIndex < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({
        x: (activeIndex + 1) * screenWidth,
        animated: true,
      });
      setActiveIndex(activeIndex + 1);
    } else {
      void completeOnboarding();
    }
  };

  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem('@ghostrun:onboarded', 'true');
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace('/home');
          return;
        }
      }
      router.replace('/auth');
    } catch {
      router.replace('/auth');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <Image accessibilityLabel="GhostRun" source={GHOSTRUN_LOGO} style={styles.headerLogo} />
          <Text style={styles.headerTitle}>GHOSTRUN</Text>
        </View>

        {activeIndex < SLIDES.length - 1 ? (
          <Pressable
            accessibilityLabel="Skip tutorial"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => void completeOnboarding()}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : (
          <View style={styles.headerPlaceholder} />
        )}
      </View>

      {/* Paging Slides */}
      <ScrollView
        bounces={false}
        decelerationRate="fast"
        horizontal
        onScroll={handleScroll}
        pagingEnabled
        ref={scrollRef}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={styles.slider}
      >
        {SLIDES.map((slide, idx) => (
          <View key={slide.title} style={[styles.slide, { width: screenWidth }]}>
            {/* Slide Hero Illustration */}
            <View style={styles.illustrationWrapper}>
              {slide.sceneType === 'chase' && <ChaseIllustration />}
              {slide.sceneType === 'target' && <TargetIllustration />}
              {slide.sceneType === 'safety' && <SafetyIllustration />}
            </View>

            {/* Slide Content Card */}
            <View style={styles.contentCard}>
              <View style={[styles.badge, { borderColor: slide.badgeColor }]}>
                <Text style={[styles.badgeText, { color: slide.badgeColor }]}>{slide.badge}</Text>
              </View>

              <Text style={styles.slideTitle}>{slide.title}</Text>
              <Text style={styles.slideSubtitle}>{slide.subtitle}</Text>
              <Text style={styles.slideDescription}>{slide.description}</Text>

              <View style={styles.bulletsList}>
                {slide.bullets.map((b) => (
                  <View key={b.title} style={styles.bulletRow}>
                    <Text style={styles.bulletIcon}>{b.icon}</Text>
                    <View style={styles.bulletBody}>
                      <Text style={styles.bulletTitle}>{b.title}</Text>
                      <Text style={styles.bulletDesc}>{b.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Footer Controls */}
      <View style={styles.footer}>
        {/* Pagination Dots */}
        <View style={styles.dotsContainer}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === activeIndex ? styles.dotActive : styles.dotInactive]}
            />
          ))}
        </View>

        {/* Action Button */}
        <Pressable
          accessibilityRole="button"
          onPress={handleNext}
          style={[
            styles.actionButton,
            activeIndex === SLIDES.length - 1 && styles.actionButtonFinal,
          ]}
        >
          <Text style={styles.actionButtonText}>
            {activeIndex === SLIDES.length - 1 ? 'Enter GhostRun ⚡' : 'Next  ➔'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// Visual Illustration for Slide 1 (Classic Chase)
function ChaseIllustration() {
  return (
    <View style={styles.sceneContainer}>
      <View style={styles.radarCircleOuter} />
      <View style={styles.radarCircleMiddle} />
      <View style={styles.radarCircleInner} />
      <View style={styles.radarAxisX} />
      <View style={styles.radarAxisY} />

      {/* Runner Dot with breadcrumbs */}
      <View style={styles.runnerTrailPoint1} />
      <View style={styles.runnerTrailPoint2} />
      <View style={styles.runnerPoint}>
        <Text style={styles.pointEmoji}>🏃</Text>
      </View>

      {/* Hunter Ping Ripple */}
      <View style={styles.hunterPingWave} />
      <View style={styles.hunterPoint}>
        <Text style={styles.pointEmoji}>🎯</Text>
      </View>

      {/* Tag Proximity Ring */}
      <View style={styles.tagRingLabelBox}>
        <Text style={styles.tagRingLabel}>TAG RADIUS · 20M</Text>
      </View>
    </View>
  );
}

// Visual Illustration for Slide 2 (Tag Hunt & Secret Target)
function TargetIllustration() {
  return (
    <View style={styles.sceneContainer}>
      <View style={[styles.radarCircleOuter, { borderColor: 'rgba(244, 63, 94, 0.15)' }]} />
      <View style={[styles.radarCircleMiddle, { borderColor: 'rgba(244, 63, 94, 0.25)' }]} />

      {/* Target Extraction Point */}
      <View style={styles.targetBeaconHalo} />
      <View style={styles.targetBeacon}>
        <Text style={styles.pointEmoji}>📍</Text>
      </View>

      {/* Route dashed line indicators */}
      <View style={styles.routeWaypoint1} />
      <View style={styles.routeWaypoint2} />
      <View style={styles.runnerExtractionPoint}>
        <Text style={styles.pointEmoji}>🏃</Text>
      </View>

      {/* Hunter intercept vector */}
      <View style={styles.hunterInterceptPoint}>
        <Text style={styles.pointEmoji}>🕵️</Text>
      </View>

      <View style={styles.targetLabelBox}>
        <Text style={styles.targetLabel}>SECRET EXTRACTION BEACON</Text>
      </View>
    </View>
  );
}

// Visual Illustration for Slide 3 (Tactics & Safety)
function SafetyIllustration() {
  return (
    <View style={styles.sceneContainer}>
      <View style={[styles.radarCircleOuter, { borderColor: 'rgba(16, 185, 129, 0.12)' }]} />

      {/* Safety Shield Core */}
      <View style={styles.safetyCard}>
        <View style={styles.safetyHeaderRow}>
          <Text style={styles.safetyShieldIcon}>🛡️</Text>
          <View>
            <Text style={styles.safetyCardTitle}>EMERGENCY PROTOCOL</Text>
            <Text style={styles.safetyCardSub}>Real-Time GPS Broadcast</Text>
          </View>
        </View>

        <View style={styles.sosButtonDemo}>
          <Text style={styles.sosButtonDemoText}>🚨 HOLD FOR SOS</Text>
        </View>

        <View style={styles.dialerRow}>
          <Text style={styles.dialerBadge}>DIALS 112</Text>
          <Text style={styles.safetyAlertDesc}>Instant Crew Alert</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#090D16',
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 54,
    paddingBottom: 12,
  },
  headerBrand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  headerLogo: {
    borderRadius: 8,
    height: 30,
    width: 30,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  skipButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  skipText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
  },
  headerPlaceholder: {
    width: 44,
  },
  slider: {
    flex: 1,
  },
  slide: {
    flex: 1,
    paddingHorizontal: 22,
  },
  illustrationWrapper: {
    alignItems: 'center',
    height: 180,
    justifyContent: 'center',
    marginTop: 8,
  },
  sceneContainer: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    borderRadius: 20,
    borderWidth: 1,
    height: 170,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  radarCircleOuter: {
    borderColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: 120,
    borderWidth: 1,
    height: 240,
    position: 'absolute',
    width: 240,
  },
  radarCircleMiddle: {
    borderColor: 'rgba(56, 189, 248, 0.16)',
    borderRadius: 80,
    borderWidth: 1,
    height: 160,
    position: 'absolute',
    width: 160,
  },
  radarCircleInner: {
    borderColor: 'rgba(56, 189, 248, 0.22)',
    borderRadius: 40,
    borderWidth: 1,
    height: 80,
    position: 'absolute',
    width: 80,
  },
  radarAxisX: {
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    height: 1,
    position: 'absolute',
    width: '100%',
  },
  radarAxisY: {
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    height: '100%',
    position: 'absolute',
    width: 1,
  },
  runnerPoint: {
    alignItems: 'center',
    backgroundColor: '#059669',
    borderColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 2,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 70,
    top: 36,
    width: 28,
  },
  runnerTrailPoint1: {
    backgroundColor: 'rgba(5, 150, 105, 0.4)',
    borderRadius: 5,
    height: 10,
    position: 'absolute',
    right: 105,
    top: 55,
    width: 10,
  },
  runnerTrailPoint2: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: 128,
    top: 72,
    width: 8,
  },
  hunterPoint: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 2,
    height: 28,
    justifyContent: 'center',
    left: 60,
    position: 'absolute',
    top: 85,
    width: 28,
  },
  hunterPingWave: {
    borderColor: 'rgba(37, 99, 235, 0.4)',
    borderRadius: 35,
    borderWidth: 2,
    height: 70,
    left: 39,
    position: 'absolute',
    top: 64,
    width: 70,
  },
  pointEmoji: {
    fontSize: 13,
  },
  tagRingLabelBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderColor: '#38BDF8',
    borderRadius: 10,
    borderWidth: 1,
    bottom: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: 'absolute',
  },
  tagRingLabel: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  targetBeaconHalo: {
    backgroundColor: 'rgba(244, 63, 94, 0.15)',
    borderColor: '#F43F5E',
    borderRadius: 36,
    borderWidth: 1.5,
    height: 72,
    position: 'absolute',
    right: 50,
    top: 25,
    width: 72,
  },
  targetBeacon: {
    alignItems: 'center',
    backgroundColor: '#E11D48',
    borderColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: 68,
    top: 43,
    width: 36,
  },
  runnerExtractionPoint: {
    alignItems: 'center',
    backgroundColor: '#059669',
    borderColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 2,
    bottom: 35,
    height: 28,
    justifyContent: 'center',
    left: 55,
    position: 'absolute',
    width: 28,
  },
  routeWaypoint1: {
    borderColor: '#10B981',
    borderRadius: 4,
    borderStyle: 'dashed',
    borderWidth: 2,
    bottom: 58,
    height: 8,
    left: 100,
    position: 'absolute',
    width: 8,
  },
  routeWaypoint2: {
    borderColor: '#10B981',
    borderRadius: 4,
    borderStyle: 'dashed',
    borderWidth: 2,
    bottom: 80,
    height: 8,
    left: 145,
    position: 'absolute',
    width: 8,
  },
  hunterInterceptPoint: {
    alignItems: 'center',
    backgroundColor: '#D97706',
    borderColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 2,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 120,
    top: 25,
    width: 28,
  },
  targetLabelBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderColor: '#F43F5E',
    borderRadius: 10,
    borderWidth: 1,
    bottom: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: 'absolute',
  },
  targetLabel: {
    color: '#F43F5E',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  safetyCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderColor: '#334155',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    width: '88%',
  },
  safetyHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  safetyShieldIcon: {
    fontSize: 20,
  },
  safetyCardTitle: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  safetyCardSub: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },
  sosButtonDemo: {
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 8,
    justifyContent: 'center',
    paddingVertical: 6,
    width: '100%',
  },
  sosButtonDemoText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  dialerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  dialerBadge: {
    backgroundColor: '#7F1D1D',
    borderRadius: 4,
    color: '#FECACA',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  safetyAlertDesc: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '700',
  },
  contentCard: {
    flex: 1,
    marginTop: 10,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  slideTitle: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  slideSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  slideDescription: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  bulletsList: {
    gap: 8,
    marginTop: 10,
  },
  bulletRow: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderColor: 'rgba(51, 65, 85, 0.6)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 8,
  },
  bulletIcon: {
    fontSize: 16,
    marginTop: 2,
  },
  bulletBody: {
    flex: 1,
  },
  bulletTitle: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '800',
  },
  bulletDesc: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  footer: {
    alignItems: 'center',
    borderTopColor: '#1E293B',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 18,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    borderRadius: 4,
    height: 8,
  },
  dotActive: {
    backgroundColor: '#38BDF8',
    width: 24,
  },
  dotInactive: {
    backgroundColor: '#334155',
    width: 8,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 22,
  },
  actionButtonFinal: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 26,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
