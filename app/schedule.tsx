import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Chip } from '../src/ui/Chip';
import { SegmentBar } from '../src/ui/SegmentBar';
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

type TabKey = 'upcoming' | 'create';

export default function ScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { colors, spacing, radii, isDark } = useTheme();

  const [activeTab, setActiveTab] = useState<TabKey>('upcoming');
  const [upcomingGames, setUpcomingGames] = useState<ScheduledGame[]>([]);
  const [loading, setLoading] = useState(true);

  const pagerRef = useRef<React.ElementRef<typeof ScrollView>>(null);

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

  const handleTabChange = (id: string) => {
    const tabKey = id as TabKey;
    setActiveTab(tabKey);
    setErrorMessage('');
    const pageIndex = tabKey === 'upcoming' ? 0 : 1;
    pagerRef.current?.scrollTo({ x: pageIndex * screenWidth, animated: true });
  };

  const handlePagerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(offsetX / screenWidth);
    const newTab: TabKey = pageIndex === 0 ? 'upcoming' : 'create';
    if (newTab !== activeTab) {
      triggerHaptic('buttonTap');
      setActiveTab(newTab);
      setErrorMessage('');
    }
  };

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
    handleTabChange('upcoming');
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      {/* Sticky Top Header Area */}
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

        <Text variant="display" style={{ color: colors.text, marginTop: spacing.xs, marginBottom: spacing.sm }}>
          SCHEDULE
        </Text>

        {/* 2-Tab Segment Bar with Animated Slider */}
        <SegmentBar
          items={[
            { id: 'upcoming', label: upcomingGames.length > 0 ? `UPCOMING (${upcomingGames.length})` : 'UPCOMING' },
            { id: 'create', label: 'SCHEDULE NEW' },
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
        {/* PAGE 1: UPCOMING MISSIONS */}
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
                Scanning tactical calendar...
              </Text>
            </View>
          ) : upcomingGames.length === 0 ? (
            <Card
              variant="elevated"
              style={[
                styles.emptyCard,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.borderDark },
              ]}
            >
              <Ionicons name="calendar-outline" size={38} color={colors.textSubtle} />
              <Text variant="title" style={{ color: colors.text, marginTop: spacing.sm }}>
                No Upcoming Missions
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
                No operations currently scheduled. Deploy a new scheduled mission to alert your squad!
              </Text>
              <Button
                title="Schedule New Mission"
                variant="primary"
                size="sm"
                onPress={() => handleTabChange('create')}
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
                  style={[
                    styles.gameCard,
                    { backgroundColor: colors.surface, borderColor: colors.borderDark },
                  ]}
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
                        <Text
                          variant="caption"
                          style={{
                            color: colors.textSubtle,
                            marginTop: 4,
                            fontStyle: 'italic',
                          }}
                        >
                          "{game.notes}"
                        </Text>
                      ) : null}
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Export to Calendar"
                      onPress={() => void handleExportCalendar(game)}
                      style={[
                        styles.iconBtn,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.borderDark,
                        },
                      ]}
                    >
                      <Ionicons name="calendar-outline" size={18} color={colors.text} />
                    </Pressable>
                  </View>

                  {/* RSVP Action Bar */}
                  <View style={[styles.rsvpRow, { borderTopColor: colors.borderLight }]}>
                    <Text variant="label" style={{ color: colors.textMuted, fontSize: 11 }}>
                      RSVP:
                    </Text>
                    <View style={styles.rsvpButtons}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={rsvpLoading === game.id}
                        onPress={() => void handleRsvp(game.id, 'attending')}
                        style={[
                          styles.rsvpBtn,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.borderDark,
                          },
                        ]}
                      >
                        <Ionicons name="checkmark-circle" size={14} color={colors.runner} />
                        <Text variant="caption" style={{ color: colors.text, marginLeft: 4, fontSize: 11 }}>
                          Going
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        disabled={rsvpLoading === game.id}
                        onPress={() => void handleRsvp(game.id, 'tentative')}
                        style={[
                          styles.rsvpBtn,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.borderDark,
                          },
                        ]}
                      >
                        <Ionicons name="help-circle" size={14} color={colors.warning} />
                        <Text variant="caption" style={{ color: colors.text, marginLeft: 4, fontSize: 11 }}>
                          Maybe
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        disabled={rsvpLoading === game.id}
                        onPress={() => void handleRsvp(game.id, 'declined')}
                        style={[
                          styles.rsvpBtn,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.borderDark,
                          },
                        ]}
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
        </ScrollView>

        {/* PAGE 2: SCHEDULE NEW MISSION */}
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
          {createdGame ? (
            <Card
              variant="elevated"
              style={[
                styles.successCard,
                { backgroundColor: colors.surface, borderColor: colors.primary },
              ]}
            >
              <Ionicons name="checkmark-circle" size={44} color={colors.primary} />
              <Text variant="title" style={{ color: colors.text, marginTop: spacing.sm }}>
                Operation Scheduled!
              </Text>
              <Text
                variant="body"
                style={{
                  color: colors.textMuted,
                  textAlign: 'center',
                  marginTop: 4,
                  marginBottom: spacing.md,
                }}
              >
                "{createdGame.title}" has been saved. Export it to your device calendar or deploy
                directly with your squad.
              </Text>

              <View style={styles.successBtnRow}>
                <Button
                  title="Export to Calendar"
                  variant="primary"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => void handleExportCalendar(createdGame)}
                />
                <Button
                  title="Done"
                  variant="secondary"
                  size="sm"
                  style={{ flex: 0.8 }}
                  onPress={handleResetForm}
                />
              </View>
            </Card>
          ) : (
            <Card
              variant="default"
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.borderDark },
              ]}
            >
              <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
                OPERATION TITLE *
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Midnight Sector Extraction"
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
                maxLength={50}
              />

              {/* Game Mode Selector */}
              <Text
                variant="label"
                style={{
                  color: colors.textMuted,
                  marginTop: spacing.md,
                  marginBottom: spacing.xs,
                }}
              >
                GAME MODE
              </Text>
              <View style={styles.modeChipsRow}>
                {MODES.map((m) => (
                  <Chip
                    key={m.id}
                    label={m.name}
                    variant={selectedMode === m.id ? 'accent' : 'muted'}
                    size="sm"
                    onPress={() => setSelectedMode(m.id)}
                  />
                ))}
              </View>

              {/* Rendezvous Time Presets */}
              <Text
                variant="label"
                style={{
                  color: colors.textMuted,
                  marginTop: spacing.md,
                  marginBottom: spacing.xs,
                }}
              >
                RENDEZVOUS TIME
              </Text>
              <View style={styles.presetsGrid}>
                {PRESET_TIMES.map((preset, idx) => {
                  const isSelected = selectedPresetIndex === idx;
                  return (
                    <Pressable
                      key={preset.label}
                      onPress={() => {
                        triggerHaptic('buttonTap');
                        setSelectedPresetIndex(idx);
                      }}
                      style={[
                        styles.presetChip,
                        {
                          borderColor: isSelected ? colors.primary : colors.borderDark,
                          backgroundColor: isSelected
                            ? colors.surfaceElevated
                            : colors.surface,
                        },
                      ]}
                    >
                      <Ionicons
                        name="time-outline"
                        size={13}
                        color={isSelected ? colors.primary : colors.textMuted}
                      />
                      <Text
                        variant="caption"
                        style={{
                          fontWeight: isSelected ? '700' : '400',
                          marginLeft: 5,
                          color: isSelected ? colors.text : colors.textMuted,
                        }}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Target Time Confirmation Display */}
              <View
                style={[
                  styles.timePreview,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.borderLight,
                  },
                ]}
              >
                <Ionicons name="calendar" size={15} color={colors.primary} />
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
              <Text
                variant="label"
                style={{
                  color: colors.textMuted,
                  marginTop: spacing.md,
                  marginBottom: spacing.xs,
                }}
              >
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
              <Text
                variant="label"
                style={{
                  color: colors.textMuted,
                  marginTop: spacing.md,
                  marginBottom: spacing.xs,
                }}
              >
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
  card: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 16,
  },
  gameCard: {
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 10,
  },
  gameCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  rsvpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  rsvpStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rsvpButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  rsvpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  input: {
    height: 46,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  textArea: {
    height: 70,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  modeChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  presetChip: {
    flexGrow: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  timePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
  },
  successCard: {
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    borderRadius: 16,
  },
  successBtnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
});
