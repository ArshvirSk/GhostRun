import { Ionicons } from '@expo/vector-icons';
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
// Light slide illustrations are used for onboarding (dark variations retained in assets/onboarding for reference)
const SLIDE_1_LIGHT = require('../assets/onboarding/slide-1-light.png');
const SLIDE_2_LIGHT = require('../assets/onboarding/slide-2-light.png');
const SLIDE_3_LIGHT = require('../assets/onboarding/slide-3-light.png');

interface SlideData {
  image: ImageSourcePropType;
  badge: string;
  badgeColor: string;
  title: string;
  description: string;
}

const SLIDES: SlideData[] = [
  {
    image: SLIDE_1_LIGHT,
    badge: 'REAL-WORLD MANHUNT',
    badgeColor: '#38BDF8',
    title: 'Feel The Real Adrenaline',
    description:
      'Step out into your city where every alleyway is an escape route and every shadow could be a runner closing in.',
  },
  {
    image: SLIDE_2_LIGHT,
    badge: 'LIVE RADAR PURSUIT',
    badgeColor: '#F43F5E',
    title: 'Heart-Pounding Radar Hunt',
    description:
      'Watch the radar ping in real time, feel your pulse spike with every second, and make split-second sprints to survive.',
  },
  {
    image: SLIDE_3_LIGHT,
    badge: 'ULTIMATE OUTDOOR RUSH',
    badgeColor: '#10B981',
    title: 'Outrun Your Friends',
    description:
      'Ditch the screens, rally your crew outdoors, and experience the most thrilling physical game of stealth and speed.',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<import('react').ElementRef<typeof ScrollView>>(null);
  const isProgrammaticScroll = useRef(false);

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isProgrammaticScroll.current = false;
    const offsetX = e.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / screenWidth);
    if (index >= 0 && index < SLIDES.length) {
      setActiveIndex(index);
    }
  };

  const goToSlide = (targetIndex: number) => {
    if (targetIndex >= 0 && targetIndex < SLIDES.length && targetIndex !== activeIndex) {
      isProgrammaticScroll.current = true;
      setActiveIndex(targetIndex);
      scrollRef.current?.scrollTo({
        x: targetIndex * screenWidth,
        animated: true,
      });
    }
  };

  const handleNext = () => {
    if (activeIndex < SLIDES.length - 1) {
      goToSlide(activeIndex + 1);
    } else {
      void completeOnboarding();
    }
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      goToSlide(activeIndex - 1);
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

      {/* Floating Top Header */}
      <View style={styles.floatingHeader}>
        <View style={styles.brandRow}>
          <Image
            accessibilityLabel="GhostRun"
            fadeDuration={0}
            source={GHOSTRUN_LOGO}
            style={styles.brandLogo}
          />
          <Text style={styles.brandTitle}>GHOSTRUN</Text>
        </View>

        <Pressable
          accessibilityLabel="Skip onboarding"
          accessibilityRole="button"
          disabled={activeIndex === SLIDES.length - 1}
          hitSlop={12}
          onPress={() => void completeOnboarding()}
          style={({ pressed }) => [
            styles.skipButton,
            activeIndex === SLIDES.length - 1 && styles.skipButtonHidden,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      {/* Full-Screen Swiping Slides */}
      <ScrollView
        bounces={false}
        horizontal
        onMomentumScrollEnd={onMomentumScrollEnd}
        overScrollMode="never"
        pagingEnabled
        ref={scrollRef}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={styles.slider}
      >
        {SLIDES.map((slide) => (
          <View
            key={slide.title}
            style={[styles.slidePage, { width: screenWidth, height: screenHeight }]}
          >
            {/* Full-Screen Edge-to-Edge Illustration */}
            <Image
              accessibilityLabel={slide.title}
              fadeDuration={0}
              resizeMode="cover"
              source={slide.image}
              style={StyleSheet.absoluteFill}
            />

            {/* Top Scrim Gradient for Header Legibility */}
            <LinearGradient
              colors={['rgba(7, 10, 18, 0.75)', 'rgba(7, 10, 18, 0.25)', 'transparent']}
              locations={[0, 0.5, 1]}
              pointerEvents="none"
              style={styles.topScrim}
            />

            {/* Bottom Cinematic Gradient Fade */}
            <LinearGradient
              colors={[
                'transparent',
                'rgba(8, 12, 22, 0.35)',
                'rgba(8, 12, 22, 0.78)',
                'rgba(8, 12, 22, 0.95)',
                '#080C16',
              ]}
              locations={[0, 0.28, 0.58, 0.82, 1]}
              pointerEvents="none"
              style={styles.bottomGradient}
            />

            {/* Content Overlay Anchored on Gradient */}
            <View style={styles.slideContent}>
              <View style={[styles.badge, { borderColor: slide.badgeColor }]}>
                <View style={[styles.badgeDot, { backgroundColor: slide.badgeColor }]} />
                <Text style={[styles.badgeText, { color: slide.badgeColor }]}>{slide.badge}</Text>
              </View>

              <Text numberOfLines={2} style={styles.title}>
                {slide.title}
              </Text>

              <Text numberOfLines={2} style={styles.description}>
                {slide.description}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Persistent Bottom Controls (Slide Status + Navigation Buttons) */}
      <View style={styles.controlsDock}>
        {/* Slide Status Indicator Dots */}
        <View style={styles.dotsRow}>
          {SLIDES.map((slide, i) => (
            <Pressable
              accessibilityLabel={`Go to slide ${i + 1}`}
              accessibilityRole="button"
              hitSlop={8}
              key={slide.title}
              onPress={() => goToSlide(i)}
              style={[
                styles.dot,
                i === activeIndex
                  ? [styles.dotActive, { backgroundColor: SLIDES[activeIndex].badgeColor }]
                  : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        {/* Action Button Row with Rock-Solid Fixed Geometry */}
        <View style={styles.buttonRow}>
          <Pressable
            accessibilityLabel="Previous slide"
            accessibilityRole="button"
            disabled={activeIndex === 0}
            onPress={handlePrev}
            style={({ pressed }) => [
              styles.prevButton,
              activeIndex === 0 && styles.prevButtonHidden,
              pressed && activeIndex > 0 && styles.buttonPressed,
            ]}
          >
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>

          <Pressable
            accessibilityLabel={activeIndex === SLIDES.length - 1 ? 'Start Running' : 'Next slide'}
            accessibilityRole="button"
            onPress={handleNext}
            style={({ pressed }) => [
              styles.nextButton,
              activeIndex === SLIDES.length - 1 && styles.nextButtonFinal,
              pressed && styles.buttonPressed,
            ]}
          >
            <View style={styles.nextButtonContent}>
              <Text style={styles.nextButtonText}>
                {activeIndex === SLIDES.length - 1 ? 'Start Running' : 'Continue'}
              </Text>
              <Ionicons
                color="#FFFFFF"
                name={activeIndex === SLIDES.length - 1 ? 'flash' : 'arrow-forward'}
                size={18}
              />
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#080C16',
    flex: 1,
  },
  floatingHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 22,
    paddingTop: 52,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 20,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  brandLogo: {
    borderRadius: 8,
    height: 32,
    width: 32,
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  skipButton: {
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  skipButtonHidden: {
    opacity: 0,
    pointerEvents: 'none',
  },
  skipText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  slider: {
    flex: 1,
  },
  slidePage: {
    justifyContent: 'flex-end',
    position: 'relative',
  },
  topScrim: {
    height: 140,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  bottomGradient: {
    bottom: 0,
    height: '62%',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  slideContent: {
    paddingBottom: 150,
    paddingHorizontal: 26,
    zIndex: 10,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 38,
    marginBottom: 10,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  description: {
    color: '#CBD5E1',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  controlsDock: {
    bottom: 0,
    left: 0,
    paddingBottom: 42,
    paddingHorizontal: 24,
    position: 'absolute',
    right: 0,
    zIndex: 20,
  },
  dotsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 20,
  },
  dot: {
    borderRadius: 4,
    height: 6,
  },
  dotActive: {
    width: 28,
  },
  dotInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    width: 8,
  },
  buttonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  prevButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 16,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  prevButtonHidden: {
    opacity: 0,
    pointerEvents: 'none',
  },
  prevButtonText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 28,
    marginTop: -2,
  },
  nextButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 16,
    elevation: 4,
    flex: 1,
    height: 52,
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  nextButtonFinal: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
  },
  nextButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  nextButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
