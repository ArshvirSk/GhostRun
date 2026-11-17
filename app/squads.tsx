import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';
import { SegmentBar } from '../src/ui/SegmentBar';
import { triggerHaptic } from '../src/motion/haptics';
import {
  Crew,
  fetchMyCrews,
  createCrewOnServer,
  joinCrewOnServer,
  leaveCrewOnServer,
  shareCrewInvite,
} from '../src/lib/crews';

type TabKey = 'my_crews' | 'create' | 'join';

export default function SquadsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { colors, spacing, radii } = useTheme();

  const [activeTab, setActiveTab] = useState<TabKey>('my_crews');
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);

  const pagerRef = useRef<React.ElementRef<typeof ScrollView>>(null);

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

  const handleTabChange = (id: string) => {
    const tabKey = id as TabKey;
    setActiveTab(tabKey);
    setErrorMessage('');
    const pageIndex = tabKey === 'my_crews' ? 0 : tabKey === 'create' ? 1 : 2;
    pagerRef.current?.scrollTo({ x: pageIndex * screenWidth, animated: true });
  };

  const handlePagerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(offsetX / screenWidth);
    const newTab: TabKey = pageIndex === 0 ? 'my_crews' : pageIndex === 1 ? 'create' : 'join';
    if (newTab !== activeTab) {
      triggerHaptic('buttonTap');
      setActiveTab(newTab);
      setErrorMessage('');
    }
  };

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
    handleTabChange('my_crews');
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
    handleTabChange('my_crews');
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
      {/* Sticky Header Area */}
      <View
        style={[
          styles.headerArea,
          {
            paddingTop: Math.max(insets.top, 16) + 4,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
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

        <Text variant="display" style={{ color: colors.text, marginTop: spacing.xs }}>
          SQUADS
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm }}>
          Form persistent squads, recruit allies, and deploy together.
        </Text>

        {/* 3-Tab Segment Bar with Animated Slider (Labels fit all screen widths cleanly) */}
        <SegmentBar
          items={[
            { id: 'my_crews', label: crews.length > 0 ? `SQUADS (${crews.length})` : 'SQUADS' },
            { id: 'create', label: 'FORM SQUAD' },
            { id: 'join', label: 'JOIN' },
          ]}
          activeId={activeTab}
          onChange={handleTabChange}
          style={{ marginBottom: 4 }}
        />

        {/* Global Error Banner */}
        {errorMessage ? (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, marginTop: 6 },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={16} color={colors.dangerText} />
            <Text variant="caption" style={{ color: colors.dangerText, marginLeft: 8, flex: 1 }}>
              {errorMessage}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Horizontal Swipeable Pager */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handlePagerScrollEnd}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {/* PAGE 1: MY SQUADS */}
        <ScrollView
          style={{ width: screenWidth }}
          contentContainerStyle={[
            styles.pageContent,
            {
              paddingHorizontal: spacing.lg,
              paddingBottom: Math.max(insets.bottom, 16) + 32,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
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
              style={[
                styles.emptyCard,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark },
              ]}
            >
              <Ionicons name="people-outline" size={38} color={colors.textSubtle} />
              <Text variant="title" style={{ color: colors.text, marginTop: spacing.sm }}>
                No Active Squads
              </Text>
              <Text
                variant="caption"
                style={{
                  color: colors.textMuted,
                  textAlign: 'center',
                  marginTop: 4,
                  marginBottom: spacing.md,
                }}
              >
                You are not currently enrolled in any persistent tactical squad. Form a squad or enter an invite code to recruit allies!
              </Text>
              <View style={styles.emptyActionRow}>
                <Button
                  title="Form Squad"
                  variant="primary"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => handleTabChange('create')}
                />
                <Button
                  title="Join with Code"
                  variant="secondary"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => handleTabChange('join')}
                />
              </View>
            </Card>
          ) : (
            crews.map((crew) => (
              <Card
                key={crew.id}
                variant="elevated"
                style={[
                  styles.crewCard,
                  { backgroundColor: colors.surface, borderColor: colors.borderDark },
                ]}
              >
                <View style={styles.cardHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                        {crew.name}
                      </Text>
                      <View
                        style={[
                          styles.roleBadge,
                          {
                            backgroundColor:
                              crew.my_role === 'captain' ? colors.primary : colors.surfaceElevated,
                            borderColor:
                              crew.my_role === 'captain' ? colors.primary : colors.borderLight,
                          },
                        ]}
                      >
                        <Text
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
                      <Ionicons name="share-social-outline" size={17} color={colors.text} />
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
                      <Ionicons name="log-out-outline" size={17} color={colors.dangerText} />
                    </Pressable>
                  </View>
                </View>
              </Card>
            ))
          )}
        </ScrollView>

        {/* PAGE 2: FORM SQUAD */}
        <ScrollView
          style={{ width: screenWidth }}
          contentContainerStyle={[
            styles.pageContent,
            {
              paddingHorizontal: spacing.lg,
              paddingBottom: Math.max(insets.bottom, 16) + 32,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
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

            <Text
              variant="label"
              style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs }}
            >
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
        </ScrollView>

        {/* PAGE 3: JOIN SQUAD */}
        <ScrollView
          style={{ width: screenWidth }}
          contentContainerStyle={[
            styles.pageContent,
            {
              paddingHorizontal: spacing.lg,
              paddingBottom: Math.max(insets.bottom, 16) + 32,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
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
        </ScrollView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerArea: {
    paddingBottom: 4,
  },
  pageContent: {
    paddingTop: 12,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  centerBox: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  emptyActionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 4,
  },
  card: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 16,
  },
  crewCard: {
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    marginLeft: 8,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  headerBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    height: 46,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
});
