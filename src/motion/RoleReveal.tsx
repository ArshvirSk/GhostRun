import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Animated, Modal } from 'react-native';
import { colors, spacing, motion, radii } from '../theme/tokens';
import { Text } from '../ui/Text';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { useReducedMotion } from './reduced-motion';
import { triggerHaptic } from './haptics';

export interface RoleRevealProps {
  visible: boolean;
  role: 'runner' | 'hunter' | 'operator' | 'vip' | 'bodyguard' | 'double_agent' | 'spectator';
  roleTitle: string;
  codename?: string;
  briefing: string;
  intelRules?: string[];
  complexity?: 'low' | 'high';
  onAcknowledge: () => void;
}

export function RoleReveal({
  visible,
  role,
  roleTitle,
  codename,
  briefing,
  intelRules = [],
  complexity = 'low',
  onAcknowledge,
}: RoleRevealProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<'scanning' | 'revealed'>('scanning');

  const [scanScale] = useState(() => new Animated.Value(0.2));
  const [scanOpacity] = useState(() => new Animated.Value(1));
  const [cardOpacity] = useState(() => new Animated.Value(0));
  const [cardTranslateY] = useState(() => new Animated.Value(40));

  useEffect(() => {
    if (!visible) {
      const timer = setTimeout(() => {
        setPhase('scanning');
      }, 0);
      scanScale.setValue(0.2);
      scanOpacity.setValue(1);
      cardOpacity.setValue(0);
      cardTranslateY.setValue(40);
      return () => clearTimeout(timer);
    }

    triggerHaptic('roleReveal');

    if (reducedMotion) {
      const timer = setTimeout(() => {
        setPhase('revealed');
      }, 0);
      cardOpacity.setValue(1);
      cardTranslateY.setValue(0);
      return () => clearTimeout(timer);
    }

    // Sequence: Sonar scan -> Reveal card
    Animated.parallel([
      Animated.timing(scanScale, {
        toValue: 2.5,
        duration: motion.reveal,
        useNativeDriver: true,
      }),
      Animated.timing(scanOpacity, {
        toValue: 0,
        duration: motion.reveal,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setPhase('revealed');
      Animated.parallel([
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: motion.transition,
          useNativeDriver: true,
        }),
        Animated.timing(cardTranslateY, {
          toValue: 0,
          duration: motion.transition,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [visible, reducedMotion, scanScale, scanOpacity, cardOpacity, cardTranslateY]);

  const isHunter = role === 'hunter';
  const roleColor = isHunter ? colors.hunter : colors.runner;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onAcknowledge}>
      <View style={styles.backdrop}>
        {/* Sonar Scan Wave */}
        {phase === 'scanning' && !reducedMotion && (
          <View style={styles.sonarContainer} pointerEvents="none">
            <Animated.View
              style={[
                styles.sonarRing,
                {
                  borderColor: roleColor,
                  transform: [{ scale: scanScale }],
                  opacity: scanOpacity,
                },
              ]}
            />
            <Text variant="mono" color={colors.textMuted} style={styles.scanningText}>
              DECRYPTING ASSIGNMENT...
            </Text>
          </View>
        )}

        {/* Revealed Role Card */}
        {phase === 'revealed' && (
          <Animated.View
            style={[
              styles.cardWrapper,
              {
                opacity: cardOpacity,
                transform: [{ translateY: cardTranslateY }],
              },
            ]}
          >
            <Card variant="elevated" style={styles.card}>
              <View style={styles.header}>
                <View style={styles.badges}>
                  <Chip
                    label={role.toUpperCase()}
                    variant={isHunter ? 'hunter' : 'accent'}
                    size="sm"
                  />
                  {complexity === 'high' && (
                    <Chip label="COMPLEX ROLE" variant="warning" size="sm" />
                  )}
                </View>
                <Text variant="label" color={colors.textMuted}>
                  {codename ? `AGENT: ${codename.toUpperCase()}` : 'CONFIDENTIAL DOSSIER'}
                </Text>
              </View>

              <View style={styles.body}>
                <Text variant="hero" color={roleColor} style={styles.roleTitle}>
                  {roleTitle}
                </Text>
                <Text variant="body" color={colors.text} style={styles.briefing}>
                  {briefing}
                </Text>

                {intelRules.length > 0 && (
                  <View style={styles.rulesContainer}>
                    <Text variant="label" color={colors.textMuted} style={styles.rulesTitle}>
                      TACTICAL DIRECTIVES:
                    </Text>
                    {intelRules.map((rule, idx) => (
                      <View key={idx} style={styles.ruleItem}>
                        <View style={[styles.bullet, { backgroundColor: roleColor }]} />
                        <Text variant="sub" color={colors.text} style={styles.ruleText}>
                          {rule}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.footer}>
                <Button
                  title="ACKNOWLEDGE ORDERS"
                  variant={isHunter ? 'hunter' : 'primary'}
                  size="lg"
                  onPress={onAcknowledge}
                />
              </View>
            </Card>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 9, 0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.base,
  },
  sonarContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  sonarRing: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 3,
  },
  scanningText: {
    marginTop: spacing.xl,
    letterSpacing: 2,
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 420,
  },
  card: {
    borderRadius: radii.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    marginBottom: spacing.base,
  },
  badges: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  body: {
    marginBottom: spacing.lg,
  },
  roleTitle: {
    marginBottom: spacing.xs,
  },
  briefing: {
    marginBottom: spacing.base,
    lineHeight: 22,
  },
  rulesContainer: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radii.md,
    gap: spacing.xs,
  },
  rulesTitle: {
    marginBottom: spacing.xs,
    letterSpacing: 1,
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ruleText: {
    flex: 1,
  },
  footer: {
    marginTop: spacing.xs,
  },
});
