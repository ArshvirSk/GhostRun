import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import { supabase } from '../lib/supabase';
import {
  RADIO_QUICK_CHIPS,
  sanitizeRadioMessage,
  checkRadioRateLimit,
  filterBlockedMessages,
  TeamMessage,
  RadioQuickChip,
  MAX_RADIO_MESSAGE_LENGTH,
} from '../lib/teamRadio';

interface TeamRadioSheetProps {
  visible: boolean;
  gameId: string;
  myTeam: 'runner' | 'hunter' | string;
  myUserId?: string;
  onClose: () => void;
  onUnreadChange?: (count: number) => void;
}

export function TeamRadioSheet({
  visible,
  gameId,
  myTeam,
  myUserId,
  onClose,
  onUnreadChange,
}: TeamRadioSheetProps) {
  const { colors, spacing, radii } = useTheme();
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set());
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [selectedMessage, setSelectedMessage] = useState<TeamMessage | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportReason, setReportReason] = useState('harassment');
  const [reportDetails, setReportDetails] = useState('');

  const sendHistoryRef = useRef<number[]>([]);
  const scrollViewRef = useRef<any>(null);

  // Load blocked users
  useEffect(() => {
    if (!supabase || !myUserId) return;
    void supabase
      .from('blocks')
      .select('blocked_user_id')
      .eq('user_id', myUserId)
      .then(({ data }) => {
        if (data) {
          setBlockedUsers(new Set(data.map((r: any) => r.blocked_user_id)));
        }
      });
  }, [myUserId]);

  // Load existing messages & subscribe to realtime
  useEffect(() => {
    if (!supabase || !gameId) return;

    void supabase
      .from('team_messages')
      .select('*')
      .eq('game_id', gameId)
      .eq('team', myTeam)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) {
          setMessages(data as TeamMessage[]);
        }
      });

    const channel = supabase
      .channel(`radio_${gameId}_${myTeam}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'team_messages',
          filter: `game_id=eq.${gameId}`,
        },
        (payload: { new: TeamMessage }) => {
          if (payload.new && payload.new.team === myTeam) {
            setMessages((prev) => [...prev, payload.new]);
            if (!visible && onUnreadChange) {
              onUnreadChange(1);
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [gameId, myTeam, visible, onUnreadChange]);

  const visibleMessages = filterBlockedMessages(messages, blockedUsers);

  async function handleSend(kind: 'text' | 'chip', body: string) {
    if (!supabase || sending) return;
    setStatusError('');

    const rateCheck = checkRadioRateLimit(sendHistoryRef.current);
    if (!rateCheck.allowed) {
      triggerHaptic('error');
      setStatusError(`Cooldown active: wait ${Math.ceil(rateCheck.waitMs / 1000)}s`);
      return;
    }

    const { cleanText, isValid, error } = sanitizeRadioMessage(body);
    if (!isValid) {
      triggerHaptic('error');
      setStatusError(error || 'Invalid message');
      return;
    }

    setSending(true);
    triggerHaptic('buttonTap');

    try {
      const { data, error: rpcErr } = await supabase.rpc('send_team_message', {
        p_game_id: gameId,
        p_kind: kind,
        p_body: cleanText,
      });

      if (rpcErr) {
        setStatusError(rpcErr.message);
        triggerHaptic('error');
      } else {
        sendHistoryRef.current.push(Date.now());
        if (kind === 'text') setInputText('');
        if (data) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.id)) return prev;
            return [...prev, data as TeamMessage];
          });
        }
      }
    } catch (e: any) {
      setStatusError(e.message || 'Failed to dispatch radio transmission');
    } finally {
      setSending(false);
    }
  }

  async function handleBlockUser(targetUserId: string) {
    if (!supabase) return;
    triggerHaptic('error');
    try {
      await supabase.rpc('block_user', { p_target_user_id: targetUserId });
      setBlockedUsers((prev) => new Set([...prev, targetUserId]));
      setSelectedMessage(null);
      Alert.alert('Player Blocked', 'Messages from this user are now hidden.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleSubmitReport() {
    if (!supabase || !selectedMessage) return;
    triggerHaptic('buttonTap');
    try {
      await supabase.rpc('report_player', {
        p_reported_user_id: selectedMessage.sender_user_id,
        p_game_id: gameId,
        p_message_id: selectedMessage.id,
        p_reason: reportReason,
        p_details: reportDetails,
      });
      setReportModalVisible(false);
      setSelectedMessage(null);
      setReportDetails('');
      Alert.alert('Report Submitted', 'Thank you for reporting. Our moderation system will review this promptly.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  const teamColor = myTeam === 'hunter' ? colors.danger : colors.primary;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Card
          variant="elevated"
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderDark,
              borderTopLeftRadius: radii.card,
              borderTopRightRadius: radii.card,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <View style={[styles.signalDot, { backgroundColor: teamColor }]} />
              <View>
                <Text variant="label" style={{ color: teamColor, letterSpacing: 1.5 }}>
                  {myTeam.toUpperCase()} RADIO CHANNEL
                </Text>
                <Text variant="caption" style={{ color: colors.textMuted }}>
                  Team-encrypted field transmissions
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Radio"
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceElevated }]}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Messages Scroll View */}
          <ScrollView
            ref={scrollViewRef}
            style={styles.messageList}
            contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
          >
            {visibleMessages.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="radio-outline" size={36} color={colors.textMuted} />
                <Text variant="body" style={{ color: colors.textMuted, marginTop: 8 }}>
                  Radio channel silent. Tap a quick chip below to send the first transmission.
                </Text>
              </View>
            ) : (
              visibleMessages.map((msg) => {
                const isMe = msg.sender_user_id === myUserId;
                const isChip = msg.kind === 'chip';

                return (
                  <Pressable
                    key={msg.id}
                    onLongPress={() => {
                      if (!isMe) setSelectedMessage(msg);
                    }}
                    style={[
                      styles.msgBubble,
                      isMe ? styles.myMsgBubble : styles.theirMsgBubble,
                      {
                        backgroundColor: isChip
                          ? colors.surfaceElevated
                          : isMe
                          ? colors.surfaceElevated
                          : colors.surfaceElevated,
                        borderColor: isChip ? teamColor : colors.borderDark,
                      },
                    ]}
                  >
                    {!isMe && (
                      <Text variant="label" style={{ color: teamColor, fontSize: 10, marginBottom: 2 }}>
                        {msg.sender_name}
                      </Text>
                    )}
                    <Text
                      variant="body"
                      style={{
                        color: colors.text,
                        fontWeight: isChip ? '700' : '400',
                      }}
                    >
                      {msg.body}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          {/* Quick Chips Row */}
          <View style={styles.chipsRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.md }}>
              {RADIO_QUICK_CHIPS.map((chip) => (
                <Pressable
                  key={chip.id}
                  disabled={sending}
                  onPress={() => void handleSend('chip', chip.label)}
                  style={[
                    styles.chipBtn,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: chip.intent === 'danger' ? colors.danger : colors.borderDark,
                    },
                  ]}
                >
                  <Text
                    variant="label"
                    style={{
                      color: chip.intent === 'danger' ? colors.danger : colors.text,
                      fontSize: 11,
                    }}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Status / Error */}
          {statusError !== '' && (
            <Text variant="caption" style={{ color: colors.danger, textAlign: 'center', marginVertical: 4 }}>
              {statusError}
            </Text>
          )}

          {/* Text Input Row */}
          <View style={[styles.inputRow, { borderColor: colors.borderDark }]}>
            <TextInput
              style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceElevated }]}
              placeholder="Type transmission…"
              placeholderTextColor={colors.textMuted}
              value={inputText}
              onChangeText={setInputText}
              maxLength={MAX_RADIO_MESSAGE_LENGTH}
              returnKeyType="send"
              onSubmitEditing={() => {
                if (inputText.trim()) void handleSend('text', inputText);
              }}
            />
            <Button
              title="Send"
              size="sm"
              variant="primary"
              disabled={!inputText.trim() || sending}
              loading={sending}
              onPress={() => void handleSend('text', inputText)}
            />
          </View>
        </Card>
      </KeyboardAvoidingView>

      {/* Message Moderation Action Sheet */}
      {selectedMessage && (
        <Modal transparent animationType="fade" visible={Boolean(selectedMessage)}>
          <View style={styles.modOverlay}>
            <Card
              variant="elevated"
              style={[styles.modCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
            >
              <Text variant="title" style={{ color: colors.text, marginBottom: spacing.xs }}>
                Operative Comms Action
              </Text>
              <Text variant="body" style={{ color: colors.textMuted, marginBottom: spacing.md }}>
                Transmission from: {selectedMessage.sender_name}
              </Text>

              <View style={{ gap: spacing.sm }}>
                <Button
                  title="Report Player"
                  variant="secondary"
                  onPress={() => setReportModalVisible(true)}
                />
                <Button
                  title="Block Player"
                  variant="danger"
                  onPress={() => void handleBlockUser(selectedMessage.sender_user_id)}
                />
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => setSelectedMessage(null)}
                />
              </View>
            </Card>
          </View>
        </Modal>
      )}

      {/* Report Modal */}
      {reportModalVisible && (
        <Modal transparent animationType="fade" visible={reportModalVisible}>
          <View style={styles.modOverlay}>
            <Card
              variant="elevated"
              style={[styles.modCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
            >
              <Text variant="title" style={{ color: colors.text, marginBottom: spacing.xs }}>
                Report Operative
              </Text>
              <Text variant="body" style={{ color: colors.textMuted, marginBottom: spacing.md }}>
                Select reason for reporting transmission:
              </Text>

              <View style={styles.reasonRow}>
                {['harassment', 'spam', 'hate_speech', 'other'].map((reason) => (
                  <Pressable
                    key={reason}
                    onPress={() => setReportReason(reason)}
                    style={[
                      styles.reasonChip,
                      {
                        backgroundColor: reportReason === reason ? colors.primary : colors.surfaceElevated,
                      },
                    ]}
                  >
                    <Text
                      variant="label"
                      style={{
                        color: reportReason === reason ? '#000' : colors.text,
                        fontSize: 11,
                      }}
                    >
                      {reason.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                style={[
                  styles.detailsInput,
                  { color: colors.text, backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark },
                ]}
                placeholder="Optional details…"
                placeholderTextColor={colors.textMuted}
                value={reportDetails}
                onChangeText={setReportDetails}
                multiline
                maxLength={300}
              />

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button
                  title="Submit"
                  variant="primary"
                  style={{ flex: 1 }}
                  onPress={() => void handleSubmitReport()}
                />
                <Button
                  title="Cancel"
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => setReportModalVisible(false)}
                />
              </View>
            </Card>
          </View>
        </Modal>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '80%',
    minHeight: '50%',
    borderWidth: 1,
    borderBottomWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#374151',
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageList: {
    flex: 1,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  msgBubble: {
    maxWidth: '85%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  myMsgBubble: {
    alignSelf: 'flex-end',
  },
  theirMsgBubble: {
    alignSelf: 'flex-start',
  },
  chipsRow: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#374151',
  },
  chipBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  modOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modCard: {
    width: '100%',
    maxWidth: 360,
    padding: 20,
    borderWidth: 1,
    borderRadius: 16,
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  reasonChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  detailsInput: {
    height: 60,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    fontSize: 13,
  },
});
