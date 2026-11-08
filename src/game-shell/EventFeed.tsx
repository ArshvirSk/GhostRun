import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '../ui/Text';
import { useTheme } from '../theme/ThemeProvider';
import { colors } from '../theme/tokens';
import type { GameEvent } from './types';

interface EventFeedProps {
  events: GameEvent[];
  maxEvents?: number;
}

function getEventIcon(type: string): { icon: string; library: 'ionic' | 'material'; color: string } {
  switch (type) {
    case 'tag':
    case 'attempt_tag':
      return { icon: 'hand-left', library: 'ionic', color: colors.danger };
    case 'rescue_started':
    case 'player_released':
      return { icon: 'key', library: 'ionic', color: colors.success };
    case 'package_picked_up':
    case 'package_dropped':
    case 'package_secured':
      return { icon: 'briefcase', library: 'ionic', color: colors.warning };
    case 'operator_message':
      return { icon: 'radio', library: 'ionic', color: colors.radarScan };
    case 'game_master_event':
      return { icon: 'broadcast', library: 'material', color: colors.ghostTrail };
    case 'sos':
    case 'emergency_sos':
      return { icon: 'alert-circle', library: 'ionic', color: colors.danger };
    default:
      return { icon: 'information-circle', library: 'ionic', color: colors.textMuted };
  }
}

function formatEventText(event: GameEvent): string {
  const p = event.payload || {};
  switch (event.type) {
    case 'tag':
      return `${p.hunter_name || 'Hunter'} tagged ${p.runner_name || 'Runner'}`;
    case 'player_released':
      return `${p.rescuer_name || 'A player'} rescued prisoners from jail!`;
    case 'package_picked_up':
      return `${p.player_name || 'Runner'} retrieved the package`;
    case 'package_secured':
      return `Package secured by hunters!`;
    case 'operator_message':
      return `[OPERATOR] ${p.message || ''}`;
    case 'game_master_event':
      return `[HQ] ${p.narration || p.title || 'Directive issued'}`;
    case 'emergency_sos':
      return `EMERGENCY SOS: ${p.display_name || 'A player'} triggered an alert`;
    default:
      return p.message || p.title || event.type.replace(/_/g, ' ');
  }
}

export const EventFeed = memo(function EventFeed({
  events,
  maxEvents = 3,
}: EventFeedProps) {
  const { tokens } = useTheme();
  const visibleEvents = events.slice(0, maxEvents);

  if (visibleEvents.length === 0) return null;

  return (
    <View style={styles.container}>
      {visibleEvents.map((ev) => {
        const iconInfo = getEventIcon(ev.type);
        const text = formatEventText(ev);

        return (
          <View
            key={ev.id}
            style={[
              styles.item,
              {
                backgroundColor: tokens.colors.surface,
                borderColor: tokens.colors.border,
                borderRadius: tokens.radii.button,
              },
            ]}
          >
            {iconInfo.library === 'ionic' ? (
              <Ionicons color={iconInfo.color} name={iconInfo.icon as any} size={14} />
            ) : (
              <MaterialCommunityIcons
                color={iconInfo.color}
                name={iconInfo.icon as any}
                size={14}
              />
            )}
            <Text
              numberOfLines={2}
              variant="body"
              style={[styles.text, { color: tokens.colors.text }]}
            >
              {text}
            </Text>
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    shadowColor: colors.backgroundDark,
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  text: {
    fontSize: 11,
    flex: 1,
  },
});
