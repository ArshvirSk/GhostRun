import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import { useDialogModalAnimation } from '../motion';
import {
  Crew,
  fetchMyCrews,
  createCrewOnServer,
  joinCrewOnServer,
  leaveCrewOnServer,
  shareCrewInvite,
} from '../lib/crews';

interface CrewManagementModalProps {
  visible: boolean;
  onClose: () => void;
}

export function CrewManagementModal({ visible, onClose }: CrewManagementModalProps) {
  const { colors, spacing, radii } = useTheme();
  const { mounted, fadeAnim, scaleAnim, handleClose } = useDialogModalAnimation(visible, onClose);

  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'my_crews' | 'create' | 'join'>('my_crews');

  // Create state
  const [createName, setCreateName] = useState('');
  const [createCode, setCreateCode] = useState('');
  const [creating, setCreating] = useState(false);

  // Join state
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const [errorMessage, setErrorMessage] = useState('');

  const loadCrews = async () => {
    setLoading(true);
    const res = await fetchMyCrews();
    setLoading(false);
    if (res.success) {
      setCrews(res.crews);
    }
  };

  useEffect(() => {
    if (visible) {
      setErrorMessage('');
      void loadCrews();
    }
  }, [visible]);

  async function handleCreate() {
    if (creating) return;
    setErrorMessage('');
    setCreating(true);
    triggerHaptic('buttonTap');

    const res = await createCrewOnServer(createName, createCode || undefined);
    setCreating(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Failed to create crew');
      triggerHaptic('error');
      return;
    }

    triggerHaptic('tagConfirmed');
    setCreateName('');
    setCreateCode('');
    setActiveTab('my_crews');
    void loadCrews();
  }

  async function handleJoin() {
    if (joining) return;
    setErrorMessage('');
    setJoining(true);
    triggerHaptic('buttonTap');

    const res = await joinCrewOnServer(joinCode);
    setJoining(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Failed to join crew');
      triggerHaptic('error');
      return;
    }

    triggerHaptic('tagConfirmed');
    setJoinCode('');
    setActiveTab('my_crews');
    void loadCrews();
  }

  async function handleLeave(crewId: string, crewName: string) {
    triggerHaptic('buttonTap');
    Alert.alert(
      'Leave Squad',
      `Are you sure you want to leave ${crewName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const res = await leaveCrewOnServer(crewId);
            if (res.success) {
              triggerHaptic('tagConfirmed');
              void loadCrews();
            } else {
              Alert.alert('Error', res.error || 'Failed to leave squad');
            }
          },
        },
      ]
    );
  }

  async function handleShare(crew: Crew) {
    triggerHaptic('buttonTap');
    await shareCrewInvite(crew);
  }

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0, 0, 0, 0.75)', opacity: fadeAnim },
          ]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <Animated.View
          style={{
            width: '100%',
            maxWidth: 420,
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          }}
        >
          <View
            style={[
              styles.container,
              { backgroundColor: colors.surface, borderRadius: radii.card, borderColor: colors.borderLight },
            ]}
          >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.borderLight }]}>
              <View>
                <Text variant="caption" style={{ color: colors.primary, fontWeight: '700' }}>
                  PERSISTENT SQUADS // CREWS
                </Text>
                <Text variant="title" style={styles.title}>
                  Squad Roster
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceMuted }]}
              >
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>

          {/* Sub-nav tabs */}
          <View style={[styles.navBar, { borderBottomColor: colors.borderLight }]}>
            <Pressable
              onPress={() => {
                setActiveTab('my_crews');
                setErrorMessage('');
              }}
              style={[
                styles.navTab,
                activeTab === 'my_crews' && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
              ]}
            >
              <Text
                variant="sub"
                style={{
                  fontWeight: '700',
                  color: activeTab === 'my_crews' ? colors.primary : colors.textSecondary,
                }}
              >
                My Squads ({crews.length})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setActiveTab('create');
                setErrorMessage('');
              }}
              style={[
                styles.navTab,
                activeTab === 'create' && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
              ]}
            >
              <Text
                variant="sub"
                style={{
                  fontWeight: '700',
                  color: activeTab === 'create' ? colors.primary : colors.textSecondary,
                }}
              >
                Create Squad
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setActiveTab('join');
                setErrorMessage('');
              }}
              style={[
                styles.navTab,
                activeTab === 'join' && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
              ]}
            >
              <Text
                variant="sub"
                style={{
                  fontWeight: '700',
                  color: activeTab === 'join' ? colors.primary : colors.textSecondary,
                }}
              >
                Join with Code
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={{ padding: spacing.md }}>
            {errorMessage ? (
              <View
                style={[
                  styles.errorBanner,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.hunter },
                ]}
              >
                <Ionicons name="alert-circle-outline" size={18} color={colors.hunter} />
                <Text variant="caption" style={{ color: colors.hunter, marginLeft: 6 }}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {/* TAB: My Squads */}
            {activeTab === 'my_crews' && (
              <>
                {loading ? (
                  <ActivityIndicator color={colors.primary} style={{ marginVertical: 32 }} />
                ) : crews.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
                    <Text variant="sub" style={{ marginTop: spacing.sm, textAlign: 'center' }}>
                      No Squads Found
                    </Text>
                    <Text
                      variant="caption"
                      style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 4 }}
                    >
                      Create a persistent crew to coordinate missions with your patrol group.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    {crews.map((c) => (
                      <View
                        key={c.id}
                        style={[
                          styles.crewCard,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.borderLight,
                          },
                        ]}
                      >
                        <View style={styles.crewHeader}>
                          <View style={{ flex: 1 }}>
                            <Text variant="title" style={{ fontSize: 16, fontWeight: '800' }}>
                              {c.name}
                            </Text>
                            <Text variant="caption" style={{ color: colors.textSecondary }}>
                              CODE: {c.code} · ROLE: {c.my_role?.toUpperCase()}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.roleBadge,
                              {
                                backgroundColor:
                                  c.my_role === 'captain'
                                    ? colors.primary
                                    : colors.surfaceMuted,
                              },
                            ]}
                          >
                            <Text
                              variant="caption"
                              style={{
                                color: c.my_role === 'captain' ? '#000000' : colors.textPrimary,
                                fontWeight: '700',
                              }}
                            >
                              {c.my_role === 'captain' ? 'CAPTAIN' : 'MEMBER'}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.cardActions}>
                          <Pressable
                            onPress={() => void handleShare(c)}
                            style={[styles.actionBtn, { borderColor: colors.borderLight }]}
                          >
                            <Ionicons name="share-social-outline" size={14} color={colors.primary} />
                            <Text variant="caption" style={{ color: colors.primary, fontWeight: '700', marginLeft: 4 }}>
                              Share Code
                            </Text>
                          </Pressable>

                          <Pressable
                            onPress={() => void handleLeave(c.id, c.name)}
                            style={[styles.actionBtn, { borderColor: colors.borderLight }]}
                          >
                            <Ionicons name="exit-outline" size={14} color={colors.hunter} />
                            <Text variant="caption" style={{ color: colors.hunter, fontWeight: '700', marginLeft: 4 }}>
                              Leave Squad
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* TAB: Create Squad */}
            {activeTab === 'create' && (
              <View style={{ gap: spacing.md }}>
                <View>
                  <Text variant="label" style={{ marginBottom: spacing.xs }}>
                    Squad Name
                  </Text>
                  <TextInput
                    value={createName}
                    onChangeText={setCreateName}
                    placeholder="e.g. Night Stalkers"
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      styles.input,
                      {
                        borderColor: colors.borderLight,
                        backgroundColor: colors.surfaceMuted,
                        color: colors.textPrimary,
                      },
                    ]}
                    maxLength={30}
                  />
                </View>

                <View>
                  <Text variant="label" style={{ marginBottom: spacing.xs }}>
                    Custom Join Code (Optional, 4-8 chars)
                  </Text>
                  <TextInput
                    value={createCode}
                    onChangeText={setCreateCode}
                    placeholder="e.g. STALK"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="characters"
                    style={[
                      styles.input,
                      {
                        borderColor: colors.borderLight,
                        backgroundColor: colors.surfaceMuted,
                        color: colors.textPrimary,
                      },
                    ]}
                    maxLength={8}
                  />
                  <Text variant="caption" style={{ color: colors.textSecondary, marginTop: 4 }}>
                    Leave blank to auto-generate a secure random 5-character tactical code.
                  </Text>
                </View>

                <View style={{ marginTop: spacing.sm }}>
                  <Button
                    title={creating ? 'Founding Squad...' : 'Found Squad'}
                    onPress={handleCreate}
                    variant="primary"
                    disabled={creating || createName.trim().length < 3}
                  />
                </View>
              </View>
            )}

            {/* TAB: Join Squad */}
            {activeTab === 'join' && (
              <View style={{ gap: spacing.md }}>
                <View>
                  <Text variant="label" style={{ marginBottom: spacing.xs }}>
                    Squad Join Code
                  </Text>
                  <TextInput
                    value={joinCode}
                    onChangeText={setJoinCode}
                    placeholder="Enter 4-8 character code"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="characters"
                    style={[
                      styles.input,
                      {
                        borderColor: colors.borderLight,
                        backgroundColor: colors.surfaceMuted,
                        color: colors.textPrimary,
                      },
                    ]}
                    maxLength={8}
                  />
                  <Text variant="caption" style={{ color: colors.textSecondary, marginTop: 4 }}>
                    Obtain this code from your squad captain.
                  </Text>
                </View>

                <View style={{ marginTop: spacing.sm }}>
                  <Button
                    title={joining ? 'Joining Squad...' : 'Join Squad'}
                    onPress={handleJoin}
                    variant="primary"
                    disabled={joining || joinCode.trim().length < 4}
                  />
                </View>
              </View>
            )}
          </ScrollView>
        </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  container: {
    width: '100%',
    maxHeight: '85%',
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontWeight: '800',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    maxHeight: 520,
  },
  input: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  crewCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  crewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
});
