import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  Image,
  ImageSourcePropType,
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
const SLIDE_1_DARK = require('../assets/onboarding/slide-1-dark.png');
const SLIDE_2_DARK = require('../assets/onboarding/slide-2-dark.png');
const SLIDE_3_DARK = require('../assets/onboarding/slide-3-dark.png');

interface SlideData {
  image: ImageSourcePropType;
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  description: string;
  bullets: { icon: string; title: string; desc: string }[];
}

const SLIDES: SlideData[] = [
  {
    image: SLIDE_1_DARK,
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
  },
  {
    image: SLIDE_2_DARK,
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
  },
  {
    image: SLIDE_3_DARK,
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
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<import('react').ElementRef<typeof ScrollView>>(null);

  const imageHeight = Math.max(220, Math.min(320, Math.round(screenHeight * 0.36)));

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

      {/* Horizontal Paging Slides */}
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
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width: screenWidth }]}>
            {/* Visual Hero Card with Bottom Gradient Fade */}
            <View style={[styles.imageCard, { height: imageHeight }]}>
              <Image
                accessibilityLabel={slide.title}
                resizeMode="cover"
                source={slide.image}
                style={styles.slideImage}
              />
              <LinearGradient
                colors={['transparent', 'rgba(9, 13, 22, 0.35)', 'rgba(9, 13, 22, 0.8)', '#090D16']}
                locations={[0, 0.5, 0.82, 1]}
                style={styles.imageBottomGradient}
              />
            </View>

            {/* Slide Content */}
            <ScrollView
              contentContainerStyle={styles.contentScrollContainer}
              showsVerticalScrollIndicator={false}
              style={styles.contentScrollView}
            >
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
            </ScrollView>
          </View>
        ))}
      </ScrollView>

      {/* Floating Footer with Ambient Gradient */}
      <View style={styles.footerWrapper}>
        <LinearGradient
          colors={['transparent', 'rgba(9, 13, 22, 0.85)', '#090D16']}
          locations={[0, 0.45, 1]}
          pointerEvents="none"
          style={styles.footerGradient}
        />
        <View style={styles.footer}>
          {/* Pagination Indicator Dots */}
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
    paddingBottom: 8,
    paddingHorizontal: 22,
    paddingTop: 52,
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
    paddingHorizontal: 20,
  },
  imageCard: {
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 6,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  slideImage: {
    height: '100%',
    width: '100%',
  },
  imageBottomGradient: {
    bottom: 0,
    height: '52%',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  contentScrollView: {
    flex: 1,
  },
  contentScrollContainer: {
    paddingBottom: 90,
    paddingTop: 12,
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
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 0.4,
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
    backgroundColor: 'rgba(30, 41, 59, 0.65)',
    borderColor: 'rgba(51, 65, 85, 0.65)',
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
  footerWrapper: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  footerGradient: {
    height: 90,
    left: 0,
    position: 'absolute',
    right: 0,
    top: -20,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 24,
    paddingHorizontal: 22,
    paddingTop: 8,
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
