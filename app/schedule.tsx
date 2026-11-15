import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { Text } from '../src/ui/Text';
import { Card } from '../src/ui/Card';
import { Button } from '../src/ui/Button';
import { triggerHaptic } from '../src/motion/haptics';
import {
  ScheduledGame,
  RsvpStatus,
  createScheduledGameOnServer,
  fetchUpcomingScheduledGames,
  submitRsvpOnServer,
  shareScheduledGameCalendar,
} from '../src/lib/scheduledGames';

interface PresetTimeConfig {
  label: string;
  offsetHours?: number;
  fixedHour?: number;
  days?: number;
  dayOfWeek?: number;
}

const PRESET_TIMES: PresetTimeConfig[] = [
  { label: 'In 2 Hours', offsetHours: 2 },
  { label: 'Tonight (20:00)', fixedHour: 20 },
  { label: 'Tomorrow (15:00)', days: 1, fixedHour: 15 },
  { label: 'Saturday (14:00)', dayOfWeek: 6, fixedHour: 14 },
];

const MODES = [
  { id: 'classic_chase', name: 'Classic Chase' },
  { id: 'tag_hunt', name: 'Tag Hunt' },
  { id: 'jailbreak', name: 'Jailbreak' },
];

export default function ScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();

  const [activeTab, setActiveTab] = useState<'upcoming' | 'create'>('upcoming');
  const [upcomingGames, setUpcomingGames] = useState<ScheduledGame[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [title, setTitle] = useState('');
  const [selectedMode, setSelectedMode] = useState('classic_chase');
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);
  const [areaName, setAreaName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdGame, setCreatedGame] = useState<ScheduledGame | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [rsvpLoading, setRsvpLoading] = useState<string | null>(null);

  const loadUpcoming = useCallback(async () => {
    setLoading(true);
    const res = await fetchUpcomingScheduledGames();
    setLoading(false);
    if (res.success) {
      setUpcomingGames(res.games);
    }
  }, []);

  useEffect(() => {
    void loadUpcoming();
  }, [loadUpcoming]);

  function calculateTargetDate(index: number): Date {
    const now = new Date();
    const preset = PRESET_TIMES[index];

    if (preset.offsetHours !== undefined) {
      return new Date(now.getTime() + preset.offsetHours * 60 * 60 * 1000);
    }

    if (preset.fixedHour !== undefined) {
      const d = new Date(now);
      if (preset.days !== undefined) {
        d.setDate(d.getDate() + preset.days);
      } else if (d.getHours() >= preset.fixedHour) {
        d.setDate(d.getDate() + 1);
      }
      d.setHours(preset.fixedHour, 0, 0, 0);
      return d;
    }

    if (preset.dayOfWeek !== undefined) {
      const d = new Date(now);
      const currentDay = d.getDay();
      let diff = preset.dayOfWeek - currentDay;
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      d.setHours(preset.fixedHour ?? 14, 0, 0, 0);
      return d;
    }

    return new Date(now.getTime() + 2 * 60 * 60 * 1000);
  }

  async function handleSchedule() {
    if (submitting) return;
    setErrorMessage('');
    setSubmitting(true);
    triggerHaptic('buttonTap');

    const scheduledAt = calculateTargetDate(selectedPresetIndex);

    const result = await createScheduledGameOnServer({
      title,
      modeId: selectedMode,
      scheduledAt,
      areaName: areaName.trim() || undefined,
      notes: notes.trim() || undefined,
    });

    setSubmitting(false);

    if (!result.success || !result.gameId) {
      setErrorMessage(result.error || 'Failed to schedule operation');
      triggerHaptic('error');
      return;
    }

    triggerHaptic('tagConfirmed');

    const game: ScheduledGame = {
      id: result.gameId,
      host_id: '',
      title: title.trim(),
      mode_id: selectedMode,
      scheduled_at: scheduledAt.toISOString(),
      area_name: areaName.trim() || null,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
    };

    setCreatedGame(game);
    void loadUpcoming();
  }

  async function handleRsvp(gameId: string, status: RsvpStatus) {
    setRsvpLoading(gameId);
    triggerHaptic('buttonTap');
    const res = await submitRsvpOnServer(gameId, status);
    setRsvpLoading(null);
    if (res.success) {
      triggerHaptic('tagConfirmed');
      void loadUpcoming();
    }
  }

  async function handleExportCalendar(game: ScheduledGame) {
    triggerHaptic('buttonTap');
    await shareScheduledGameCalendar(game);
  }

  function handleResetForm() {
    setTitle('');
    setAreaName('');
    setNotes('');
    setCreatedGame(null);
    setErrorMessage('');
    setActiveTab('upcoming');
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
          SCHEDULE
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg }}>
          Plan upcoming tactical operations, RSVP with your squad, and export calendar reminders.
        </Text>

        {/* Nav Tabs */}
        <View style={[styles.tabBar, { borderColor: colors.borderDark, backgroundColor: colors.surface }]}>
          <Pressable
            accessibilityRole="tab"
            onPress={() => {
              triggerHaptic('buttonTap');
              setActiveTab('upcoming');
              setErrorMessage('');
            }}
            style={[
              styles.tabBtn,
              activeTab === 'upcoming' && {
                backgroundColor: colors.surfaceElevated,
                borderBottomColor: colors.primary,
                borderBottomWidth: 2,
              },
            ]}
          >
            <Ionicons
              name="calendar-outline"
              size={16}
              color={activeTab === 'upcoming' ? colors.primary : colors.textMuted}
            />
            <Text
              variant="label"
              style={{
                color: activeTab === 'upcoming' ? colors.text : colors.textMuted,
                marginLeft: 6,
              }}
            >
              UPCOMING ({upcomingGames.length})
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
              name="add-circle-outline"
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
              SCHEDULE NEW
            </Text>
          </Pressable>
        </View>

        {/* TAB 1: UPCOMING GAMES */}
        {activeTab === 'upcoming' && (
          <View style={{ marginTop: spacing.md }}>
            {loading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text variant="caption" style={{ color: colors.textMuted, marginTop: spacing.sm }}>
                  Scanning tactical calendar...
                </Text>
              </View>
            ) : upcomingGames.length === 0 ? (
              <Card
                variant="elevated"
                style={[styles.emptyCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
              >
                <Ionicons name="calendar-outline" size={40} color={colors.textSubtle} />
                <Text variant="title" style={{ color: colors.text, marginTop: spacing.sm }}>
                  No Upcoming Missions
                </Text>
                <Text variant="caption" style={{ color: colors.textMuted, textAlign: 'center', marginTop: 4, marginBottom: spacing.md }}>
                  No operations currently scheduled. Deploy a new scheduled mission to alert your squad!
                </Text>
                <Button
                  title="Schedule New Mission"
                  variant="primary"
                  size="sm"
                  onPress={() => setActiveTab('create')}
                />
              </Card>
            ) : (
              upcomingGames.map((game) => {
                const dateObj = new Date(game.scheduled_at);
                const dateStr = dateObj.toLocaleDateString([], {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                });
                const timeStr = dateObj.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <Card
                    key={game.id}
                    variant="elevated"
                    style={[styles.gameCard, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
                  >
                    <View style={styles.gameCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
                          {game.title}
                        </Text>
                        <Text variant="caption" style={{ color: colors.primary, marginTop: 2 }}>
                          {game.mode_id.toUpperCase().replace('_', ' ')} · {dateStr} at {timeStr}
                        </Text>
                        {game.area_name ? (
                          <View style={styles.inlineRow}>
                            <Ionicons name="location-outline" size={13} color={colors.textMuted} />
                            <Text variant="caption" style={{ color: colors.textMuted, marginLeft: 4 }}>
                              {game.area_name}
                            </Text>
                          </View>
                        ) : null}
                        {game.notes ? (
                          <Text variant="caption" style={{ color: colors.textSubtle, marginTop: 4, fontStyle: 'italic' }}>
                            "{game.notes}"
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Share Calendar Invite"
                        onPress={() => void handleExportCalendar(game)}
                        style={[styles.iconBtn, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
                      >
                        <Ionicons name="share-social-outline" size={18} color={colors.text} />
                      </Pressable>
                    </View>

                    {/* RSVP Action Bar */}
                    <View style={[styles.rsvpBar, { borderTopColor: colors.borderLight }]}>
                      <Text variant="label" style={{ color: colors.textMuted, fontSize: 11 }}>
                        RSVP:
                      </Text>
                      <View style={styles.rsvpBtnRow}>
                        <Pressable
                          onPress={() => void handleRsvp(game.id, 'attending')}
                          style={[styles.rsvpChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
                        >
                          <Ionicons name="checkmark-circle" size={14} color={colors.runner} />
                          <Text variant="caption" style={{ color: colors.text, marginLeft: 4, fontSize: 11 }}>
                            Going
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void handleRsvp(game.id, 'tentative')}
                          style={[styles.rsvpChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
                        >
                          <Ionicons name="help-circle" size={14} color={colors.warning} />
                          <Text variant="caption" style={{ color: colors.text, marginLeft: 4, fontSize: 11 }}>
                            Maybe
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void handleRsvp(game.id, 'declined')}
                          style={[styles.rsvpChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark }]}
                        >
                          <Ionicons name="close-circle" size={14} color={colors.danger} />
                          <Text variant="caption" style={{ color: colors.text, marginLeft: 4, fontSize: 11 }}>
                            Pass
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </Card>
                );
              })
            )}
          </View>
        )}

        {/* TAB 2: SCHEDULE NEW OPERATION */}
        {activeTab === 'create' && (
          <View style={{ marginTop: spacing.md }}>
            {createdGame ? (
              <Card
                variant="elevated"
                style={[styles.successCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.primary }]}
              >
                <Ionicons name="checkmark-circle-outline" size={48} color={colors.primary} />
                <Text variant="title" style={{ color: colors.text, marginTop: spacing.sm, textAlign: 'center' }}>
                  Operation Scheduled!
                </Text>
                <Text variant="body" style={{ color: colors.textMuted, textAlign: 'center', marginTop: 4 }}>
                  "{createdGame.title}" set for{' '}
                  {new Date(createdGame.scheduled_at).toLocaleString([], {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <View style={{ marginTop: spacing.lg, width: '100%', gap: spacing.sm }}>
                  <Button
                    title="Export / Share .ICS Calendar"
                    onPress={() => void handleExportCalendar(createdGame)}
                    variant="primary"
                  />
                  <Button
                    title="Back to Scheduled Missions"
                    onPress={handleResetForm}
                    variant="ghost"
                  />
                </View>
              </Card>
            ) : (
              <Card
                variant="default"
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderDark }]}
              >
                {errorMessage ? (
                  <View style={[styles.errorBox, { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder }]}>
                    <Ionicons name="alert-circle" size={16} color={colors.dangerText} />
                    <Text variant="caption" style={{ color: colors.dangerText, marginLeft: 6, flex: 1 }}>
                      {errorMessage}
                    </Text>
                  </View>
                ) : null}

                {/* Operation Title */}
                <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
                  OPERATION TITLE *
                </Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="e.g. Sector 7 Midnight Chase"
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
                  maxLength={60}
                />

                {/* Tactical Mode Selector */}
                <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs }}>
                  TACTICAL MODE
                </Text>
                <View style={styles.modeRow}>
                  {MODES.map((mode) => (
                    <Pressable
                      key={mode.id}
                      onPress={() => {
                        triggerHaptic('buttonTap');
                        setSelectedMode(mode.id);
                      }}
                      style={[
                        styles.modeChip,
                        {
                          borderColor: selectedMode === mode.id ? colors.primary : colors.borderDark,
                          backgroundColor: selectedMode === mode.id ? colors.surfaceElevated : colors.surface,
                        },
                      ]}
                    >
                      <Ionicons
                        name={selectedMode === mode.id ? 'radio-button-on' : 'radio-button-off'}
                        size={14}
                        color={selectedMode === mode.id ? colors.primary : colors.textMuted}
                      />
                      <Text
                        variant="caption"
                        style={{
                          fontWeight: '700',
                          marginLeft: 6,
                          color: selectedMode === mode.id ? colors.text : colors.textMuted,
                        }}
                      >
                        {mode.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Rendezvous Time Presets */}
                <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs }}>
                  RENDEZVOUS TIME
                </Text>
                <View style={styles.presetsGrid}>
                  {PRESET_TIMES.map((preset, idx) => (
                    <Pressable
                      key={preset.label}
                      onPress={() => {
                        triggerHaptic('buttonTap');
                        setSelectedPresetIndex(idx);
                      }}
                      style={[
                        styles.presetChip,
                        {
                          borderColor: selectedPresetIndex === idx ? colors.primary : colors.borderDark,
                          backgroundColor: selectedPresetIndex === idx ? colors.surfaceElevated : colors.surface,
                        },
                      ]}
                    >
                      <Ionicons
                        name="time-outline"
                        size={14}
                        color={selectedPresetIndex === idx ? colors.primary : colors.textMuted}
                      />
                      <Text
                        variant="caption"
                        style={{
                          fontWeight: selectedPresetIndex === idx ? '700' : '400',
                          marginLeft: 6,
                          color: selectedPresetIndex === idx ? colors.text : colors.textMuted,
                        }}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Target Time Confirmation Display */}
                <View style={[styles.timePreview, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderLight }]}>
                  <Ionicons name="calendar" size={16} color={colors.primary} />
                  <Text variant="caption" style={{ color: colors.text, marginLeft: 8 }}>
                    Scheduled for:{' '}
                    <Text variant="caption" style={{ color: colors.primary, fontWeight: '700' }}>
                      {calculateTargetDate(selectedPresetIndex).toLocaleString([], {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </Text>
                </View>

                {/* Tactical Area / Rendezvous Zone */}
                <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs }}>
                  RENDEZVOUS LOCATION (OPTIONAL)
                </Text>
                <TextInput
                  value={areaName}
                  onChangeText={setAreaName}
                  placeholder="e.g. Central Plaza Fountain"
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
                  maxLength={60}
                />

                {/* Field Notes */}
                <Text variant="label" style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs }}>
                  OPERATIONAL NOTES (OPTIONAL)
                </Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Tactical rules, gear requirements, or squad details..."
                  placeholderTextColor={colors.textSubtle}
                  multiline
                  numberOfLines={3}
                  style={[
                    styles.input,
                    styles.textArea,
                    {
                      borderColor: colors.borderDark,
                      backgroundColor: colors.surfaceElevated,
                      color: colors.text,
                      borderRadius: radii.sm,
                    },
                  ]}
                  maxLength={200}
                />

                <Button
                  title={submitting ? 'Transmitting Schedule...' : 'Schedule Operation'}
                  disabled={submitting || !title.trim()}
                  variant="primary"
                  style={{ marginTop: spacing.lg }}
                  onPress={() => void handleSchedule()}
                />
              </Card>
            )}
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
  gameCard: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 12,
  },
  gameCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  rsvpBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 10,
  },
  rsvpBtnRow: {
    flexDirection: 'row',
    gap: 6,
  },
  rsvpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  card: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  successCard: {
    padding: 24,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'System',
  },
  textArea: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
  },
  timePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 12,
  },
});
