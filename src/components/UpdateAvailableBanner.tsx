import React, { useEffect, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { triggerHaptic } from '../motion/haptics';
import {
  checkForTacticalUpdate,
  fetchAndApplyUpdate,
  formatUpdateBannerText,
} from '../lib/updatesCore';

export interface UpdateAvailableBannerProps {
  onUpdateApplied?: () => void;
}

export function UpdateAvailableBanner({ onUpdateApplied }: UpdateAvailableBannerProps) {
  const { colors, isDark } = useTheme();
  const [isAvailable, setIsAvailable] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [manifestVersion, setManifestVersion] = useState<string | undefined>();
  const [dismissed, setDismissed] = useState(false);
  const [slideAnim] = useState(() => new Animated.Value(-80));

  useEffect(() => {
    let isMounted = true;

    async function probeUpdates() {
      const result = await checkForTacticalUpdate();
      if (isMounted && result.available) {
        setIsAvailable(true);
        setManifestVersion(result.manifestVersion);
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }).start();
      }
    }

    void probeUpdates();

    return () => {
      isMounted = false;
    };
  }, [slideAnim]);

  if (!isAvailable || dismissed) {
    return null;
  }

  const handleApply = async () => {
    triggerHaptic('buttonTap');
    setIsApplying(true);
    const res = await fetchAndApplyUpdate();
    if (res.success && onUpdateApplied) {
      onUpdateApplied();
    } else {
      setIsApplying(false);
    }
  };

  const handleDismiss = () => {
    triggerHaptic('buttonTap');
    Animated.timing(slideAnim, {
      toValue: -80,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setDismissed(true));
  };

  return (
    <Animated.View
      style={[
        styles.bannerContainer,
        {
          backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
          borderColor: colors.primary,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.leftCol}>
        <View style={[styles.iconPulseBox, { backgroundColor: `${colors.primary}20` }]}>
          <Ionicons name="flash" size={16} color={colors.primary} />
        </View>

        <View style={styles.textCol}>
          <Text style={[styles.title, { color: colors.text }]}>
            {formatUpdateBannerText(manifestVersion)}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {isApplying ? 'Applying intel package...' : 'Over-the-air package downloaded'}
          </Text>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply tactical update"
          disabled={isApplying}
          onPress={handleApply}
          style={({ pressed }) => [
            styles.applyBtn,
            { backgroundColor: colors.primary },
            pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
          ]}
        >
          <Text style={styles.applyBtnText}>
            {isApplying ? 'RELOADING' : 'RESTART'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss update notification"
          onPress={handleDismiss}
          style={styles.closeBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  leftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  iconPulseBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
  },
  title: {
    fontFamily: 'Archivo-Bold',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  subtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 10,
    marginTop: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  applyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnText: {
    fontFamily: 'Archivo-Black',
    fontSize: 10,
    color: '#0A0A0C',
    letterSpacing: 0.6,
  },
  closeBtn: {
    padding: 4,
  },
});
