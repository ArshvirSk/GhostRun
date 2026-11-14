import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import {
  FriendsBoardEntry,
  HeadToHeadStats,
  HOW_ECHO_WORKS_EXPLAINER,
  getBoardEmptyStateMessage,
} from '../lib/friendsBoardCore';
import {
  fetchFriendsBoard,
  fetchHeadToHead,
} from '../lib/friendsBoard';
import { updateFriendSettings } from '../lib/friends';

interface FriendsBoardModalProps {
  visible: boolean;
  onClose: () => void;
}

export function FriendsBoardModal({ visible, onClose }: FriendsBoardModalProps) {
  const { colors, spacing, radii } = useTheme();

  const [loading, setLoading] = useState(false);
  const [boardEntries, setBoardEntries] = useState<FriendsBoardEntry[]>([]);
  const [canView, setCanView] = useState(true);
  const [season, setSeason] = useState('2026-11');
  const [selectedSeason, setSelectedSeason] = useState<'current' | 'previous'>('current');

  // Modals inside
  const [explainerVisible, setExplainerVisible] = useState(false);
  const [h2hStats, setH2hStats] = useState<HeadToHeadStats | null>(null);
  const [loadingH2h, setLoadingH2h] = useState(false);

  const loadBoard = async () => {
    setLoading(true);
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const prevMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7);
      const targetSeason = selectedSeason === 'current' ? currentMonth : prevMonth;
      setSeason(targetSeason);

      const res = await fetchFriendsBoard(targetSeason);
      setCanView(res.canView);
      setBoardEntries(res.board);
    } catch {
      setBoardEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      void loadBoard();
    }
  }, [visible, selectedSeason]);

  const handleInspectFriend = async (friendId: string) => {
    setLoadingH2h(true);
    try {
      const stats = await fetchHeadToHead(friendId);
      setH2hStats(stats);
    } catch {
      Alert.alert('Error', 'Could not load head-to-head records');
    } finally {
      setLoadingH2h(false);
    }
  };

  const handleEnableShareEcho = async () => {
    await updateFriendSettings({
      allowFriendRequests: true,
      showPresence: false,
      shareEcho: true,
    });
    triggerHaptic('buttonTap');
    void loadBoard();
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
                FRIENDS ECHO BOARD
              </Text>
              <Text variant="caption" style={{ color: colors.textSecondary }}>
                Season {season} • 60m Privacy Delay Active
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable
                onPress={() => {
                  triggerHaptic('buttonTap');
                  setExplainerVisible(true);
                }}
                style={[styles.iconBtn, { marginRight: 8 }]}
              >
                <Ionicons name="help-circle-outline" size={22} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => {
                  triggerHaptic('buttonTap');
                  onClose();
                }}
                style={styles.iconBtn}
              >
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
          </View>

          {/* Season Selector */}
          <View style={styles.seasonRow}>
            <Pressable
              onPress={() => {
                triggerHaptic('buttonTap');
                setSelectedSeason('current');
              }}
              style={[
                styles.seasonChip,
                selectedSeason === 'current' && {
                  backgroundColor: colors.primary,
                  borderColor: colors.primary,
                },
                { borderColor: colors.border },
              ]}
            >
              <Text
                variant="label"
                style={{
                  color: selectedSeason === 'current' ? '#000' : colors.textSecondary,
                  fontWeight: '700',
                }}
              >
                THIS MONTH
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                triggerHaptic('buttonTap');
                setSelectedSeason('previous');
              }}
              style={[
                styles.seasonChip,
                selectedSeason === 'previous' && {
                  backgroundColor: colors.primary,
                  borderColor: colors.primary,
                },
                { borderColor: colors.border },
              ]}
            >
              <Text
                variant="label"
                style={{
                  color: selectedSeason === 'previous' ? '#000' : colors.textSecondary,
                  fontWeight: '700',
                }}
              >
                LAST MONTH
              </Text>
            </Pressable>
          </View>

          {/* Body Content */}
          {loading ? (
            <View style={styles.loader}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : !canView ? (
            <View style={styles.consentPrompt}>
              <Ionicons name="lock-closed-outline" size={40} color={colors.primary} />
              <Text variant="title" style={{ color: colors.textPrimary, marginTop: 12 }}>
                Private Friends Board
              </Text>
              <Text
                variant="body"
                style={{ color: colors.textSecondary, textAlign: 'center', marginVertical: 12 }}
              >
                To view the friends board, you must choose to share your Echo score with your accepted
                friends. No coordinates, locations, or dates are ever shared.
              </Text>
              <View style={styles.consentActions}>
                <Button variant="secondary" onPress={onClose} style={{ flex: 1, marginRight: 8 }}>
                  Keep Private
                </Button>
                <Button variant="primary" onPress={handleEnableShareEcho} style={{ flex: 1 }}>
                  Share My Echo
                </Button>
              </View>
            </View>
          ) : boardEntries.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="trophy-outline" size={40} color={colors.textSecondary} />
              <Text variant="body" style={{ color: colors.textPrimary, fontWeight: '600', marginTop: 12 }}>
                {getBoardEmptyStateMessage(boardEntries.length).title}
              </Text>
              <Text
                variant="caption"
                style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 6 }}
              >
                {getBoardEmptyStateMessage(boardEntries.length).subtitle}
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.boardList}>
              {boardEntries.map((entry) => (
                <Pressable
                  key={entry.userId}
                  onPress={() => !entry.isSelf && handleInspectFriend(entry.userId)}
                >
                  <Card
                    style={[
                      styles.entryCard,
                      {
                        borderColor: entry.isSelf ? colors.primary : colors.border,
                        backgroundColor: entry.isSelf
                          ? 'rgba(0, 229, 255, 0.08)'
                          : colors.surface,
                      },
                    ]}
                  >
                    <View style={styles.entryRow}>
                      <View style={styles.rankBadge}>
                        <Text
                          variant="title"
                          style={{
                            color: entry.isSelf ? colors.primary : colors.textPrimary,
                            fontSize: 18,
                            fontWeight: '800',
                          }}
                        >
                          #{entry.rank}
                        </Text>
                      </View>

                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text
                            variant="body"
                            style={{
                              fontWeight: '700',
                              color: entry.isSelf ? colors.primary : colors.textPrimary,
                            }}
                          >
                            {entry.displayName}
                          </Text>
                          {entry.isSelf && (
                            <Text variant="caption" style={{ color: colors.primary, marginLeft: 6 }}>
                              (You)
                            </Text>
                          )}
                        </View>
                        <Text variant="caption" style={{ color: colors.textSecondary }}>
                          {entry.handle ? `@${entry.handle}` : 'Operative'} • {entry.tier}
                        </Text>
                      </View>

                      <View style={{ alignItems: 'flex-end' }}>
                        <Text
                          variant="title"
                          style={{
                            fontWeight: '800',
                            color: entry.isSelf ? colors.primary : colors.textPrimary,
                            fontSize: 20,
                          }}
                        >
                          {entry.seasonEcho}
                        </Text>
                        <Text variant="caption" style={{ color: colors.textSecondary, fontSize: 10 }}>
                          G: {entry.avgGhost}% • C: {entry.avgCash}%
                        </Text>
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Explainer Modal */}
          <Modal
            visible={explainerVisible}
            animationType="fade"
            transparent
            onRequestClose={() => setExplainerVisible(false)}
          >
            <View style={styles.explainerOverlay}>
              <View
                style={[
                  styles.explainerBox,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.header}>
                  <Text variant="title" style={{ color: colors.primary }}>
                    {HOW_ECHO_WORKS_EXPLAINER.title}
                  </Text>
                  <Pressable onPress={() => setExplainerVisible(false)}>
                    <Ionicons name="close" size={24} color={colors.textPrimary} />
                  </Pressable>
                </View>
                <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                  {HOW_ECHO_WORKS_EXPLAINER.sections.map((sec, idx) => (
                    <View key={idx} style={{ marginBottom: 12 }}>
                      <Text variant="body" style={{ fontWeight: '700', color: colors.textPrimary }}>
                        {sec.title}
                      </Text>
                      <Text variant="caption" style={{ color: colors.textSecondary, marginTop: 2 }}>
                        {sec.body}
                      </Text>
                    </View>
                  ))}

                  <Text
                    variant="label"
                    style={{ color: colors.primary, marginTop: 12, marginBottom: 8 }}
                  >
                    CALIBRATED WORKED EXAMPLES
                  </Text>
                  {HOW_ECHO_WORKS_EXPLAINER.workedExamples.map((ex, idx) => (
                    <Card
                      key={idx}
                      style={{
                        padding: 10,
                        borderColor: colors.border,
                        marginBottom: 8,
                        backgroundColor: colors.background,
                      }}
                    >
                      <Text variant="body" style={{ fontWeight: '700', color: colors.primary }}>
                        {ex.agent} → {ex.result}
                      </Text>
                      <Text variant="caption" style={{ color: colors.textSecondary }}>
                        {ex.context}
                      </Text>
                      <Text variant="caption" style={{ color: colors.textMuted, fontStyle: 'italic', marginTop: 2 }}>
                        Formula: {ex.formula}
                      </Text>
                    </Card>
                  ))}
                </ScrollView>
              </View>
            </View>
          </Modal>

          {/* Head to Head Sheet */}
          {h2hStats && (
            <Modal
              visible={Boolean(h2hStats)}
              animationType="slide"
              transparent
              onRequestClose={() => setH2hStats(null)}
            >
              <View style={styles.explainerOverlay}>
                <View
                  style={[
                    styles.explainerBox,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.header}>
                    <View>
                      <Text variant="title" style={{ color: colors.primary }}>
                        HEAD-TO-HEAD DOSSIER
                      </Text>
                      <Text variant="caption" style={{ color: colors.textSecondary }}>
                        Versus {h2hStats.friendName} {h2hStats.friendHandle ? `(@${h2hStats.friendHandle})` : ''}
                      </Text>
                    </View>
                    <Pressable onPress={() => setH2hStats(null)}>
                      <Ionicons name="close" size={24} color={colors.textPrimary} />
                    </Pressable>
                  </View>

                  <ScrollView contentContainerStyle={{ paddingVertical: 12 }}>
                    <Card style={{ padding: 14, borderColor: colors.border, marginBottom: 12 }}>
                      <Text variant="label" style={{ color: colors.textSecondary }}>
                        OPPOSITE ROLES PLAYED
                      </Text>
                      <Text variant="title" style={{ fontSize: 28, fontWeight: '800', color: colors.textPrimary, marginVertical: 4 }}>
                        {h2hStats.oppositeRounds} Matches
                      </Text>
                      <Text variant="caption" style={{ color: colors.textSecondary }}>
                        Rounds played on opposing teams (Runner vs. Hunter).
                      </Text>
                    </Card>

                    <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                      <Card style={{ flex: 1, padding: 12, borderColor: colors.border, marginRight: 8 }}>
                        <Text variant="label" style={{ color: colors.success }}>
                          YOUR WINS
                        </Text>
                        <Text variant="title" style={{ fontSize: 24, fontWeight: '800', color: colors.success }}>
                          {h2hStats.myWins}
                        </Text>
                      </Card>
                      <Card style={{ flex: 1, padding: 12, borderColor: colors.border }}>
                        <Text variant="label" style={{ color: colors.danger }}>
                          THEIR WINS
                        </Text>
                        <Text variant="title" style={{ fontSize: 24, fontWeight: '800', color: colors.danger }}>
                          {h2hStats.friendWins}
                        </Text>
                      </Card>
                    </View>

                    <View style={{ flexDirection: 'row' }}>
                      <Card style={{ flex: 1, padding: 12, borderColor: colors.border, marginRight: 8 }}>
                        <Text variant="label" style={{ color: colors.primary }}>
                          PINGS GHOSTED
                        </Text>
                        <Text variant="title" style={{ fontSize: 24, fontWeight: '800', color: colors.primary }}>
                          {h2hStats.timesGhostedThem}
                        </Text>
                        <Text variant="caption" style={{ color: colors.textSecondary, fontSize: 10 }}>
                          Times you evaded their search
                        </Text>
                      </Card>
                      <Card style={{ flex: 1, padding: 12, borderColor: colors.border }}>
                        <Text variant="label" style={{ color: colors.warning }}>
                          PINGS CASHED
                        </Text>
                        <Text variant="title" style={{ fontSize: 24, fontWeight: '800', color: colors.warning }}>
                          {h2hStats.timesTheyCashedMe}
                        </Text>
                        <Text variant="caption" style={{ color: colors.textSecondary, fontSize: 10 }}>
                          Times they tagged/intercepted you
                        </Text>
                      </Card>
                    </View>
                  </ScrollView>
                </View>
              </View>
            </Modal>
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
    maxHeight: '90%',
    minHeight: '70%',
    padding: 16,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconBtn: {
    padding: 4,
  },
  seasonRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  seasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    marginRight: 8,
  },
  loader: {
    padding: 32,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentPrompt: {
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentActions: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 16,
  },
  boardList: {
    paddingBottom: 24,
  },
  entryCard: {
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rankBadge: {
    width: 36,
    alignItems: 'center',
  },
  explainerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  explainerBox: {
    maxHeight: '85%',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
});
