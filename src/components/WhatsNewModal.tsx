import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeProvider';
import { triggerHaptic } from '../motion/haptics';
import { useSheetModalAnimation } from '../motion';
import {
  PatchNotesPayload,
  LOCAL_PATCH_NOTES,
} from '../lib/patchNotesCore';

export const PATCH_NOTES_LAST_SEEN_KEY = '@ghostrun:patch_notes_last_seen_version';

export interface WhatsNewModalProps {
  visible: boolean;
  onClose: () => void;
  patchNotes?: PatchNotesPayload;
}

interface CategoryStyle {
  label: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
}

function getCategoryMeta(category?: string): CategoryStyle {
  switch (category) {
    case 'audio':
      return {
        label: 'AUDIO & WEARABLE',
        color: '#38BDF8',
        icon: 'headset-outline',
      };
    case 'safety':
      return {
        label: 'SAFETY & GUARDS',
        color: '#FBBF24',
        icon: 'shield-checkmark-outline',
      };
    case 'mode':
      return {
        label: 'GAME MODE',
        color: '#FF8A75',
        icon: 'game-controller-outline',
      };
    case 'perf':
      return {
        label: 'PERFORMANCE',
        color: '#C7F36B',
        icon: 'flash-outline',
      };
    case 'tactical':
    default:
      return {
        label: 'TACTICAL HUD',
        color: '#B8A3FF',
        icon: 'locate-outline',
      };
  }
}

export function WhatsNewModal({ visible, onClose, patchNotes }: WhatsNewModalProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { mounted, fadeAnim, slideAnim, handleClose } = useSheetModalAnimation(visible, onClose);

  const notes = patchNotes || LOCAL_PATCH_NOTES;

  const handleAcknowledge = async () => {
    triggerHaptic('buttonTap');
    try {
      await AsyncStorage.setItem(PATCH_NOTES_LAST_SEEN_KEY, notes.version);
    } catch {
      // Non-blocking fallback
    }
    handleClose();
  };

  return (
    <Modal
      visible={mounted}
      animationType="none"
      transparent
      onRequestClose={handleAcknowledge}
    >
      <View style={styles.backdrop}>
        {/* Animated Dim Backdrop */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0, 0, 0, 0.85)', opacity: fadeAnim },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss patch briefing"
            style={StyleSheet.absoluteFill}
            onPress={handleAcknowledge}
          />
        </Animated.View>

        {/* Modal Sheet Container */}
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
              borderColor: colors.borderDark,
              paddingBottom: Math.max(insets.bottom, 16) + 12,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Top Drag Handle */}
          <View style={styles.topHandleBar}>
            <View style={[styles.dragHandle, { backgroundColor: colors.border }]} />
          </View>

          {/* Tactical Header Badge */}
          <View style={styles.headerRow}>
            <View style={styles.statusTag}>
              <View style={[styles.pulseDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.statusTagText, { color: colors.primary }]}>
                {`MISSION PATCH DIRECTIVE // v${notes.version}`}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Patch Briefing"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={handleAcknowledge}
              style={[
                styles.closeBtn,
                { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)' },
              ]}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Scrollable Patch Notes Content */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Mission Hero Header */}
            <View style={styles.heroSection}>
              <View
                style={[
                  styles.radarIconBox,
                  {
                    borderColor: colors.primary,
                    backgroundColor: isDark ? 'rgba(199, 243, 107, 0.08)' : 'rgba(199, 243, 107, 0.15)',
                  },
                ]}
              >
                <Ionicons name="sparkles" size={26} color={colors.primary} />
              </View>

              <Text style={[styles.title, { color: colors.text }]}>{notes.title}</Text>
              <Text style={[styles.subtitle, { color: colors.textMuted }]}>{notes.subtitle}</Text>

              <View
                style={[
                  styles.metaBadge,
                  {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                <Text style={[styles.metaDateText, { color: colors.textMuted }]}>
                  {`DEPLOYED ${notes.release_date}`}
                </Text>
              </View>
            </View>

            {/* Patch Highlights List */}
            <View style={styles.highlightsContainer}>
              {notes.highlights.map((item, index) => {
                const meta = getCategoryMeta(item.category);
                return (
                  <View
                    key={item.id || index}
                    style={[
                      styles.highlightCard,
                      {
                        backgroundColor: isDark ? colors.surface : colors.surfaceAlt,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.cardHeaderRow}>
                      <View
                        style={[
                          styles.categoryPill,
                          {
                            backgroundColor: `${meta.color}15`,
                            borderColor: meta.color,
                          },
                        ]}
                      >
                        <Ionicons name={meta.icon} size={11} color={meta.color} />
                        <Text style={[styles.categoryText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>

                    <Text style={[styles.highlightTitle, { color: colors.text }]}>
                      {item.title}
                    </Text>

                    <Text style={[styles.highlightDesc, { color: colors.textMuted }]}>
                      {item.description}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Bottom Acknowledge Action Button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Acknowledge patch and deploy"
              onPress={handleAcknowledge}
              style={({ pressed }) => [
                styles.deployButton,
                { backgroundColor: colors.primary },
                pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
              ]}
            >
              <Text style={styles.deployButtonText}>ACKNOWLEDGE & DEPLOY</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    maxHeight: '90%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  topHandleBar: {
    alignItems: 'center',
    marginBottom: 8,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  statusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 12,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusTagText: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 10,
    letterSpacing: 1.1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 16,
  },
  heroSection: {
    alignItems: 'center',
    marginVertical: 6,
  },
  radarIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontFamily: 'Archivo-Black',
    fontSize: 20,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 8,
  },
  metaDateText: {
    fontFamily: 'Archivo-SemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
  },
  highlightsContainer: {
    gap: 10,
    marginVertical: 10,
  },
  highlightCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  categoryText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 9,
    letterSpacing: 0.6,
  },
  highlightTitle: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    marginBottom: 4,
  },
  highlightDesc: {
    fontFamily: 'SegoeUI-Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  deployButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 6,
  },
  deployButtonText: {
    fontFamily: 'Archivo-Black',
    fontSize: 14,
    color: '#0A0A0C',
    letterSpacing: 1,
  },
});
