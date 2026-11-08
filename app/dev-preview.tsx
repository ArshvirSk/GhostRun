import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getShippingRegistry } from '../src/modes/registry';
import { ModeModule } from '../src/modes/types';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { ParamField } from '../src/ui/ParamField';
import { RulesCard } from '../src/ui/RulesCard';
import { Text } from '../src/ui/Text';

export default function DevPreviewScreen() {
  return (
    <ThemeProvider>
      <DevPreviewContent />
    </ThemeProvider>
  );
}

function DevPreviewContent() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const registry = getShippingRegistry();

  const allModules: ModeModule[] = [
    ...registry.modes,
    ...registry.modifiers,
    ...registry.roles,
  ];

  const [selectedId, setSelectedId] = useState<string>(registry.modes[0]?.id || 'classic_chase');
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const [acknowledged, setAcknowledged] = useState(false);

  const activeModule = allModules.find((m) => m.id === selectedId) || allModules[0];

  const handleParamChange = (key: string, val: unknown) => {
    setParamValues((prev) => ({ ...prev, [key]: val }));
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.screen,
        { backgroundColor: colors.background, padding: spacing.base },
      ]}
    >
      {/* Top Navigation */}
      <View style={styles.topRow}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons color={colors.primary} name="chevron-back" size={20} />
          <Text color={colors.primary} variant="body" weight="bold">
            Back
          </Text>
        </Pressable>
        <View style={[styles.devBadge, { backgroundColor: '#FEF3C7' }]}>
          <Text color="#B45309" variant="label">
            DEV HARNESS
          </Text>
        </View>
      </View>

      <Text style={styles.headerTitle} variant="display">
        Registry Preview
      </Text>
      <Text color={colors.textMuted} style={styles.headerSubtitle} variant="body">
        Visual verification for RulesCard and ParamField primitives.
      </Text>

      {/* Module Horizontal Selector Bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pickerScroll}
      >
        {allModules.map((m) => {
          const isSelected = m.id === selectedId;
          return (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              onPress={() => {
                setSelectedId(m.id);
                setParamValues({});
                setAcknowledged(false);
              }}
              style={[
                styles.moduleChip,
                {
                  backgroundColor: isSelected ? colors.primary : colors.surface,
                  borderColor: isSelected ? colors.primaryHover : colors.border,
                  borderRadius: radii.pill,
                },
              ]}
            >
              <Text
                color={isSelected ? '#FFFFFF' : colors.text}
                variant="label"
                weight={isSelected ? 'bold' : 'normal'}
              >
                {m.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* RulesCard Component Display */}
      {activeModule && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader} variant="title">
            RulesCard Component
          </Text>
          <RulesCard
            acknowledged={acknowledged}
            module={activeModule}
            onAcknowledge={() => setAcknowledged(!acknowledged)}
            showSections={true}
          />
        </View>
      )}

      {/* ParamField Controls Generator */}
      {activeModule && activeModule.params.length > 0 && (
        <View
          style={[
            styles.section,
            styles.cardContainer,
            {
              backgroundColor: colors.surface,
              borderRadius: radii.card,
              borderColor: colors.border,
              padding: spacing.base,
            },
          ]}
        >
          <Text style={styles.sectionHeader} variant="title">
            ParamField Controls ({activeModule.params.length})
          </Text>
          {activeModule.params.map((p) => (
            <ParamField
              key={p.key}
              onChange={handleParamChange}
              param={p}
              value={paramValues[p.key] !== undefined ? paramValues[p.key] : p.defaultValue}
            />
          ))}

          {/* Live Parameter State JSON */}
          <View style={[styles.jsonPreview, { backgroundColor: colors.surfaceMuted }]}>
            <Text variant="label">DRAFT PARAMETER PAYLOAD</Text>
            <Text style={styles.jsonText} variant="mono">
              {JSON.stringify(paramValues, null, 2)}
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingBottom: 60,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  backButton: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  devBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  headerTitle: {
    marginTop: 12,
  },
  headerSubtitle: {
    fontSize: 14,
    marginBottom: 14,
    marginTop: 4,
  },
  pickerScroll: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  moduleChip: {
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 18,
    marginBottom: 10,
  },
  cardContainer: {
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  jsonPreview: {
    borderRadius: 8,
    marginTop: 14,
    padding: 10,
  },
  jsonText: {
    fontSize: 12,
    marginTop: 4,
  },
});
