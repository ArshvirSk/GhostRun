import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Chip } from '../../src/ui/Chip';
import { RulesCard } from '../../src/ui/RulesCard';
import { getAllBaseModes, getModeModule } from '../../src/modes/registry';
import { useHostStore, LAST_LOCATION_KEY } from '../../src/stores/hostStore';
import { triggerHaptic } from '../../src/motion/haptics';
import { startLocationPrewarm, getInstantLocation, updateCachedLocation } from '../../src/lib/locationCache';

export default function HostModeScreen() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const selectedMode = useHostStore((s) => s.mode);
  const setMode = useHostStore((s) => s.setMode);

  const baseModes = getAllBaseModes();
  const [inspectModeId, setInspectModeId] = useState<string | null>(null);

  const inspectingModule = inspectModeId ? getModeModule(inspectModeId) : null;

  // Background GPS pre-fetch as soon as host flow starts
  useEffect(() => {
    // 0. Use instant location if already warm
    const instant = getInstantLocation();
    if (instant) {
      useHostStore.getState().setCenter(instant, 'my_location');
    }

    // Start background prewarming watcher
    void startLocationPrewarm();

    async function prefetchGps() {
      try {
        // 1. Try local cache first for 0ms availability
        const stored = await AsyncStorage.getItem(LAST_LOCATION_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as [number, number];
          if (Array.isArray(parsed) && parsed.length === 2) {
            useHostStore.getState().setCenter(parsed, 'my_location');
            updateCachedLocation(parsed);
          }
        }

        // 2. Request permission if not already granted
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (perm.granted) {
          const last = await Location.getLastKnownPositionAsync({ maxAge: 86400000 });
          if (last?.coords?.longitude && last?.coords?.latitude) {
            const coords: [number, number] = [last.coords.longitude, last.coords.latitude];
            useHostStore.getState().setCenter(coords, 'my_location');
            updateCachedLocation(coords);
          }

          // 3. Refine with live GPS in background with 3.5s timeout
          Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
          ]).then((pos) => {
            if (pos?.coords) {
              const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
              useHostStore.getState().setCenter(coords, 'my_location');
              updateCachedLocation(coords);
            }
          }).catch(() => {});
        }
      } catch {
        // Non-blocking prefetch failure
      }
    }
    void prefetchGps();
  }, []);

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

      {/* Main Mode Selection Scroll with Generous Breathing Space */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: 170 + insets.bottom,
          },
        ]}
      >
        <Text variant="display" style={{ color: colors.text, marginTop: spacing.xs }}>
          Choose Game Mode
        </Text>
        <Text
          variant="body"
          style={{
            color: colors.textMuted,
            marginTop: 4,
            marginBottom: spacing.xl,
            lineHeight: 20,
          }}
        >
          Select the tactical objective for this outdoor session.
        </Text>

        {baseModes.map((m) => {
          const isSelected = selectedMode === m.id;
          return (
            <Card
              key={m.id}
              variant={isSelected ? 'accent' : 'default'}
              style={{
                marginBottom: spacing.lg,
                padding: spacing.lg,
                borderColor: isSelected ? colors.accent : colors.border,
                borderWidth: isSelected ? 2 : 1,
              }}
              onPress={() => {
                triggerHaptic('buttonTap');
                setMode(m.id);
              }}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1, marginRight: spacing.sm }}>
                  <Text variant="title" style={{ color: colors.text }}>
                    {m.name}
                  </Text>
                  <Text
                    variant="label"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    style={{
                      color: colors.accent,
                      marginTop: 4,
                      fontSize: 11,
                      letterSpacing: 0.5,
                    }}
                  >
                    {m.idealPlayers} • {m.complexity === 'high' ? 'COMPLEX' : 'STANDARD'}
                  </Text>
                </View>
                <Chip
                  label={isSelected ? 'SELECTED' : 'SELECT'}
                  variant={isSelected ? 'accent' : 'default'}
                  size="sm"
                />
              </View>

              <Text
                variant="body"
                style={{
                  color: colors.textMuted,
                  marginTop: spacing.md,
                  marginBottom: spacing.md,
                  lineHeight: 20,
                }}
              >
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
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
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
