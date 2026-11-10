import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { getAllModifiers, getAllRoles, getModeModule } from '../../src/modes/registry';
import { useHostStore } from '../../src/stores/hostStore';
import { triggerHaptic } from '../../src/motion/haptics';

export default function HostExtrasScreen() {
  const { colors, spacing } = useTheme();
  const router = useRouter();

  const selectedMode = useHostStore((s) => s.mode);
  const selectedModifiers = useHostStore((s) => s.selectedModifiers);
  const selectedRoles = useHostStore((s) => s.selectedRoles);
  const toggleModifier = useHostStore((s) => s.toggleModifier);
  const toggleRole = useHostStore((s) => s.toggleRole);

  const modifiers = getAllModifiers();
  const roles = getAllRoles();
  const currentBase = getModeModule(selectedMode);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View style={[styles.topBar, { paddingHorizontal: spacing.lg, paddingTop: spacing.xl }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Rules"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textMuted} />
        </Pressable>
        <View style={styles.stepIndicator}>
          <Text variant="label" style={{ color: colors.accent }}>
            STEP 3 OF 5
          </Text>
          <Text variant="label" style={{ color: colors.textMuted }}>
            ROLES & MODIFIERS
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 120 }]}>
        <Text variant="display" style={{ color: colors.text, marginTop: spacing.sm }}>
          Roles & Modifiers
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
          Layer tactical specializations or field modifiers onto {currentBase?.name || 'this mode'}.
        </Text>

        {/* Tactical Roles Section */}
        <Text variant="label" style={{ color: colors.radarScan, letterSpacing: 1.5, marginBottom: spacing.sm }}>
          SECRET TACTICAL ROLES
        </Text>
        {roles.map((r) => {
          const isCompatible = r.compatibleWith.includes(selectedMode);
          const isSelected = selectedRoles.includes(r.id);

          return (
            <Card
              key={r.id}
              variant={isSelected ? 'elevated' : 'default'}
              style={[
                styles.itemCard,
                {
                  borderColor: isSelected ? colors.radarScan : colors.border,
                  opacity: isCompatible ? 1 : 0.45,
                  padding: spacing.md,
                  marginBottom: spacing.md,
                },
              ]}
            >
              <Pressable
                disabled={!isCompatible}
                onPress={() => {
                  triggerHaptic('buttonTap');
                  toggleRole(r.id);
                }}
              >
                <View style={styles.cardHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="title" style={{ color: colors.text }}>
                      {r.name}
                    </Text>
                    <Text variant="label" style={{ color: colors.textMuted }}>
                      {r.idealPlayers}
                    </Text>
                  </View>
                  {isCompatible ? (
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isSelected ? colors.radarScan : colors.textMuted}
                    />
                  ) : (
                    <Chip label="INCOMPATIBLE" variant="default" size="sm" />
                  )}
                </View>

                <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs }}>
                  {r.tagline}
                </Text>

                {!isCompatible && (
                  <Text variant="label" style={{ color: colors.danger, marginTop: spacing.xs }}>
                    Requires {r.compatibleWith.map((id) => getModeModule(id)?.name || id).join(' or ')}
                  </Text>
                )}
              </Pressable>
            </Card>
          );
        })}

        {/* Environmental Modifiers Section */}
        <Text variant="label" style={{ color: colors.warning, letterSpacing: 1.5, marginTop: spacing.md, marginBottom: spacing.sm }}>
          ENVIRONMENTAL MODIFIERS
        </Text>
        {modifiers.map((m) => {
          const isCompatible = m.compatibleWith.includes(selectedMode);
          const isSelected = selectedModifiers.includes(m.id);

          return (
            <Card
              key={m.id}
              variant={isSelected ? 'elevated' : 'default'}
              style={[
                styles.itemCard,
                {
                  borderColor: isSelected ? colors.warning : colors.border,
                  opacity: isCompatible ? 1 : 0.45,
                  padding: spacing.md,
                  marginBottom: spacing.md,
                },
              ]}
            >
              <Pressable
                disabled={!isCompatible}
                onPress={() => {
                  triggerHaptic('buttonTap');
                  toggleModifier(m.id);
                }}
              >
                <View style={styles.cardHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="title" style={{ color: colors.text }}>
                      {m.name}
                    </Text>
                    <Text variant="label" style={{ color: colors.textMuted }}>
                      {m.complexity === 'high' ? 'ADVANCED MECHANIC' : 'TACTICAL MODIFIER'}
                    </Text>
                  </View>
                  {isCompatible ? (
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isSelected ? colors.warning : colors.textMuted}
                    />
                  ) : (
                    <Chip label="INCOMPATIBLE" variant="default" size="sm" />
                  )}
                </View>

                <Text variant="body" style={{ color: colors.textMuted, marginTop: spacing.xs }}>
                  {m.tagline}
                </Text>

                {!isCompatible && (
                  <Text variant="label" style={{ color: colors.danger, marginTop: spacing.xs }}>
                    Requires {m.compatibleWith.map((id) => getModeModule(id)?.name || id).join(' or ')}
                  </Text>
                )}
              </Pressable>
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
          title="Continue to Area"
          variant="primary"
          size="lg"
          onPress={() => {
            triggerHaptic('buttonTap');
            router.push('/host/area' as any);
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
  itemCard: {
    borderWidth: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
  },
});
