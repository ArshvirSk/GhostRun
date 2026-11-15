import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { triggerHaptic } from '../motion/haptics';

interface LobbyPrivacyModalProps {
  visible: boolean;
  shareWithCrew: boolean;
  onSelectOption: (share: boolean) => void;
  onClose: () => void;
}

export function LobbyPrivacyModal({
  visible,
  shareWithCrew,
  onSelectOption,
  onClose,
}: LobbyPrivacyModalProps) {
  if (!visible) return null;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.dialogCard}>
          {/* Top Badge & Close */}
          <View style={styles.topRow}>
            <View style={styles.badge}>
              <Ionicons name="shield-checkmark" size={13} color="#A3E635" style={{ marginRight: 5 }} />
              <Text style={styles.badgeText}>REPLAY TELEMETRY PRIVACY</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => {
                triggerHaptic('buttonTap');
                onClose();
              }}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={18} color="#9CA3AF" />
            </Pressable>
          </View>

          {/* Title & Description */}
          <Text style={styles.title}>Post-Match Route Privacy</Text>
          <Text style={styles.description}>
            Choose whether opponents and other squads can inspect your movement trail during post-match tactical replays.
          </Text>

          {/* Choice Cards */}
          <View style={styles.optionsList}>
            {/* Option: Keep Private (Default) */}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                triggerHaptic('buttonTap');
                onSelectOption(false);
              }}
              style={[
                styles.optionCard,
                {
                  backgroundColor: !shareWithCrew ? 'rgba(163, 230, 53, 0.08)' : '#1C1C28',
                  borderColor: !shareWithCrew ? '#A3E635' : '#2A2A38',
                },
              ]}
            >
              <View
                style={[
                  styles.optionIconCircle,
                  { backgroundColor: !shareWithCrew ? 'rgba(163, 230, 53, 0.2)' : '#262634' },
                ]}
              >
                <Ionicons
                  name="eye-off-outline"
                  size={18}
                  color={!shareWithCrew ? '#A3E635' : '#9CA3AF'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.optionTitle, !shareWithCrew && { color: '#A3E635' }]}>
                    Keep Private
                  </Text>
                  <View style={styles.defaultPill}>
                    <Text style={styles.defaultPillText}>DEFAULT</Text>
                  </View>
                </View>
                <Text style={styles.optionSubtitle}>
                  Only you can inspect your route trail in replays
                </Text>
              </View>
              <View style={[styles.radioCircle, !shareWithCrew && styles.radioCircleActive]}>
                {!shareWithCrew && <View style={styles.radioDot} />}
              </View>
            </Pressable>

            {/* Option: Share with Crew */}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                triggerHaptic('buttonTap');
                onSelectOption(true);
              }}
              style={[
                styles.optionCard,
                {
                  backgroundColor: shareWithCrew ? 'rgba(163, 230, 53, 0.08)' : '#1C1C28',
                  borderColor: shareWithCrew ? '#A3E635' : '#2A2A38',
                },
              ]}
            >
              <View
                style={[
                  styles.optionIconCircle,
                  { backgroundColor: shareWithCrew ? 'rgba(163, 230, 53, 0.2)' : '#262634' },
                ]}
              >
                <Ionicons
                  name="share-social-outline"
                  size={18}
                  color={shareWithCrew ? '#A3E635' : '#9CA3AF'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, shareWithCrew && { color: '#A3E635' }]}>
                  Share with Crew
                </Text>
                <Text style={styles.optionSubtitle}>
                  All mission operatives can view your route replay
                </Text>
              </View>
              <View style={[styles.radioCircle, shareWithCrew && styles.radioCircleActive]}>
                {shareWithCrew && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          </View>

          {/* Dismiss Button */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              triggerHaptic('buttonTap');
              onClose();
            }}
            style={styles.closeBottomBtn}
          >
            <Text style={styles.closeBottomBtnText}>DONE</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 10, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#161622',
    borderWidth: 1.5,
    borderColor: '#2E2E3E',
    borderRadius: 20,
    padding: 22,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(163, 230, 53, 0.15)',
    borderColor: '#A3E635',
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: '#A3E635',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1F1F2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Archivo-Bold',
    fontWeight: '900',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  description: {
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  optionsList: {
    gap: 10,
    marginBottom: 18,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 12,
  },
  optionIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
  },
  optionSubtitle: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  defaultPill: {
    backgroundColor: 'rgba(163, 230, 53, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  defaultPillText: {
    color: '#A3E635',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#4B5563',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleActive: {
    borderColor: '#A3E635',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#A3E635',
  },
  closeBottomBtn: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#222230',
    borderWidth: 1,
    borderColor: '#343446',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBottomBtnText: {
    color: '#E4E4E7',
    fontSize: 13,
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
    letterSpacing: 1,
  },
});
