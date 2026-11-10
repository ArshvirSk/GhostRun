import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const { colors, spacing, radii } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [showIncompatible, setShowIncompatible] = useState(false);

  const selectedMode = useHostStore((s) => s.mode);
  const selectedModifiers = useHostStore((s) => s.selectedModifiers);
  const selectedRoles = useHostStore((s) => s.selectedRoles);
  const toggleModifier = useHostStore((s) => s.toggleModifier);
  const toggleRole = useHostStore((s) => s.toggleRole);

  const modifiers = getAllModifiers();
  const roles = getAllRoles();
  const currentBase = getModeModule(selectedMode);

  const compatibleRoles = roles.filter((r) => r.compatibleWith.includes(selectedMode));
  const incompatibleRoles = roles.filter((r) => !r.compatibleWith.includes(selectedMode));

  const compatibleModifiers = modifiers.filter((m) => m.compatibleWith.includes(selectedMode));
  const incompatibleModifiers = modifiers.filter((m) => !m.compatibleWith.includes(selectedMode));

  const totalIncompatible = incompatibleRoles.length + incompatibleModifiers.length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View
        style={[
          styles.topBar,
          {
            paddingHorizontal: spacing.lg,
            paddingTop: Math.max(insets.top, 16) + 8,
          },
        ]}
      >
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

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
            paddingBottom: Math.max(insets.bottom, 16) + 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="display" style={{ color: colors.text, marginTop: spacing.sm }}>
          Roles & Modifiers
        </Text>
        <Text variant="body" style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
          Select tactical roles or environmental mutators for {currentBase?.name || 'this mode'}.
        </Text>

        {/* Tactical Roles Section */}
        {compatibleRoles.length > 0 && (
          <>
            <Text variant="label" style={{ color: colors.radarScan, letterSpacing: 1.5, marginBottom: spacing.sm }}>
              SECRET TACTICAL ROLES
            </Text>
            {compatibleRoles.map((r) => {
              const isSelected = selectedRoles.includes(r.id);

              return (
                <Card
                  key={r.id}
                  variant={isSelected ? 'elevated' : 'default'}
                  style={[
                    styles.itemCard,
                    {
                      borderColor: isSelected ? colors.radarScan : colors.border,
                      padding: spacing.md,
                      marginBottom: spacing.md,
                    },
                  ]}
                >
                  <Pressable
                    onPress={() => {
                      triggerHaptic('buttonTap');
                      toggleRole(r.id);
                    }}
                  >
                    <View style={styles.cardHeaderRow}>
                      <View style={{ flex: 1, marginRight: spacing.sm }}>
                        <Text variant="title" style={{ color: colors.text }}>
                          {r.name}
                        </Text>
                        <Text variant="label" style={{ color: colors.textMuted, fontSize: 11 }}>
                          {r.idealPlayers}
                        </Text>
                      </View>
                      <Ionicons
                        name={isSelected ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={isSelected ? colors.radarScan : colors.textMuted}
                      />
                    </View>

                    <Text variant="body" numberOfLines={2} style={{ color: colors.textMuted, marginTop: spacing.xs, fontSize: 13, lineHeight: 18 }}>
                      {r.tagline}
                    </Text>
                  </Pressable>
                </Card>
              );
            })}
          </>
        )}

        {/* Environmental Modifiers Section */}
        {compatibleModifiers.length > 0 && (
          <>
            <Text variant="label" style={{ color: colors.warning, letterSpacing: 1.5, marginTop: compatibleRoles.length > 0 ? spacing.md : 0, marginBottom: spacing.sm }}>
              ENVIRONMENTAL MODIFIERS
            </Text>
            {compatibleModifiers.map((m) => {
              const isSelected = selectedModifiers.includes(m.id);

              return (
                <Card
                  key={m.id}
                  variant={isSelected ? 'elevated' : 'default'}
                  style={[
                    styles.itemCard,
                    {
                      borderColor: isSelected ? colors.warning : colors.border,
                      padding: spacing.md,
                      marginBottom: spacing.md,
                    },
                  ]}
                >
                  <Pressable
                    onPress={() => {
                      triggerHaptic('buttonTap');
                      toggleModifier(m.id);
                    }}
                  >
                    <View style={styles.cardHeaderRow}>
                      <View style={{ flex: 1, marginRight: spacing.sm }}>
                        <Text variant="title" style={{ color: colors.text }}>
                          {m.name}
                        </Text>
                        <Text variant="label" style={{ color: colors.textMuted, fontSize: 11 }}>
                          {m.complexity === 'high' ? 'ADVANCED MECHANIC' : 'TACTICAL MUTATOR'}
                        </Text>
                      </View>
                      <Ionicons
                        name={isSelected ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={isSelected ? colors.warning : colors.textMuted}
                      />
                    </View>

                    <Text variant="body" numberOfLines={2} style={{ color: colors.textMuted, marginTop: spacing.xs, fontSize: 13, lineHeight: 18 }}>
                      {m.tagline}
                    </Text>
                  </Pressable>
                </Card>
              );
            })}
          </>
        )}

        {/* Incompatible Items Accordion */}
        {totalIncompatible > 0 && (
          <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                triggerHaptic('buttonTap');
                setShowIncompatible(!showIncompatible);
              }}
              style={[styles.incompatibleAccordionHeader, { backgroundColor: colors.surface, borderRadius: radii.md }]}
            >
              <Text variant="label" style={{ color: colors.textMuted }}>
                {showIncompatible ? '▼ HIDE' : '▶ VIEW'} INCOMPATIBLE WITH {currentBase?.name?.toUpperCase() || 'THIS MODE'} ({totalIncompatible})
              </Text>
            </Pressable>

            {showIncompatible && (
              <View style={{ marginTop: spacing.xs }}>
                {[...incompatibleRoles, ...incompatibleModifiers].map((item) => {
                  const allowedModes = item.compatibleWith
                    .map((id) => getModeModule(id)?.name || id)
                    .join(', ');

                  return (
                    <Card
                      key={item.id}
                      variant="default"
                      style={[
                        styles.incompatibleCard,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.borderDark,
                          marginBottom: spacing.xs,
                          padding: spacing.sm,
                        },
                      ]}
                    >
                      <View style={styles.incompatibleRow}>
                        <View style={{ flex: 1 }}>
                          <Text variant="title" style={{ color: colors.textMuted, fontSize: 13 }}>
                            {item.name}
                          </Text>
                          <Text variant="caption" style={{ color: colors.textSubtle, marginTop: 2 }}>
                            Available in: {allowedModes}
                          </Text>
                        </View>
                        <Chip label="OTHER MODES" variant="default" size="sm" />
                      </View>
                    </Card>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Bottom Sticky Action Dock */}
      <View
        style={[
          styles.bottomDock,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
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
    paddingBottom: 120,
  },
  itemCard: {
    borderWidth: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  incompatibleAccordionHeader: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  incompatibleCard: {
    borderWidth: 1,
    opacity: 0.65,
  },
  incompatibleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    zIndex: 10,
    elevation: 8,
  },
});
