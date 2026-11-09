import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { RulesCard } from '../../src/ui/RulesCard';
import { getAllBaseModes, getModeModule } from '../../src/modes/registry';
import { useHostStore } from '../../src/stores/hostStore';
import { triggerHaptic } from '../../src/motion/haptics';

export default function HostModeScreen() {
  const { colors, spacing } = useTheme();
  const router = useRouter();

  const selectedMode = useHostStore((s) => s.mode);
  const setMode = useHostStore((s) => s.setMode);

  const baseModes = getAllBaseModes();
  const [inspectModeId, setInspectModeId] = useState<string | null>(null);

  const inspectingModule = inspectModeId ? getModeModule(inspectModeId) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View style={[styles.topBar, { paddingHorizontal: spacing.lg, paddingTop: spacing.xl }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel host setup"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
        <View style={styles.stepIndicator}>
          <Text variant="label" style={{ color: colors.accent }}>
            STEP 1 OF 5
          </Text>
          <Text variant="label" style={{ color: colors.textMuted }}>
            MODE SELECTION
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Main Mode Selection Scroll */}
      <ScrollView contentContainerStyle={[styles.content, { padding: spacing.lg }]}>
        <Text variant="display" style={{ color: colors.text, marginTop: spacing.sm }}>
          Choose Game Mode
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
          Select the tactical objective for this outdoor session.
        </Text>

        {baseModes.map((m) => {
          const isSelected = selectedMode === m.id;
          return (
            <Card
              key={m.id}
              variant={isSelected ? 'accent' : 'default'}
              style={{
                marginBottom: spacing.md,
                padding: spacing.md,
                borderColor: isSelected ? colors.accent : colors.border,
                borderWidth: isSelected ? 2 : 1,
              }}
              onPress={() => {
                triggerHaptic('buttonTap');
                setMode(m.id);
              }}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text variant="title" style={{ color: colors.text }}>
                    {m.name}
                  </Text>
                  <Text variant="label" style={{ color: colors.accent, marginTop: 2 }}>
                    {m.idealPlayers} • {m.complexity === 'high' ? 'COMPLEX' : 'STANDARD'}
                  </Text>
                </View>
                <Chip
                  label={isSelected ? 'SELECTED' : 'SELECT'}
                  variant={isSelected ? 'accent' : 'default'}
                  size="sm"
                />
              </View>

              <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.md }}>
                {m.tagline}
              </Text>

              <View style={styles.cardFooter}>
                <Button
                  title="View Rules Dossier"
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    triggerHaptic('buttonTap');
                    setInspectModeId(m.id);
                  }}
                />
              </View>
            </Card>
          );
        })}
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
          title="Continue to Rules"
          variant="primary"
          size="lg"
          onPress={() => {
            triggerHaptic('buttonTap');
            router.push('/host/rules' as any);
          }}
        />
      </View>

      {/* Full Rules Inspection Modal */}
      {inspectingModule && (
        <Modal
          animationType="slide"
          transparent={false}
          visible={true}
          onRequestClose={() => setInspectModeId(null)}
        >
          <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { padding: spacing.lg, borderBottomColor: colors.border }]}>
              <Text variant="title" style={{ color: colors.text }}>
                Tactical Rules Dossier
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setInspectModeId(null)}
                style={[styles.iconButton, { backgroundColor: colors.surface }]}
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
              <RulesCard module={inspectingModule} />
            </ScrollView>
          </View>
        </Modal>
      )}
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 8,
  },
  bottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingTop: 48,
  },
});
