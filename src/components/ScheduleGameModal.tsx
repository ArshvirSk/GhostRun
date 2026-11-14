import React, { useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui/Text';
import { Button } from '../ui/Button';
import { triggerHaptic } from '../motion/haptics';
import {
  createScheduledGameOnServer,
  shareScheduledGameCalendar,
  ScheduledGame,
} from '../lib/scheduledGames';

interface ScheduleGameModalProps {
  visible: boolean;
  onClose: () => void;
  onGameCreated?: (gameId: string) => void;
}

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

export function ScheduleGameModal({ visible, onClose, onGameCreated }: ScheduleGameModalProps) {
  const { colors, spacing, radii } = useTheme();

  const [title, setTitle] = useState('');
  const [selectedMode, setSelectedMode] = useState('classic_chase');
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);
  const [areaName, setAreaName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdGame, setCreatedGame] = useState<ScheduledGame | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

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
        // If hour has already passed today, set to tomorrow
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
      setErrorMessage(result.error || 'Failed to schedule game');
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
    if (onGameCreated) onGameCreated(result.gameId);
  }

  async function handleExportCalendar() {
    if (!createdGame) return;
    triggerHaptic('buttonTap');
    await shareScheduledGameCalendar(createdGame);
  }

  function handleResetAndClose() {
    setTitle('');
    setAreaName('');
    setNotes('');
    setCreatedGame(null);
    setErrorMessage('');
    onClose();
  }

  const targetDate = calculateTargetDate(selectedPresetIndex);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleResetAndClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={handleResetAndClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
          <View style={[styles.header, { borderBottomColor: colors.borderLight }]}>
            <View>
              <Text variant="title" style={styles.title}>
                Schedule Operation
              </Text>
              <Text variant="caption" style={{ color: colors.textSecondary }}>
                Plan an upcoming match and notify squads
              </Text>
            </View>
            <Pressable
              onPress={handleResetAndClose}
              hitSlop={8}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceMuted }]}
            >
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={{ padding: spacing.md }}>
            {createdGame ? (
              <View style={styles.successContainer}>
                <Ionicons name="calendar-outline" size={48} color={colors.runner} />
                <Text variant="title" style={{ marginTop: spacing.sm, textAlign: 'center' }}>
                  Operation Scheduled
                </Text>
                <Text
                  variant="body"
                  style={{
                    color: colors.textSecondary,
                    textAlign: 'center',
                    marginTop: spacing.xs,
                  }}
                >
                  "{createdGame.title}" set for{' '}
                  {new Date(createdGame.scheduled_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>

                <View style={{ marginTop: spacing.lg, width: '100%', gap: spacing.sm }}>
                  <Button
                    title="Export / Share .ICS Calendar"
                    onPress={handleExportCalendar}
                    variant="primary"
                  />
                  <Button title="Done" onPress={handleResetAndClose} variant="ghost" />
                </View>
              </View>
            ) : (
              <>
                {/* Title */}
                <Text variant="label" style={{ marginBottom: spacing.xs }}>
                  Operation Title
                </Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="e.g. Friday Night Hunt"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    {
                      borderColor: colors.borderLight,
                      backgroundColor: colors.surfaceMuted,
                      color: colors.textPrimary,
                    },
                  ]}
                  maxLength={60}
                />

                {/* Mode Selector */}
                <Text variant="label" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
                  Tactical Mode
                </Text>
                <View style={styles.row}>
                  {MODES.map((mode) => (
                    <Pressable
                      key={mode.id}
                      onPress={() => setSelectedMode(mode.id)}
                      style={[
                        styles.chip,
                        {
                          borderColor:
                            selectedMode === mode.id ? colors.primary : colors.borderLight,
                          backgroundColor:
                            selectedMode === mode.id ? colors.primary : colors.surfaceMuted,
                        },
                      ]}
                    >
                      <Text
                        variant="caption"
                        style={{
                          fontWeight: '700',
                          color: selectedMode === mode.id ? '#000000' : colors.textPrimary,
                        }}
                      >
                        {mode.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Scheduled Time Preset */}
                <Text variant="label" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
                  Rendezvous Time
                </Text>
                <View style={styles.presetsGrid}>
                  {PRESET_TIMES.map((preset, idx) => (
                    <Pressable
                      key={preset.label}
                      onPress={() => setSelectedPresetIndex(idx)}
                      style={[
                        styles.presetChip,
                        {
                          borderColor:
                            selectedPresetIndex === idx
                              ? colors.primary
                              : colors.borderLight,
                          backgroundColor:
                            selectedPresetIndex === idx
                              ? colors.surfaceElevated
                              : colors.surfaceMuted,
                        },
                      ]}
                    >
                      <Text
                        variant="caption"
                        style={{
                          fontWeight: selectedPresetIndex === idx ? '700' : '400',
                          color:
                            selectedPresetIndex === idx
                              ? colors.primary
                              : colors.textSecondary,
                        }}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text
                  variant="caption"
                  style={{ color: colors.textSecondary, marginTop: spacing.xs }}
                >
                  Selected: {targetDate.toLocaleString()}
                </Text>

                {/* Rendezvous Area */}
                <Text variant="label" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
                  General Area Name (Privacy Protected)
                </Text>
                <TextInput
                  value={areaName}
                  onChangeText={setAreaName}
                  placeholder="e.g. Dolores Park North"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    {
                      borderColor: colors.borderLight,
                      backgroundColor: colors.surfaceMuted,
                      color: colors.textPrimary,
                    },
                  ]}
                  maxLength={100}
                />
                <Text
                  variant="caption"
                  style={{ color: colors.textSecondary, marginTop: 2, fontSize: 11 }}
                >
                  * Do not enter exact home addresses or coordinates.
                </Text>

                {/* Notes */}
                <Text variant="label" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
                  Briefing Notes (Optional)
                </Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Add gear or preparation notes..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  numberOfLines={2}
                  style={[
                    styles.textArea,
                    {
                      borderColor: colors.borderLight,
                      backgroundColor: colors.surfaceMuted,
                      color: colors.textPrimary,
                    },
                  ]}
                  maxLength={500}
                />

                {errorMessage ? (
                  <Text
                    variant="caption"
                    style={{ color: colors.hunter, marginTop: spacing.sm }}
                  >
                    {errorMessage}
                  </Text>
                ) : null}

                <View style={{ marginTop: spacing.lg }}>
                  <Button
                    title={submitting ? 'Scheduling...' : 'Confirm Operation'}
                    onPress={handleSchedule}
                    variant="primary"
                    disabled={submitting || title.trim().length < 3}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  sheet: {
    maxHeight: '90%',
    paddingBottom: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
  textArea: {
    height: 64,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
});
