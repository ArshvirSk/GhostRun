import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { ParamField } from '../../src/ui/ParamField';
import { getModeModule } from '../../src/modes/registry';
import { useHostStore, PresetType } from '../../src/stores/hostStore';
import { triggerHaptic } from '../../src/motion/haptics';

export default function HostRulesScreen() {
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();

  const modeId = useHostStore((s) => s.mode);
  const preset = useHostStore((s) => s.preset);
  const rules = useHostStore((s) => s.rules);
  const modeParams = useHostStore((s) => s.modeParams);
  const applyPreset = useHostStore((s) => s.applyPreset);
  const setRule = useHostStore((s) => s.setRule);
  const setModeParam = useHostStore((s) => s.setModeParam);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const modeModule = getModeModule(modeId);

  const isGhostDuel = modeId === 'ghost_duel';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View style={[styles.topBar, { paddingHorizontal: spacing.lg, paddingTop: spacing.xl }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Mode Selection"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textMuted} />
        </Pressable>
        <View style={styles.stepIndicator}>
          <Text variant="label" style={{ color: colors.accent }}>
            STEP 2 OF 5
          </Text>
          <Text variant="label" style={{ color: colors.textMuted }}>
            RULES & PRESETS
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { padding: spacing.lg }]}>
        <Text variant="display" style={{ color: colors.text, marginTop: spacing.sm }}>
          Configure Rules
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
          Select a balance preset or tailor individual tactical timing parameters.
        </Text>

        {/* Presets Selector */}
        <Card variant="default" style={{ padding: spacing.md, marginBottom: spacing.lg }}>
          <Text variant="label" style={{ color: colors.textMuted, marginBottom: spacing.sm }}>
            DIFFICULTY & PACE PRESETS
          </Text>
          <View style={styles.presetsRow}>
            {(['casual', 'standard', 'hardcore'] as PresetType[]).map((pKey) => {
              const isSelected = preset === pKey;
              return (
                <Chip
                  key={pKey}
                  label={pKey.toUpperCase()}
                  selected={isSelected}
                  variant={isSelected ? 'accent' : 'default'}
                  onPress={() => {
                    triggerHaptic('buttonTap');
                    applyPreset(pKey);
                  }}
                  style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
                />
              );
            })}
          </View>
          <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.sm, fontSize: 13 }}>
            {preset === 'casual' && 'Generous head start (4 min), longer round (60 min), and frequent 90s radar pings.'}
            {preset === 'standard' && 'Balanced competitive defaults: 3 min head start, 45 min round, 150s ping interval.'}
            {preset === 'hardcore' && 'High pressure: 90s head start, 30 min duration, delayed 240s pings, extra ping penalty.'}
            {preset === 'custom' && 'Customized timing and boundary configuration applied.'}
          </Text>
        </Card>

        {/* Mode-Specific Parameters (From Registry) */}
        {modeModule && modeModule.params.length > 0 && (
          <Card variant="default" style={{ padding: spacing.md, marginBottom: spacing.lg }}>
            <Text variant="label" style={{ color: colors.accent, marginBottom: spacing.sm }}>
              {modeModule.name.toUpperCase()} PARAMETERS
            </Text>
            {modeModule.params.map((p) => {
              const currentValue = modeParams[modeId]?.[p.key] !== undefined
                ? modeParams[modeId][p.key]
                : p.defaultValue;
              return (
                <ParamField
                  key={p.key}
                  param={p}
                  value={currentValue}
                  onChange={(key, val) => {
                    setModeParam(modeId, key, val);
                  }}
                />
              );
            })}
          </Card>
        )}

        {/* Advanced Accordion Toggle */}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            triggerHaptic('buttonTap');
            setAdvancedOpen(!advancedOpen);
          }}
          style={[styles.accordionHeader, { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md }]}
        >
          <View style={styles.accordionTitleRow}>
            <Ionicons name="options-outline" size={18} color={colors.accent} />
            <Text variant="title" style={{ color: colors.text, fontSize: 16 }}>
              Advanced Timing & Boundaries
            </Text>
          </View>
          <Ionicons
            name={advancedOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textMuted}
          />
        </Pressable>

        {/* Advanced Parameter Fields */}
        {advancedOpen && (
          <Card variant="elevated" style={{ marginTop: spacing.xs, padding: spacing.md, marginBottom: spacing.lg }}>
            {/* Head Start */}
            {!isGhostDuel && (
              <View style={styles.paramRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                    Head Start (seconds)
                  </Text>
                  <Text variant="body" style={{ color: colors.textMuted, fontSize: 12 }}>
                    Safe head start for runners before hunters move
                  </Text>
                </View>
                <View style={styles.stepperRow}>
                  <Pressable
                    onPress={() => setRule('headStartS', Math.max(0, rules.headStartS - 30))}
                    style={[styles.stepBtn, { backgroundColor: colors.surface }]}
                  >
                    <Text variant="title" style={{ color: colors.text }}>-</Text>
                  </Pressable>
                  <Text variant="mono" style={{ color: colors.accent, width: 50, textAlign: 'center' }}>
                    {rules.headStartS}s
                  </Text>
                  <Pressable
                    onPress={() => setRule('headStartS', Math.min(600, rules.headStartS + 30))}
                    style={[styles.stepBtn, { backgroundColor: colors.surface }]}
                  >
                    <Text variant="title" style={{ color: colors.text }}>+</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Round Duration */}
            <View style={styles.paramRow}>
              <View style={{ flex: 1 }}>
                <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                  Round Length
                </Text>
                <Text variant="body" style={{ color: colors.textMuted, fontSize: 12 }}>
                  Total match time limit
                </Text>
              </View>
              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => setRule('durationS', Math.max(300, rules.durationS - 300))}
                  style={[styles.stepBtn, { backgroundColor: colors.surface }]}
                >
                  <Text variant="title" style={{ color: colors.text }}>-</Text>
                </Pressable>
                <Text variant="mono" style={{ color: colors.accent, width: 60, textAlign: 'center' }}>
                  {Math.round(rules.durationS / 60)} min
                </Text>
                <Pressable
                  onPress={() => setRule('durationS', Math.min(14400, rules.durationS + 300))}
                  style={[styles.stepBtn, { backgroundColor: colors.surface }]}
                >
                  <Text variant="title" style={{ color: colors.text }}>+</Text>
                </Pressable>
              </View>
            </View>

            {/* Ping Interval */}
            <View style={styles.paramRow}>
              <View style={{ flex: 1 }}>
                <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                  Radar Ping Cadence
                </Text>
                <Text variant="body" style={{ color: colors.textMuted, fontSize: 12 }}>
                  Seconds between delayed position releases
                </Text>
              </View>
              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => setRule('pingIntervalS', Math.max(30, rules.pingIntervalS - 30))}
                  style={[styles.stepBtn, { backgroundColor: colors.surface }]}
                >
                  <Text variant="title" style={{ color: colors.text }}>-</Text>
                </Pressable>
                <Text variant="mono" style={{ color: colors.radarScan, width: 50, textAlign: 'center' }}>
                  {rules.pingIntervalS}s
                </Text>
                <Pressable
                  onPress={() => setRule('pingIntervalS', Math.min(900, rules.pingIntervalS + 30))}
                  style={[styles.stepBtn, { backgroundColor: colors.surface }]}
                >
                  <Text variant="title" style={{ color: colors.text }}>+</Text>
                </Pressable>
              </View>
            </View>

            {/* Tag Radius */}
            <View style={styles.paramRow}>
              <View style={{ flex: 1 }}>
                <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                  Physical Tag Radius
                </Text>
                <Text variant="body" style={{ color: colors.textMuted, fontSize: 12 }}>
                  GPS proximity threshold required to tag
                </Text>
              </View>
              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => setRule('tagRadiusM', Math.max(5, rules.tagRadiusM - 5))}
                  style={[styles.stepBtn, { backgroundColor: colors.surface }]}
                >
                  <Text variant="title" style={{ color: colors.text }}>-</Text>
                </Pressable>
                <Text variant="mono" style={{ color: colors.warning, width: 50, textAlign: 'center' }}>
                  {rules.tagRadiusM}m
                </Text>
                <Pressable
                  onPress={() => setRule('tagRadiusM', Math.min(100, rules.tagRadiusM + 5))}
                  style={[styles.stepBtn, { backgroundColor: colors.surface }]}
                >
                  <Text variant="title" style={{ color: colors.text }}>+</Text>
                </Pressable>
              </View>
            </View>

            {/* Boundary Penalty Toggle */}
            <View style={styles.paramRow}>
              <View style={{ flex: 1 }}>
                <Text variant="title" style={{ color: colors.text, fontSize: 14 }}>
                  Excursion Penalty
                </Text>
                <Text variant="body" style={{ color: colors.textMuted, fontSize: 12 }}>
                  {rules.boundaryPenalty === 'extra_ping'
                    ? 'Releases immediate radar ping to hunters when boundary is breached'
                    : 'Advisory warning only'}
                </Text>
              </View>
              <Switch
                value={rules.boundaryPenalty === 'extra_ping'}
                onValueChange={(val) => setRule('boundaryPenalty', val ? 'extra_ping' : 'warn')}
                thumbColor={colors.accent}
                trackColor={{ false: colors.surface, true: colors.surfaceElevated }}
              />
            </View>
          </Card>
        )}
      </ScrollView>

      {/* Bottom Sticky Action Dock */}
      <View
        style={[
          styles.bottomDock,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            padding: spacing.lg,
          },
        ]}
      >
        <Button
          title="Continue to Extras"
          variant="primary"
          size="lg"
          onPress={() => {
            triggerHaptic('buttonTap');
            router.push('/host/extras' as any);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
  },
  stepIndicator: {
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingBottom: 110,
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  accordionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  paramRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
  },
});
