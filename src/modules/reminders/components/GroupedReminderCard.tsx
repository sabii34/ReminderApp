
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@src/components/Icon';
import { Text } from '@src/components/Text';
import { Colors } from '@src/constants/colors';
import { Radius, Spacing } from '@src/constants/layout';
import { Shadows } from '@src/constants/shadows';
import { formatRelativeDateTime } from '@src/helpers/date';
import { Reminder } from '@src/modules/reminders/types';
import { NextReminderCard } from './NextReminderCard';

interface Props {
  reminders: Reminder[];
  onReminderPress: (reminder: Reminder) => void;
  onDetailsPress: (reminder: Reminder) => void;
}

/** Grouped reminders for one shared saved location. */
export const GroupedReminderCard = ({
  reminders,
  onReminderPress,
  onDetailsPress,
}: Props) => {
  const [expanded, setExpanded] = useState(false);

  const first = reminders[0];

  if (!first) return null;

  return (
    <View style={styles.container}>
      {/* Header: tap to expand or collapse */}
      <Pressable
        onPress={() => setExpanded(previous => !previous)}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? 'Collapse reminders' : 'Expand reminders'
        }
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          styles.header,
          pressed && styles.headerPressed,
        ]}
    >
        <View style={styles.groupIcon}>
          <Icon
            name="layers-outline"
            size={22}
            color="primary"
          />
        </View>

        <View style={styles.heading}>
          <Text weight="bold">
            {reminders.length} Reminders at {first.title}
          </Text>

          <Text size="caption" color="subtext">
            {Math.round(first.radius)} m geofence • Active area
          </Text>
        </View>

        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color="primary"
        />
      </Pressable>

      {/* Reminder list: visible only when expanded */}
      {expanded && (
        <>
          <NextReminderCard
            reminder={first}
            onPress={() => onReminderPress(first)}
            onDetailsPress={() => onDetailsPress(first)}
          />

          {reminders.slice(1).map(reminder => (
            <Pressable
              key={reminder.id}
              onPress={() => onReminderPress(reminder)}
              accessibilityRole="button"
              accessibilityLabel={`View ${reminder.title}`}
              style={({ pressed }) => [
                styles.compact,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.iconBox}>
                <Icon
                  name="notifications-outline"
                  size={20}
                  color="primary"
                />
              </View>

              <View style={styles.compactText}>
                <Text weight="bold" numberOfLines={1}>
                  {reminder.title}
                </Text>

                <View style={styles.time}>
                  <Icon
                    name="time-outline"
                    size={13}
                    color="primary"
                  />

                  <Text size="caption" color="subtext">
                    {formatRelativeDateTime(
                      new Date(reminder.remindAt),
                    )}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={() => onDetailsPress(reminder)}
                accessibilityRole="button"
                accessibilityLabel={`View details for ${reminder.title}`}
                style={({ pressed }) => [
                  styles.viewButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  size="caption"
                  weight="semiBold"
                  color="white"
                >
                  View
                </Text>

                <Icon
                  name="arrow-forward"
                  size={13}
                  color="white"
                />
              </Pressable>
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: Spacing.md,
    gap: Spacing.xs,
    borderRadius: Radius.xl,
    backgroundColor: Colors.cardBg,
    ...Shadows.raised,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.xs,
  },

  headerPressed: {
    opacity: 0.8,
  },

  groupIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  heading: {
    flex: 1,
    gap: 2,
  },

  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.cardBg,
    ...Shadows.raised,
  },

  iconBox: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  compactText: {
    flex: 1,
    gap: 2,
  },

  time: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },

  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
  },

  pressed: {
    opacity: 0.8,
  },
});
