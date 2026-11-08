import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ModeModule } from '../modes/types';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface RulesCardProps {
  module: ModeModule;
  showSections?: boolean;
  onAcknowledge?: () => void;
  acknowledged?: boolean;
  compact?: boolean;
}

export function RulesCard({
  module,
  showSections = true,
  onAcknowledge,
  acknowledged = false,
  compact = false,
}: RulesCardProps) {
  const { colors, spacing, radii } = useTheme();
  const [expanded, setExpanded] = useState(!compact);

  const difficultyStars = '★'.repeat(module.difficulty) + '☆'.repeat(3 - module.difficulty);

  const layerBg =
    module.layer === 'base'
      ? colors.primaryLight
      : colors.surfaceElevated;

  const layerColor =
    module.layer === 'base'
      ? colors.primary
      : module.layer === 'role'
        ? colors.ghostTrail
        : colors.warning;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderRadius: radii.card,
          borderColor: colors.border,
          padding: spacing.base,
          shadowColor: colors.backgroundDark,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.titleCol}>
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.layerBadge,
                {
                  backgroundColor: layerBg,
                },
              ]}
            >
              <Text color={layerColor} variant="label">
                {module.layer.toUpperCase()}
              </Text>
            </View>
            {module.complexity === 'high' && (
              <View style={[styles.complexityBadge, { backgroundColor: colors.dangerSurface }]}>
                <Text color={colors.danger} variant="label">
                  HIGH COMPLEXITY
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.name} variant="title">
            {module.name}
          </Text>
          <Text color={colors.textMuted} style={styles.tagline} variant="body">
            {module.tagline}
          </Text>
        </View>
      </View>

      {/* Meta Stats Row */}
      <View
        style={[
          styles.metaRow,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radii.sm,
            padding: spacing.sm,
            marginVertical: spacing.md,
          },
        ]}
      >
        <View style={styles.metaCol}>
          <Text variant="label">PLAYERS</Text>
          <Text style={styles.metaVal} variant="body" weight="bold">
            {module.idealPlayers}
          </Text>
        </View>
        <View style={[styles.metaDivider, { backgroundColor: colors.border }]} />
        <View style={styles.metaCol}>
          <Text variant="label">DIFFICULTY</Text>
          <Text color={colors.warning} style={styles.metaVal} variant="body" weight="bold">
            {difficultyStars}
          </Text>
        </View>
      </View>

      {/* Summary */}
      <View style={[styles.summaryBox, { borderColor: colors.borderLight }]}>
        <Text style={styles.summaryText} variant="body">
          {module.rules.summary}
        </Text>
      </View>

      {/* Expand / Collapse Toggle for Sections */}
      {showSections && module.rules.sections.length > 0 && (
        <>
          {compact && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded(!expanded)}
              style={styles.expandButton}
            >
              <Text color={colors.primary} variant="label">
                {expanded ? 'HIDE RULES DETAILS ▲' : 'VIEW FULL RULES ▼'}
              </Text>
            </Pressable>
          )}

          {expanded && (
            <View style={styles.sectionsContainer}>
              {module.rules.sections.map((section, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.sectionBlock,
                    { borderTopColor: colors.borderLight, paddingTop: spacing.sm },
                  ]}
                >
                  <Text style={styles.sectionTitle} variant="body" weight="bold">
                    {section.title}
                  </Text>
                  <Text color={colors.textMuted} style={styles.sectionBody} variant="body">
                    {section.body}
                  </Text>
                </View>
              ))}

              {/* Safety Notes */}
              {module.safetyNotes.length > 0 && (
                <View style={[styles.safetyBlock, { backgroundColor: colors.surfaceElevated }]}>
                  <Text color={colors.success} variant="label">
                    SAFETY INTEL
                  </Text>
                  {module.safetyNotes.map((note, idx) => (
                    <Text key={idx} color={colors.textMuted} style={styles.safetyItem} variant="body">
                      • {note}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}
        </>
      )}

      {/* Acknowledgement CTA */}
      {onAcknowledge && module.complexity === 'high' && (
        <Pressable
          accessibilityRole="checkbox"
          onPress={onAcknowledge}
          style={[
            styles.ackButton,
            {
              backgroundColor: acknowledged ? colors.success : colors.primaryLight,
              borderColor: acknowledged ? colors.successText : colors.primary,
            },
          ]}
        >
          <Text
            color={acknowledged ? colors.textLight : colors.primary}
            variant="label"
            weight="bold"
          >
            {acknowledged ? '✓ RULES ACKNOWLEDGED' : 'I UNDERSTAND THE RULES'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    elevation: 2,
    marginBottom: 14,
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  titleCol: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  layerBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  complexityBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  name: {
    marginTop: 2,
  },
  tagline: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  metaCol: {
    alignItems: 'center',
  },
  metaVal: {
    fontSize: 14,
    marginTop: 2,
  },
  metaDivider: {
    width: 1,
  },
  summaryBox: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 2,
  },
  summaryText: {
    fontSize: 14,
    lineHeight: 20,
  },
  expandButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  sectionsContainer: {
    marginTop: 10,
  },
  sectionBlock: {
    borderTopWidth: 1,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 14,
    marginBottom: 2,
  },
  sectionBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  safetyBlock: {
    borderRadius: 8,
    marginTop: 10,
    padding: 10,
  },
  safetyItem: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  ackButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 10,
  },
});
