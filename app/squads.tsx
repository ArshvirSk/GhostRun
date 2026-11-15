import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';
import { triggerHaptic } from '../src/motion/haptics';
import {
  Crew,
  fetchMyCrews,
  createCrewOnServer,
  joinCrewOnServer,
  leaveCrewOnServer,
  shareCrewInvite,
} from '../src/lib/crews';

export default function SquadsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();

  const [activeTab, setActiveTab] = useState<'my_crews' | 'create' | 'join'>('my_crews');
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [createName, setCreateName] = useState('');
  const [createCode, setCreateCode] = useState('');
  const [creating, setCreating] = useState(false);

  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const [errorMessage, setErrorMessage] = useState('');

  const loadCrews = useCallback(async () => {
    setLoading(true);
    const res = await fetchMyCrews();
    setLoading(false);
    if (res.success) {
      setCrews(res.crews);
    }
  }, []);

  useEffect(() => {
    void loadCrews();
  }, [loadCrews]);

  async function handleCreate() {
    if (creating) return;
    setErrorMessage('');
    setCreating(true);
    triggerHaptic('buttonTap');

    const res = await createCrewOnServer(createName, createCode || undefined);
    setCreating(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Failed to form squad');
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
      setErrorMessage(res.error || 'Failed to join squad');
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 32,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        {/* Tactical Back Navigation */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.backRow}
        >
          <Ionicons name="arrow-back" size={20} color={colors.primary} />
          <Text variant="label" style={{ color: colors.primary, marginLeft: spacing.xs }}>
            BACK
          </Text>
        </Pressable>

        {/* Screen Title */}
        <Text variant="display" style={{ color: colors.text, marginTop: spacing.md }}>
          SQUADS
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg }}>
          Form persistent squads, recruit operatives with tactical invite codes, and deploy together.
        </Text>

        {/* Nav Tabs */}
        <View style={[styles.tabBar, { borderColor: colors.borderDark, backgroundColor: colors.surface }]}>
          <Pressable
            accessibilityRole="tab"
            onPress={() => {
              triggerHaptic('buttonTap');
              setActiveTab('my_crews');
              setErrorMessage('');
            }}
            style={[
              styles.tabBtn,
              activeTab === 'my_crews' && {
                backgroundColor: colors.surfaceElevated,
                borderBottomColor: colors.primary,
                borderBottomWidth: 2,
              },
            ]}
          >
            <Ionicons
              name="people-outline"
              size={16}
              color={activeTab === 'my_crews' ? colors.primary : colors.textMuted}
            />
            <Text
              variant="label"
              style={{
                color: activeTab === 'my_crews' ? colors.text : colors.textMuted,
                marginLeft: 6,
              }}
            >
              MY SQUADS ({crews.length})
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            onPress={() => {
              triggerHaptic('buttonTap');
              setActiveTab('create');
              setErrorMessage('');
            }}
            style={[
              styles.tabBtn,
              activeTab === 'create' && {
                backgroundColor: colors.surfaceElevated,
                borderBottomColor: colors.primary,
                borderBottomWidth: 2,
              },
            ]}
          >
            <Ionicons
              name="add-outline"
              size={16}
              color={activeTab === 'create' ? colors.primary : colors.textMuted}
            />
            <Text
              variant="label"
              style={{
                color: activeTab === 'create' ? colors.text : colors.textMuted,
                marginLeft: 6,
              }}
            >
              FORM SQUAD
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            onPress={() => {
              triggerHaptic('buttonTap');
              setActiveTab('join');
              setErrorMessage('');
            }}
            style={[
              styles.tabBtn,
              activeTab === 'join' && {
                backgroundColor: colors.surfaceElevated,
                borderBottomColor: colors.primary,
                borderBottomWidth: 2,
              },
            ]}
          >
            <Ionicons
              name="enter-outline"
              size={16}
              color={activeTab === 'join' ? colors.primary : colors.textMuted}
            />
            <Text
              variant="label"
              style={{
                color: activeTab === 'join' ? colors.text : colors.textMuted,
                marginLeft: 6,
              }}
            >
              JOIN SQUAD
            </Text>
          </Pressable>
        </View>

        {/* Global Error Banner */}
        {errorMessage ? (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, marginTop: spacing.md },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={18} color={colors.dangerText} />
            <Text variant="caption" style={{ color: colors.dangerText, marginLeft: 8, flex: 1 }}>
              {errorMessage}
            </Text>
          </View>
        ) : null}

        {/* TAB 1: MY SQUADS */}
        {activeTab === 'my_crews' && (
          <View style={{ marginTop: spacing.md }}>
            {loading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text variant="caption" style={{ color: colors.textMuted, marginTop: spacing.sm }}>
                  Scanning tactical squads...
                </Text>
              </View>
            ) : crews.length === 0 ? (
              <Card
                variant="elevated"
                style={[styles.emptyCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
              >
                <Ionicons name="people-outline" size={40} color={colors.textSubtle} />
                <Text variant="title" style={{ color: colors.text, marginTop: spacing.sm }}>
                  No Active Squads
                </Text>
                <Text
                  variant="caption"
                  style={{ color: colors.textMuted, textAlign: 'center', marginTop: 4, marginBottom: spacing.md }}
                >
                  You are not currently enrolled in any persistent tactical squad. Form a squad or enter an invite code to recruit allies!
                </Text>
                <View style={styles.emptyActionRow}>
                  <Button
                    title="Form Squad"
                    variant="primary"
                    size="sm"
                    onPress={() => setActiveTab('create')}
                  />
                  <Button
                    title="Join with Code"
                    variant="secondary"
                    size="sm"
                    onPress={() => setActiveTab('join')}
                  />
                </View>
              </Card>
            ) : (
              crews.map((crew) => (
                <Card
                  key={crew.id}
                  variant="elevated"
                  style={[styles.crewCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
                >
                  <View style={styles.crewHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text variant="title" style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>
                          {crew.name}
                        </Text>
                        <View
                          style={[
                            styles.leaderBadge,
                            {
                              backgroundColor:
                                crew.my_role === 'captain' ? colors.primary : colors.surfaceElevated,
                              borderColor:
                                crew.my_role === 'captain' ? colors.primary : colors.borderDark,
                            },
                          ]}
                        >
                          <Text
                            variant="caption"
                            style={{
                              color:
                                crew.my_role === 'captain' ? '#101014' : colors.textMuted,
                              fontSize: 10,
                              fontWeight: '700',
                            }}
                          >
                            {crew.my_role === 'captain' ? 'CAPTAIN' : 'MEMBER'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.codeRow}>
                        <Text variant="caption" style={{ color: colors.textMuted }}>
                          CODE:
                        </Text>
                        <Text
                          variant="caption"
                          style={{
                            color: colors.primary,
                            fontWeight: '700',
                            letterSpacing: 1.5,
                            marginLeft: 4,
                          }}
                        >
                          {crew.code}
                        </Text>
                        <Text variant="caption" style={{ color: colors.textSubtle, marginLeft: 10 }}>
                          · {crew.member_count || 1} Operative{(crew.member_count || 1) === 1 ? '' : 's'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.headerBtnRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Share Squad Invite"
                        onPress={() => void handleShare(crew)}
                        style={[
                          styles.iconBtn,
                          { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark },
                        ]}
                      >
                        <Ionicons name="share-social-outline" size={18} color={colors.text} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Leave Squad"
                        onPress={() => void handleLeave(crew.id, crew.name)}
                        style={[
                          styles.iconBtn,
                          { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder },
                        ]}
                      >
                        <Ionicons name="log-out-outline" size={18} color={colors.dangerText} />
                      </Pressable>
                    </View>
                  </View>
                </Card>
              ))
            )}
          </View>
        )}

        {/* TAB 2: FORM SQUAD */}
        {activeTab === 'create' && (
          <View style={{ marginTop: spacing.md }}>
            <Card
              variant="default"
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
            >
              <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
                SQUAD CODENAME *
              </Text>
              <TextInput
                value={createName}
                onChangeText={setCreateName}
                placeholder="e.g. Night Stalkers"
                placeholderTextColor={colors.textSubtle}
                style={[
                  styles.input,
                  {
                    borderColor: colors.borderDark,
                    backgroundColor: colors.surfaceElevated,
                    color: colors.text,
                    borderRadius: radii.sm,
                  },
                ]}
                maxLength={40}
              />

              <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs }}>
                CUSTOM SQUAD CODE (OPTIONAL)
              </Text>
              <TextInput
                value={createCode}
                onChangeText={(val) => setCreateCode(val.toUpperCase())}
                placeholder="e.g. ALPHA9 (Auto-generated if empty)"
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="characters"
                style={[
                  styles.input,
                  {
                    borderColor: colors.borderDark,
                    backgroundColor: colors.surfaceElevated,
                    color: colors.text,
                    borderRadius: radii.sm,
                  },
                ]}
                maxLength={10}
              />

              <Button
                title={creating ? 'Forming Squad...' : 'Form Squad'}
                disabled={creating || !createName.trim()}
                variant="primary"
                style={{ marginTop: spacing.lg }}
                onPress={() => void handleCreate()}
              />
            </Card>
          </View>
        )}

        {/* TAB 3: JOIN SQUAD */}
        {activeTab === 'join' && (
          <View style={{ marginTop: spacing.md }}>
            <Card
              variant="default"
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
            >
              <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
                SQUAD INVITE CODE *
              </Text>
              <TextInput
                value={joinCode}
                onChangeText={(val) => setJoinCode(val.toUpperCase())}
                placeholder="Enter squad code..."
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="characters"
                style={[
                  styles.input,
                  {
                    borderColor: colors.borderDark,
                    backgroundColor: colors.surfaceElevated,
                    color: colors.text,
                    borderRadius: radii.sm,
                    fontSize: 16,
                    letterSpacing: 2,
                    textAlign: 'center',
                  },
                ]}
                maxLength={12}
              />

              <Button
                title={joining ? 'Joining...' : 'Join Squad'}
                disabled={joining || !joinCode.trim()}
                variant="primary"
                style={{ marginTop: spacing.lg }}
                onPress={() => void handleJoin()}
              />
            </Card>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  centerBox: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    padding: 24,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
  },
  emptyActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  crewCard: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 12,
  },
  crewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  headerBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rosterSection: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 10,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leaderBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  card: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'System',
  },
});
