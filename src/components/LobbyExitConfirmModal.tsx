import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { triggerHaptic } from '../motion/haptics';

interface LobbyExitConfirmModalProps {
  visible: boolean;
  isHost: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function LobbyExitConfirmModal({
  visible,
  isHost,
  onConfirm,
  onCancel,
  busy = false,
}: LobbyExitConfirmModalProps) {
  if (!visible) return null;

  const title = isHost ? 'Cancel Mission?' : 'Leave Mission?';
  const description = isHost
    ? 'As the host, leaving will cancel this mission and disband the lobby for all operatives.'
    : 'Are you sure you want to withdraw from this mission lobby? Your assigned squad slot will be released.';
  const confirmText = isHost ? 'CANCEL MISSION' : 'LEAVE MISSION';
  const cancelText = isHost ? 'KEEP LOBBY' : 'STAY IN MISSION';
  const badgeLabel = isHost ? 'HOST DISBAND PROTOCOL' : 'OPERATIVE DEPARTURE';

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.dialogCard}>
          {/* Tactical Badge Row */}
          <View style={styles.topRow}>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: isHost ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  borderColor: isHost ? '#EF4444' : '#F59E0B',
                },
              ]}
            >
              <Ionicons
                name={isHost ? 'alert-circle' : 'exit-outline'}
                size={13}
                color={isHost ? '#EF4444' : '#F59E0B'}
                style={{ marginRight: 5 }}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: isHost ? '#EF4444' : '#F59E0B' },
                ]}
              >
                {badgeLabel}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => {
                triggerHaptic('buttonTap');
                onCancel();
              }}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={18} color="#9CA3AF" />
            </Pressable>
          </View>

          {/* Title & Description */}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>

          {/* Actions Stack */}
          <View style={styles.actionsStack}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                triggerHaptic('buttonTap');
                onConfirm();
              }}
              style={[
                styles.confirmBtn,
                { backgroundColor: '#EF4444' },
                busy && { opacity: 0.6 },
              ]}
            >
              <Ionicons name={isHost ? 'trash-outline' : 'log-out-outline'} size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.confirmBtnText}>{confirmText}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                triggerHaptic('buttonTap');
                onCancel();
              }}
              style={styles.cancelBtn}
            >
              <Text style={styles.cancelBtnText}>{cancelText}</Text>
            </Pressable>
          </View>
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
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
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
    marginBottom: 22,
  },
  actionsStack: {
    gap: 10,
  },
  confirmBtn: {
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Archivo-Bold',
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  cancelBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#222230',
    borderWidth: 1,
    borderColor: '#343446',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: '#E4E4E7',
    fontSize: 13,
    fontFamily: 'Archivo-Bold',
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
