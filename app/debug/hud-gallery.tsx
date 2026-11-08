import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../src/theme/tokens';
import {
  BriefingCard,
  Button,
  Card,
  Chip,
  CodeBoxes,
  RulesCard,
  SegmentBar,
  Sheet,
  Text,
  Toast,
} from '../../src/ui';
import {
  CountUp,
  GhostEcho,
  HeatWash,
  PingRipple,
  RadarSweep,
  RoleReveal,
  StaggerIn,
  isHapticsEnabled,
  setHapticsEnabled,
  setReducedMotionOverride,
  triggerHaptic,
  useReducedMotion,
} from '../../src/motion';
import { RunnerLayout } from '../../src/game-shell/layouts/RunnerLayout';
import { HunterLayout } from '../../src/game-shell/layouts/HunterLayout';
import { OperatorLayout } from '../../src/game-shell/layouts/OperatorLayout';
import { SpectatorLayout } from '../../src/game-shell/layouts/SpectatorLayout';
import { SprintLayout } from '../../src/game-shell/layouts/SprintLayout';
import { CORE_TOUR_SCRIPT, TourPlayer } from '../../src/tour';
import { getModeModule } from '../../src/modes/registry';
import type { RoundState, ShellActions } from '../../src/game-shell/types';

// Mock shell actions
const MOCK_ACTIONS: ShellActions = {
  refreshState: async () => {},
  attemptTag: async () => ({ ok: true }),
  leaveGame: async () => ({ ok: true }),
  sendSos: async () => ({ ok: true }),
  pauseGame: async () => ({ ok: true }),
  resumeGame: async () => ({ ok: true }),
  votePauseGame: async () => ({ ok: true }),
  startRescue: async () => ({ ok: true }),
  completeRescue: async () => ({ ok: true }),
  cancelRescue: async () => ({ ok: true }),
  tagGhost: async () => ({ ok: true }),
  requestRoleSwap: async () => ({ ok: true }),
  confirmRoleSwap: async () => ({ ok: true }),
  cancelRoleSwap: async () => ({ ok: true }),
  requestHandoff: async () => ({ ok: true }),
  confirmHandoff: async () => ({ ok: true }),
  pickupPackage: async () => ({ ok: true }),
  startSecuringPackage: async () => ({ ok: true }),
  completeSecurePackage: async () => ({ ok: true }),
  cancelSecuringPackage: async () => ({ ok: true }),
  placeMarker: async () => ({ ok: true }),
  clearMarker: async () => ({ ok: true }),
  operatorScan: async () => ({ ok: true }),
  sendOperatorMessage: async () => ({ ok: true }),
  heatPress: async () => ({ ok: true }),
  agentWhisper: async () => ({ ok: true }),
  agentScramble: async () => ({ ok: true }),
  conveneTribunal: async () => ({ ok: true }),
  castTribunalVote: async () => ({ ok: true }),
  claimDrop: async () => ({ ok: true }),
  useItem: async () => ({ ok: true }),
};

// Mock round state for layout visualizers
const MOCK_ROUND_STATE: RoundState = {
  game: {
    id: 'game-debug-01',
    code: 'G7XK',
    status: 'live',
    mode: 'classic_chase',
    mode_id: 'classic_chase',
    host_id: 'p1',
    head_start_s: 60,
    duration_s: 600,
    tag_radius_m: 20,
    target_radius_m: 25,
    live_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 540000).toISOString(),
    head_start_at: new Date(Date.now() - 110000).toISOString(),
    next_ping_at: new Date(Date.now() + 6000).toISOString(),
    ping_interval_s: 10,
    winner: null,
    end_reason: null,
    area: {
      latitude: 37.7749,
      longitude: -122.4194,
      radius_m: 500,
    },
    target_set: true,
  },
  server_time: new Date().toISOString(),
  my_player_id: 'p1',
  my_team: 'runner',
  my_position: {
    player_id: 'p1',
    latitude: 37.7749,
    longitude: -122.4194,
    accuracy_m: 5,
    recorded_at: new Date().toISOString(),
    is_mock: false,
  },
  players: [
    {
      id: 'p1',
      user_id: 'u1',
      display_name: 'Cipher',
      team: 'runner',
      status: 'active',
      is_ready: true,
      color: colors.runner,
    },
    {
      id: 'p2',
      user_id: 'u2',
      display_name: 'Apex',
      team: 'hunter',
      status: 'active',
      is_ready: true,
      color: colors.hunter,
    },
  ],
  positions: [],
  pings: [],
  target: { latitude: 37.7749, longitude: -122.4194 },
};

export default function HudGalleryScreen(): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [simulatedNow] = useState(1700000000000);
  const [hapticsOn, setHapticsOn] = useState(isHapticsEnabled());
  const [activeSegment, setActiveSegment] = useState('components');
  const [selectedRoleLayout, setSelectedRoleLayout] = useState<
    'runner' | 'hunter' | 'operator' | 'spectator' | 'sprint'
  >('runner');

  // Sheet & Toast & Modal Triggers
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [heatWashActive, setHeatWashActive] = useState<'hot' | 'cold' | null>(null);
  const [roleRevealVisible, setRoleRevealVisible] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [codeValue, setCodeValue] = useState('');
  const [codeBoxesError, setCodeBoxesError] = useState(false);

  const classicChaseModule = getModeModule('classic_chase');

  const handleReducedMotionToggle = (val: boolean) => {
    setReducedMotionOverride(val);
  };

  const handleHapticsToggle = (val: boolean) => {
    setHapticsEnabled(val);
    setHapticsOn(val);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Gallery Header */}
        <View style={styles.header}>
          <Chip label="DEV WORKBENCH" variant="accent" size="sm" />
          <Text variant="hero" color={colors.textLight} style={styles.headerTitle}>
            HUD GALLERY
          </Text>
          <Text variant="body" color={colors.textMuted}>
            Direction A &apos;Night Radar&apos; design system, motion language, role layouts, and tour preview.
          </Text>
        </View>

        {/* System Controls & Accessibility Status */}
        <Card variant="elevated" style={styles.sectionCard}>
          <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
            SYSTEM CONTROLS & ACCESSIBILITY
          </Text>

          <View style={styles.switchRow}>
            <View>
              <Text variant="body" weight="bold">
                Reduced Motion
              </Text>
              <Text variant="caption" color={colors.textMuted}>
                Replaces rapid animation with static states & subtle fades
              </Text>
            </View>
            <Switch
              value={reducedMotion}
              onValueChange={handleReducedMotionToggle}
              thumbColor={reducedMotion ? colors.primary : colors.textMuted}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
            />
          </View>

          <View style={[styles.switchRow, { borderTopWidth: 1, borderTopColor: colors.borderLight }]}>
            <View>
              <Text variant="body" weight="bold">
                Haptics Motor
              </Text>
              <Text variant="caption" color={colors.textMuted}>
                Tactile pulses on tags, pings, buttons, and thermal sense
              </Text>
            </View>
            <Switch
              value={hapticsOn}
              onValueChange={handleHapticsToggle}
              thumbColor={hapticsOn ? colors.primary : colors.textMuted}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
            />
          </View>

          {/* Sunlight Contrast Matrix */}
          <View style={styles.contrastMatrix}>
            <Text variant="label" color={colors.textMuted} style={{ marginBottom: 6 }}>
              SUNLIGHT CONTRAST AUDIT (WCAG 2.1)
            </Text>
            <View style={styles.contrastGrid}>
              <View style={styles.contrastItem}>
                <Text variant="mono" color={colors.primary}>16.5:1</Text>
                <Text variant="caption" color={colors.textMuted}>Text / Canvas (AAA)</Text>
              </View>
              <View style={styles.contrastItem}>
                <Text variant="mono" color={colors.primary}>14.1:1</Text>
                <Text variant="caption" color={colors.textMuted}>Runner Mint (AAA)</Text>
              </View>
              <View style={styles.contrastItem}>
                <Text variant="mono" color={colors.hunter}>6.2:1</Text>
                <Text variant="caption" color={colors.textMuted}>Hunter Amber (AA)</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Gallery Navigation Segments */}
        <SegmentBar
          items={[
            { id: 'components', label: 'UI PRIMITIVES' },
            { id: 'motion', label: 'MOTION' },
            { id: 'layouts', label: 'ROLE HUDS' },
            { id: 'tour', label: 'TOUR PLAYER' },
          ]}
          activeId={activeSegment}
          onChange={setActiveSegment}
        />

        {/* ----------------- SECTION 1: UI PRIMITIVES ----------------- */}
        {activeSegment === 'components' && (
          <View style={styles.sectionBlock}>
            {/* Typography */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                TYPOGRAPHY SCALE
              </Text>
              <Text variant="hero">Hero 36 Bold</Text>
              <Text variant="display">Display 32</Text>
              <Text variant="headline">Headline 24</Text>
              <Text variant="title">Title 20</Text>
              <Text variant="subtitle">Subtitle 17 Muted</Text>
              <Text variant="body">Body 15 Regular tactical copy line</Text>
              <Text variant="sub">Sub 13 Body caption</Text>
              <Text variant="caption">Caption 11 Tracking 0.5</Text>
              <Text variant="label">LABEL 11 MONOSPACE TRACKED</Text>
              <Text variant="mono">MONO 14 RADAR: 00:10</Text>
              <Text variant="numeric">NUMERIC 32 09:59</Text>
            </Card>

            {/* Buttons */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                BUTTON VARIANTS & SIZES
              </Text>
              <View style={styles.buttonCol}>
                <Button title="PRIMARY ACTION" variant="primary" size="lg" onPress={() => triggerHaptic('buttonTap')} />
                <Button title="HUNTER ACTION" variant="hunter" size="md" onPress={() => triggerHaptic('buttonTap')} />
                <Button title="SECONDARY ACTION" variant="secondary" size="md" onPress={() => triggerHaptic('buttonTap')} />
                <Button title="DANGER / SOS" variant="danger" size="md" onPress={() => triggerHaptic('error')} />
                <Button title="GHOST BUTTON" variant="ghost" size="sm" onPress={() => triggerHaptic('buttonTap')} />
                <Button title="LOADING STATE" variant="primary" size="md" loading />
                <Button title="DISABLED BUTTON" variant="primary" size="md" disabled />
              </View>
            </Card>

            {/* Chips */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                TACTICAL CHIPS & BADGES
              </Text>
              <View style={styles.chipRow}>
                <Chip label="RUNNER" variant="accent" />
                <Chip label="HUNTER" variant="hunter" />
                <Chip label="WARNING" variant="warning" />
                <Chip label="DANGER" variant="danger" />
                <Chip label="DEFAULT" variant="default" />
                <Chip label="SELECTED" variant="default" selected />
              </View>
            </Card>

            {/* CodeBoxes */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                4-CHAR ROOM CODE BOXES
              </Text>
              <CodeBoxes
                length={4}
                value={codeValue}
                onChange={setCodeValue}
                hasError={codeBoxesError}
                onComplete={(val) => {
                  setToastMessage(`Code entered: ${val}`);
                }}
              />
              <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
                <Button
                  title="TRIGGER ERROR SHAKE"
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    setCodeBoxesError(true);
                    triggerHaptic('error');
                    setTimeout(() => setCodeBoxesError(false), 800);
                  }}
                />
                <Button
                  title="CLEAR CODE"
                  variant="ghost"
                  size="sm"
                  onPress={() => setCodeValue('')}
                />
              </View>
            </Card>

            {/* Interactive Sheet & Toast Triggers */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                SHEET & TOAST OVERLAYS
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  title="OPEN BOTTOM SHEET"
                  variant="primary"
                  size="md"
                  onPress={() => setSheetOpen(true)}
                  style={{ flex: 1 }}
                />
                <Button
                  title="TRIGGER TOAST"
                  variant="secondary"
                  size="md"
                  onPress={() => setToastMessage('Radar ping snapshot acquired')}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>

            {/* BriefingCard */}
            <BriefingCard
              role="double_agent"
              roleTitle="Double Agent"
              codename="SPECTRE"
              complexity="high"
              briefing="Infiltrate the runner squad. Report their coordinates via scrambled radar while maintaining deep cover."
              intelDirectives={[
                'Runner appearance to allies on the tactical map.',
                'Displaced coordinates emitted during ping rounds.',
                'Tag immunity until exposed by scan envelope.',
              ]}
              acknowledged={false}
              onAcknowledge={() => setToastMessage('Orders acknowledged')}
            />

            {/* RulesCard */}
            {classicChaseModule && (
              <RulesCard
                module={classicChaseModule}
                compact
                showSections
              />
            )}
          </View>
        )}

        {/* ----------------- SECTION 2: MOTION ----------------- */}
        {activeSegment === 'motion' && (
          <View style={styles.sectionBlock}>
            {/* PingRipple */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                RADAR PING RIPPLE (EXPANDING ECHO RING)
              </Text>
              <View style={styles.motionDemoBox}>
                <PingRipple active size={140} color={colors.radarScan} />
              </View>
            </Card>

            {/* RadarSweep */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                RADAR SWEEP (AMBIENT ROTATIONAL SCAN)
              </Text>
              <View style={styles.motionDemoBox}>
                <RadarSweep size={160} color={colors.radarScan} />
              </View>
            </Card>

            {/* GhostEcho */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                GHOST ECHO (AFTERIMAGE TRAIL ON HEADLINES & MARKERS)
              </Text>
              <View style={styles.motionDemoBox}>
                <GhostEcho active color={colors.ghostTrail}>
                  <View style={styles.echoTarget}>
                    <Text variant="mono" color={colors.ghostTrail}>
                      CLASSIFIED TARGET
                    </Text>
                  </View>
                </GhostEcho>
              </View>
            </Card>

            {/* CountUp */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                ANIMATED COUNTUP
              </Text>
              <View style={styles.countUpRow}>
                <CountUp from={0} to={850} duration={800} variant="display" color={colors.primary} />
                <Text variant="label" color={colors.textMuted}>METERS DISPLACED</Text>
              </View>
            </Card>

            {/* HeatWash Triggers */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                THERMAL HEAT WASH (RED / BLUE SENSE CUES)
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  title="HOT HEAT WASH (RED)"
                  variant="hunter"
                  size="md"
                  onPress={() => setHeatWashActive('hot')}
                  style={{ flex: 1 }}
                />
                <Button
                  title="COLD HEAT WASH (BLUE)"
                  variant="secondary"
                  size="md"
                  onPress={() => setHeatWashActive('cold')}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>

            {/* RoleReveal Trigger */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                FULLSCREEN ROLE REVEAL TAKEOVER
              </Text>
              <Button
                title="LAUNCH SONAR ROLE REVEAL"
                variant="primary"
                size="lg"
                onPress={() => setRoleRevealVisible(true)}
              />
            </Card>

            {/* StaggerIn Demo */}
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                STAGGER IN ENTRANCE
              </Text>
              <StaggerIn staggerMs={80}>
                {[1, 2, 3].map((num) => (
                  <View key={num} style={styles.staggerItem}>
                    <Text variant="body" color={colors.text}>
                      Staggered Mission Feed Item #{num}
                    </Text>
                  </View>
                ))}
              </StaggerIn>
            </Card>
          </View>
        )}

        {/* ----------------- SECTION 3: ROLE LAYOUTS ----------------- */}
        {activeSegment === 'layouts' && (
          <View style={styles.sectionBlock}>
            <View style={styles.roleTabs}>
              {(['runner', 'hunter', 'operator', 'spectator', 'sprint'] as const).map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setSelectedRoleLayout(r)}
                  style={[
                    styles.roleTabButton,
                    selectedRoleLayout === r && styles.roleTabButtonActive,
                  ]}
                >
                  <Text
                    variant="label"
                    color={selectedRoleLayout === r ? colors.primary : colors.textMuted}
                  >
                    {r.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.layoutPreviewContainer}>
              {selectedRoleLayout === 'runner' && (
                <RunnerLayout
                  gameId="game-debug-01"
                  phase="live"
                  ownFix={{ latitude: 37.7749, longitude: -122.4194 }}
                  actions={MOCK_ACTIONS}
                  state={MOCK_ROUND_STATE}
                  serverNow={simulatedNow}
                  myRole="runner"
                  topWidgets={
                    <View style={styles.previewSlot}>
                      <Text variant="label" color={colors.runner}>[TOP SLOT: HUD FRAME & CLOCK]</Text>
                    </View>
                  }
                  bannerWidgets={
                    <View style={styles.previewSlot}>
                      <Text variant="label" color={colors.warning}>[BANNER SLOT: LIVE]</Text>
                    </View>
                  }
                  actionWidgets={[
                    <Button key="sos" title="SOS" variant="danger" size="sm" />,
                    <Button key="ping" title="RADAR" variant="primary" size="sm" />,
                  ]}
                  overlayWidgets={null}
                  sheetWidgets={null}
                />
              )}

              {selectedRoleLayout === 'hunter' && (
                <HunterLayout
                  gameId="game-debug-01"
                  phase="live"
                  ownFix={{ latitude: 37.7749, longitude: -122.4194 }}
                  actions={MOCK_ACTIONS}
                  state={MOCK_ROUND_STATE}
                  serverNow={simulatedNow}
                  myRole="hunter"
                  topWidgets={
                    <View style={styles.previewSlot}>
                      <Text variant="label" color={colors.hunter}>[TOP SLOT: HUNTER RADAR]</Text>
                    </View>
                  }
                  bannerWidgets={
                    <View style={styles.previewSlot}>
                      <Text variant="label" color={colors.warning}>[BANNER: TAG WINDOW ACTIVE]</Text>
                    </View>
                  }
                  actionWidgets={[
                    <Button key="tag" title="TAG RUNNER" variant="hunter" size="md" />,
                  ]}
                  overlayWidgets={null}
                  sheetWidgets={null}
                />
              )}

              {selectedRoleLayout === 'operator' && (
                <OperatorLayout
                  gameId="game-debug-01"
                  phase="live"
                  ownFix={{ latitude: 37.7749, longitude: -122.4194 }}
                  actions={MOCK_ACTIONS}
                  state={MOCK_ROUND_STATE}
                  serverNow={simulatedNow}
                  myRole="operator"
                  topWidgets={
                    <View style={styles.previewSlot}>
                      <Text variant="label" color={colors.radarScan}>[TOP SLOT: OPERATOR CONSOLE]</Text>
                    </View>
                  }
                  bannerWidgets={null}
                  actionWidgets={[
                    <Button key="scan" title="SCAN ENVELOPE" variant="secondary" size="sm" />,
                  ]}
                  overlayWidgets={null}
                  sheetWidgets={null}
                />
              )}

              {selectedRoleLayout === 'spectator' && (
                <SpectatorLayout
                  gameId="game-debug-01"
                  phase="live"
                  ownFix={{ latitude: 37.7749, longitude: -122.4194 }}
                  actions={MOCK_ACTIONS}
                  state={MOCK_ROUND_STATE}
                  serverNow={simulatedNow}
                  myRole="spectator"
                  topWidgets={
                    <View style={styles.previewSlot}>
                      <Text variant="label" color={colors.textMuted}>[TOP SLOT: OBSERVING]</Text>
                    </View>
                  }
                  bannerWidgets={null}
                  overlayWidgets={null}
                  sheetWidgets={null}
                />
              )}

              {selectedRoleLayout === 'sprint' && (
                <SprintLayout
                  gameId="game-debug-01"
                  phase="live"
                  ownFix={{ latitude: 37.7749, longitude: -122.4194 }}
                  actions={MOCK_ACTIONS}
                  state={MOCK_ROUND_STATE}
                  serverNow={simulatedNow}
                  myRole="runner"
                  onExitSprint={() => setSelectedRoleLayout('runner')}
                  onOpenSos={() => setToastMessage('SOS triggered in Sprint Mode')}
                />
              )}
            </View>
          </View>
        )}

        {/* ----------------- SECTION 4: TOUR PLAYER ----------------- */}
        {activeSegment === 'tour' && (
          <View style={styles.sectionBlock}>
            <Card variant="elevated" style={styles.sectionCard}>
              <Text variant="label" color={colors.primary} style={styles.sectionLabel}>
                CANONICAL 8-BEAT BRIEFING TOUR ENGINE
              </Text>
              <Text variant="body" color={colors.text} style={{ marginBottom: 12 }}>
                Runs completely offline, deterministically script-driven, with real HUD widgets and reduced motion support.
              </Text>
              <Button
                title="LAUNCH FULLSCREEN TOUR"
                variant="primary"
                size="lg"
                onPress={() => setTourOpen(true)}
              />
            </Card>

            {/* Embedded Tour Preview */}
            <View style={styles.embeddedTourBox}>
              <TourPlayer
                script={CORE_TOUR_SCRIPT}
                onFinish={() => setToastMessage('Tour finished!')}
                onSkip={() => setToastMessage('Tour skipped')}
              />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Modal Bottom Sheet */}
      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="MISSION SETTINGS"
        subtitle="Adjust tactical overlays and local parameters"
      >
        <Text variant="body" color={colors.text} style={{ marginBottom: 16 }}>
          Modal bottom sheet rendered on a native backdrop with grab handle and accessible touch targets.
        </Text>
        <Button
          title="CONFIRM & CLOSE"
          variant="primary"
          size="md"
          onPress={() => setSheetOpen(false)}
        />
      </Sheet>

      {/* Toast Notification */}
      {toastMessage && (
        <Toast
          title="TACTICAL NOTIFICATION"
          message={toastMessage}
          type="info"
          onDismiss={() => setToastMessage(null)}
        />
      )}

      {/* Heat Wash Effect Trigger */}
      {heatWashActive && (
        <HeatWash
          active
          type={heatWashActive}
          onComplete={() => setHeatWashActive(null)}
        />
      )}

      {/* Role Reveal Modal */}
      <RoleReveal
        visible={roleRevealVisible}
        role="operator"
        roleTitle="Tactical Operator"
        codename="GHOSTWATCH"
        briefing="You coordinate team movements remotely. Track all runner pings and execute electronic radar sweeps."
        intelRules={[
          'Remote spectator mode with active radar sweep privileges.',
          'Not physically present on the runner ground.',
          'Cooldown between successive radar envelopes is 45 seconds.',
        ]}
        complexity="high"
        onAcknowledge={() => setRoleRevealVisible(false)}
      />

      {/* Fullscreen Tour Player Modal */}
      {tourOpen && (
        <View style={StyleSheet.absoluteFill}>
          <TourPlayer
            script={CORE_TOUR_SCRIPT}
            onFinish={() => setTourOpen(false)}
            onSkip={() => setTourOpen(false)}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.base,
    gap: spacing.base,
  },
  header: {
    marginBottom: spacing.xs,
  },
  headerTitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  sectionBlock: {
    gap: spacing.base,
  },
  sectionCard: {
    padding: spacing.base,
    borderRadius: radii.card,
    gap: spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  contrastMatrix: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radii.md,
    marginTop: spacing.xs,
  },
  contrastGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  contrastItem: {
    alignItems: 'center',
  },
  buttonCol: {
    gap: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  motionDemoBox: {
    height: 180,
    backgroundColor: colors.surfaceDark,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  echoTarget: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.ghostTrail,
  },
  countUpRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  staggerItem: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  roleTabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    padding: spacing.xs,
    borderRadius: radii.pill,
  },
  roleTabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  roleTabButtonActive: {
    backgroundColor: colors.surfaceElevated,
  },
  layoutPreviewContainer: {
    height: 480,
    backgroundColor: colors.surfaceDark,
    borderRadius: radii.card,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewSlot: {
    backgroundColor: colors.surface,
    padding: spacing.sm,
    marginHorizontal: spacing.base,
    marginTop: spacing.base,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  embeddedTourBox: {
    height: 520,
    borderRadius: radii.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
