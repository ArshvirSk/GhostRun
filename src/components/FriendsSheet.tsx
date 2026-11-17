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
  Switch,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import {
  FriendProfile,
  FriendRequest,
  FriendSettings,
  formatFriendInviteUrl,
  formatFriendDeepLink,
} from '../lib/friendsCore';
import { useUserStore } from '../stores/userStore';
import {
  listFriends,
  listFriendRequests,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  updateFriendSettings,
} from '../lib/friends';
import { listMyBlocks, unblockUser } from '../lib/moderation';
import { BlockItem } from '../lib/moderationCore';

interface FriendsSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function FriendsSheet({ visible, onClose }: FriendsSheetProps) {
  const { colors, spacing, radii } = useTheme();

  const [activeTab, setActiveTab] = useState<'friends' | 'requests' | 'add' | 'privacy'>('friends');
  const [loading, setLoading] = useState(false);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [blocks, setBlocks] = useState<BlockItem[]>([]);

  // Add friend state
  const [targetHandle, setTargetHandle] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const userProfile = useUserStore((s) => s.profile);

  // Privacy settings state
  const [settings, setSettings] = useState<FriendSettings>({
    allowFriendRequests: true,
    showPresence: false,
    shareEcho: false,
  });

  const loadData = async () => {
    setLoading(true);
    setStatusMessage('');
    try {
      const [friendsList, requestsData, blocksList] = await Promise.all([
        listFriends(),
        listFriendRequests(),
        listMyBlocks(),
      ]);
      setFriends(friendsList);
      setIncomingRequests(requestsData.incoming);
      setOutgoingRequests(requestsData.outgoing);
      setBlocks(blocksList);
    } catch {
      setStatusMessage('Failed to load friends data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      void loadData();
    }
  }, [visible]);

  const handleSendRequest = async () => {
    if (!targetHandle.trim()) {
      setStatusMessage('Please enter a valid @handle');
      return;
    }
    setSendingRequest(true);
    setStatusMessage('');
    try {
      const cleanHandle = targetHandle.replace(/^@/, '').trim();
      const res = await sendFriendRequest(cleanHandle);
      if (res.success) {
        triggerHaptic('buttonTap');
        setStatusMessage(`Friend request sent to @${cleanHandle}`);
        setTargetHandle('');
        void loadData();
      } else {
        triggerHaptic('error');
        setStatusMessage(res.error || res.reason || 'Failed to send request');
      }
    } catch (err: unknown) {
      triggerHaptic('error');
      setStatusMessage(err instanceof Error ? err.message : 'Error sending request');
    } finally {
      setSendingRequest(false);
    }
  };

  const handleRespond = async (requesterId: string | undefined, action: 'accept' | 'decline') => {
    if (!requesterId) return;
    try {
      const res = await respondFriendRequest(requesterId, action);
      if (res.success) {
        triggerHaptic('buttonTap');
        void loadData();
      } else {
        Alert.alert('Error', res.error || 'Failed to update request');
      }
    } catch {
      Alert.alert('Error', 'Network error');
    }
  };

  const handleRemoveFriend = async (friendId: string, name: string) => {
    Alert.alert('Remove Friend', `Are you sure you want to remove ${name} from your friends?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeFriend(friendId);
          triggerHaptic('buttonTap');
          void loadData();
        },
      },
    ]);
  };

  const handleUnblock = async (blockedUserId: string) => {
    await unblockUser(blockedUserId);
    triggerHaptic('buttonTap');
    void loadData();
  };

  const handleToggleSetting = async (key: keyof FriendSettings, val: boolean) => {
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    await updateFriendSettings(updated);
    triggerHaptic('buttonTap');
  };

  const handleShareInvite = async () => {
    const tag = userProfile?.handle
      ? `@${userProfile.handle}`
      : userProfile?.display_name
      ? `@${userProfile.display_name}`
      : 'Operative';
    const myIdentifier = userProfile?.handle || userProfile?.display_name || 'Operative';
    const deepLink = formatFriendDeepLink(myIdentifier);
    const downloadUrl = 'https://github.com/ArshvirSk/GhostRun/releases/latest';

    try {
      await Share.share({
        title: 'GhostRun Operative Invite',
        message: `Deploy with me on GhostRun! Connect to my operative network (${tag}):\n\n⚡ Open in GhostRun:\n${deepLink}\n\n📦 Download GhostRun:\n${downloadUrl}`,
      });
    } catch {
      // share dismissed
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.container,
            { backgroundColor: colors.surface, borderRadius: radii.lg, borderColor: colors.border },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text variant="title" style={{ color: colors.primary }}>
                OPERATIVE NETWORK
              </Text>
              <Text variant="caption" style={{ color: colors.textSecondary }}>
                Private Friends & Presence Graph
              </Text>
            </View>
            <Pressable
              onPress={() => {
                triggerHaptic('buttonTap');
                onClose();
              }}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>

          {/* Nav Tabs */}
          <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
            {(['friends', 'requests', 'add', 'privacy'] as const).map((tab) => {
              const isActive = activeTab === tab;
              const label =
                tab === 'friends'
                  ? `Friends (${friends.length})`
                  : tab === 'requests'
                  ? `Requests (${incomingRequests.length})`
                  : tab === 'add'
                  ? 'Add'
                  : 'Privacy';
              return (
                <Pressable
                  key={tab}
                  onPress={() => {
                    triggerHaptic('buttonTap');
                    setActiveTab(tab);
                  }}
                  style={[
                    styles.tabItem,
                    isActive && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
                  ]}
                >
                  <Text
                    variant="label"
                    style={{
                      color: isActive ? colors.primary : colors.textSecondary,
                      fontWeight: isActive ? '700' : '500',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <View style={styles.loader}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              {/* Tab: Friends List */}
              {activeTab === 'friends' && (
                <View>
                  {friends.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons name="people-outline" size={40} color={colors.textSecondary} />
                      <Text variant="body" style={{ color: colors.textSecondary, marginTop: 8 }}>
                        No operative connections yet.
                      </Text>
                      <Text variant="caption" style={{ color: colors.textSecondary, marginTop: 4 }}>
                        Add friends by exact handle or share your invite link.
                      </Text>
                    </View>
                  ) : (
                    friends.map((f) => (
                      <Card
                        key={f.userId}
                        style={[styles.friendCard, { borderColor: colors.border, marginBottom: 8 }]}
                      >
                        <View style={styles.friendRow}>
                          <View style={[styles.avatar, { backgroundColor: f.color || colors.primary }]}>
                            <Ionicons name="person" size={16} color="#FFF" />
                          </View>
                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text variant="body" style={{ fontWeight: '600', color: colors.textPrimary }}>
                              {f.displayName}
                            </Text>
                            <Text variant="caption" style={{ color: colors.textSecondary }}>
                              {f.handle ? `@${f.handle}` : 'No handle set'}
                            </Text>
                          </View>
                          {f.showPresence && (
                            <View style={styles.presenceBadge}>
                              <View style={[styles.presenceDot, { backgroundColor: colors.success }]} />
                              <Text variant="caption" style={{ color: colors.success, fontSize: 10 }}>
                                Live
                              </Text>
                            </View>
                          )}
                          <Pressable
                            onPress={() => handleRemoveFriend(f.userId, f.displayName)}
                            style={styles.unfriendBtn}
                          >
                            <Ionicons name="person-remove-outline" size={18} color={colors.danger} />
                          </Pressable>
                        </View>
                      </Card>
                    ))
                  )}
                </View>
              )}

              {/* Tab: Requests */}
              {activeTab === 'requests' && (
                <View>
                  <Text variant="label" style={{ color: colors.primary, marginBottom: 8 }}>
                    INCOMING REQUESTS
                  </Text>
                  {incomingRequests.length === 0 ? (
                    <Text variant="caption" style={{ color: colors.textSecondary, marginBottom: 16 }}>
                      No incoming requests.
                    </Text>
                  ) : (
                    incomingRequests.map((req) => (
                      <Card
                        key={req.requesterId}
                        style={[styles.friendCard, { borderColor: colors.border, marginBottom: 8 }]}
                      >
                        <View style={styles.friendRow}>
                          <View style={{ flex: 1 }}>
                            <Text variant="body" style={{ fontWeight: '600', color: colors.textPrimary }}>
                              {req.displayName}
                            </Text>
                            <Text variant="caption" style={{ color: colors.textSecondary }}>
                              {req.handle ? `@${req.handle}` : 'Operative'}
                            </Text>
                          </View>
                          <View style={styles.requestActions}>
                            <Button
                              variant="secondary"
                              size="sm"
                              onPress={() => handleRespond(req.requesterId, 'decline')}
                              style={{ marginRight: 6 }}
                            >
                              Decline
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onPress={() => handleRespond(req.requesterId, 'accept')}
                            >
                              Accept
                            </Button>
                          </View>
                        </View>
                      </Card>
                    ))
                  )}

                  {outgoingRequests.length > 0 && (
                    <View style={{ marginTop: 16 }}>
                      <Text variant="label" style={{ color: colors.textSecondary, marginBottom: 8 }}>
                        OUTGOING PENDING
                      </Text>
                      {outgoingRequests.map((out) => (
                        <Card
                          key={out.targetId}
                          style={[styles.friendCard, { borderColor: colors.border, marginBottom: 8 }]}
                        >
                          <View style={styles.friendRow}>
                            <View style={{ flex: 1 }}>
                              <Text variant="body" style={{ color: colors.textPrimary }}>
                                {out.displayName}
                              </Text>
                              <Text variant="caption" style={{ color: colors.textSecondary }}>
                                {out.handle ? `@${out.handle}` : 'Operative'} (Pending)
                              </Text>
                            </View>
                          </View>
                        </Card>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Tab: Add Friend */}
              {activeTab === 'add' && (
                <View>
                  <Text variant="label" style={{ color: colors.primary, marginBottom: 4 }}>
                    CONNECT BY EXACT HANDLE
                  </Text>
                  <Text variant="caption" style={{ color: colors.textSecondary, marginBottom: 12 }}>
                    No directory browsing or suggestions. Enter an operative's unique handle.
                  </Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          color: colors.textPrimary,
                          borderColor: colors.border,
                          borderRadius: radii.sm,
                        },
                      ]}
                      placeholder="@handle"
                      placeholderTextColor={colors.textSecondary}
                      value={targetHandle}
                      onChangeText={setTargetHandle}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Button
                      variant="primary"
                      onPress={handleSendRequest}
                      disabled={sendingRequest || !targetHandle.trim()}
                      style={{ marginLeft: 8 }}
                    >
                      {sendingRequest ? 'Sending...' : 'Send'}
                    </Button>
                  </View>

                  {statusMessage ? (
                    <Text variant="caption" style={{ color: colors.primary, marginTop: 8 }}>
                      {statusMessage}
                    </Text>
                  ) : null}

                  <View style={[styles.divider, { backgroundColor: colors.border }]} />

                  <Text variant="label" style={{ color: colors.primary, marginBottom: 4 }}>
                    INVITE TOKEN / QR
                  </Text>
                  <Text variant="caption" style={{ color: colors.textSecondary, marginBottom: 12 }}>
                    Generate a single-use 24-hour invite link to share via message or QR code.
                  </Text>
                  <Button variant="secondary" onPress={handleShareInvite}>
                    Share Invite Link / QR
                  </Button>
                </View>
              )}

              {/* Tab: Privacy & Settings */}
              {activeTab === 'privacy' && (
                <View>
                  <Text variant="label" style={{ color: colors.primary, marginBottom: 12 }}>
                    SOCIAL PRIVACY CONTROLS
                  </Text>

                  <View style={styles.settingRow}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text variant="body" style={{ color: colors.textPrimary, fontWeight: '600' }}>
                        Allow Friend Requests
                      </Text>
                      <Text variant="caption" style={{ color: colors.textSecondary }}>
                        When off, incoming requests from non-friends are rejected silently.
                      </Text>
                    </View>
                    <Switch
                      value={settings.allowFriendRequests}
                      onValueChange={(val) => handleToggleSetting('allowFriendRequests', val)}
                    />
                  </View>

                  <View style={styles.settingRow}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text variant="body" style={{ color: colors.textPrimary, fontWeight: '600' }}>
                        Show Friends When I'm Hosting
                      </Text>
                      <Text variant="caption" style={{ color: colors.textSecondary }}>
                        Broadcasts your lobby mode & count to accepted friends. Never shares location.
                      </Text>
                    </View>
                    <Switch
                      value={settings.showPresence}
                      onValueChange={(val) => handleToggleSetting('showPresence', val)}
                    />
                  </View>

                  <View style={styles.settingRow}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text variant="body" style={{ color: colors.textPrimary, fontWeight: '600' }}>
                        Share My Echo with Friends
                      </Text>
                      <Text variant="caption" style={{ color: colors.textSecondary }}>
                        Allows accepted friends to see your season Echo total on the private friends board.
                      </Text>
                    </View>
                    <Switch
                      value={settings.shareEcho}
                      onValueChange={(val) => handleToggleSetting('shareEcho', val)}
                    />
                  </View>

                  {blocks.length > 0 && (
                    <View style={{ marginTop: 20 }}>
                      <Text variant="label" style={{ color: colors.danger, marginBottom: 8 }}>
                        BLOCKED OPERATIVES ({blocks.length})
                      </Text>
                      {blocks.map((b) => (
                        <View key={b.blockedUserId} style={styles.blockedRow}>
                          <Text variant="body" style={{ color: colors.textPrimary }}>
                            {b.displayName} {b.handle ? `(@${b.handle})` : ''}
                          </Text>
                          <Button
                            variant="secondary"
                            size="sm"
                            onPress={() => handleUnblock(b.blockedUserId)}
                          >
                            Unblock
                          </Button>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  container: {
    maxHeight: '85%',
    minHeight: '60%',
    padding: 16,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  closeBtn: {
    padding: 6,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  tabItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  loader: {
    padding: 32,
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  friendCard: {
    padding: 12,
    borderWidth: 1,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  presenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  unfriendBtn: {
    padding: 6,
  },
  requestActions: {
    flexDirection: 'row',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  divider: {
    height: 1,
    marginVertical: 20,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
});
