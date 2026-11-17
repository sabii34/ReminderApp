
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type { Position } from 'geojson';

import { BottomSheet } from '@src/components/BottomSheet';
import { Button } from '@src/components/Button';
import { DateTimeField } from '@src/components/DateTimeField';
import { Icon } from '@src/components/Icon';
import { IconButton } from '@src/components/IconButton';
import { Text } from '@src/components/Text';
import { TextField } from '@src/components/TextField';
import { Colors } from '@src/constants/colors';
import { MAPBOX_ACCESS_TOKEN } from '@src/constants/config';
import { Radius, Spacing } from '@src/constants/layout';
import { nextFullHour, startOfDay } from '@src/helpers/date';
import { formatCoordinate } from '@src/helpers/geo';
import {
  LocationPicker,
  PickerValue,
  SearchLocationFocus,
} from '@src/modules/reminders/components/LocationPicker';
import { DEFAULT_GEOFENCE_RADIUS } from '@src/modules/reminders/constants';
import { Reminder, ReminderDraft } from '@src/modules/reminders/types';

export interface ReminderFormSheetProps {
  visible: boolean;
  reminder: Reminder | null;
  userCoordinate: Position | null;
  onSave: (draft: ReminderDraft) => Promise<boolean>;
  onDeletePress: (reminder: Reminder) => void;
  onClose: () => void;
}

interface SearchResult {
  id: string;
  name: string;
  address: string;
  coordinate: Position;
}

interface MapboxFeature {
  id?: string;
  geometry?: {
    coordinates?: number[];
  };
  properties?: {
    name?: string;
    name_preferred?: string;
    full_address?: string;
    place_formatted?: string;
  };
}

const TITLE_MAX_LENGTH = 60;
const NOTES_MAX_LENGTH = 200;

export const ReminderFormSheet = (
  props: ReminderFormSheetProps,
) => {
  const { visible, onClose } = props;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ReminderForm {...props} />
    </BottomSheet>
  );
};

const ReminderForm = (
  props: ReminderFormSheetProps,
) => {
  const {
    reminder,
    userCoordinate,
    onSave,
    onDeletePress,
    onClose,
  } = props;

  const isEditing = !!reminder;

  const [title, setTitle] = useState(
    reminder?.title ?? '',
  );

  const [description, setDescription] = useState(
    reminder?.description ?? '',
  );

  const [remindAt, setRemindAt] = useState(() =>
    reminder
      ? new Date(reminder.remindAt)
      : nextFullHour(),
  );

  const [location, setLocation] = useState<PickerValue>({
    coordinate: reminder?.coordinate ?? userCoordinate,
    radius: reminder?.radius ?? DEFAULT_GEOFENCE_RADIUS,
  });

  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<
    SearchResult[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchFocus, setSearchFocus] =
    useState<SearchLocationFocus | null>(null);

  const searchRequestId = useRef(0);
  const searchSelectionId = useRef(0);

  const [isAdjustingMap, setIsAdjustingMap] =
    useState(false);

  const [isSaving, setIsSaving] = useState(false);

  const trimmedTitle = title.trim();

  const canSave =
    !!trimmedTitle && !!location.coordinate;

  // Search Mapbox when the user stops typing.
  useEffect(() => {
    const query = searchText.trim();

    const requestId = ++searchRequestId.current;

    if (query.length < 3) {
      setSearchResults([]);
      setSearchError('');
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      if (!MAPBOX_ACCESS_TOKEN) {
        setSearchError(
          'Mapbox access token is missing.',
        );
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      setSearchError('');

      try {
        // Global search with nearby-result prioritization.
        const params = [
          `q=${encodeURIComponent(query)}`,
          `access_token=${encodeURIComponent(
            MAPBOX_ACCESS_TOKEN,
          )}`,
          'autocomplete=true',
          'limit=5',
          'language=en',
        ];

        // Prioritize locations near the user's current position.
        if (userCoordinate) {
          params.push(
            `proximity=${userCoordinate[0]},${userCoordinate[1]}`,
          );
        }

        const url =
          'https://api.mapbox.com/search/geocode/v6/forward?' +
          params.join('&');

        const response = await fetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Location search failed (${response.status})`,
          );
        }

        const data: {
          features?: MapboxFeature[];
        } = await response.json();

        if (requestId !== searchRequestId.current) {
          return;
        }

        const results: SearchResult[] = (
          data.features ?? []
        )
          .filter(feature => {
            const coordinates =
              feature.geometry?.coordinates;

            return (
              Array.isArray(coordinates) &&
              coordinates.length >= 2 &&
              Number.isFinite(coordinates[0]) &&
              Number.isFinite(coordinates[1])
            );
          })
          .map((feature, index) => {
            const properties = feature.properties ?? {};

            const coordinates =
              feature.geometry!.coordinates!;

            return {
              id: feature.id ?? String(index),

              name:
                properties.name_preferred ??
                properties.name ??
                'Unnamed location',

              address:
                properties.full_address ??
                properties.place_formatted ??
                '',

              coordinate: [
                coordinates[0],
                coordinates[1],
              ],
            };
          });

        setSearchResults(results);

        if (results.length === 0) {
          setSearchError(
            'No matching locations found.',
          );
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (requestId !== searchRequestId.current) {
          return;
        }

        setSearchResults([]);

        setSearchError(
          'Unable to search locations. Check your connection and Mapbox token.',
        );
      } finally {
        if (requestId === searchRequestId.current) {
          setIsSearching(false);
        }
      }
    }, 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };

  }, [searchText, userCoordinate]);

  const handleSelectLocation = (
    result: SearchResult,
  ) => {
    // Cancel outstanding search responses.
    searchRequestId.current += 1;

    setSearchText('');
    setSearchResults([]);
    setSearchError('');
    setIsSearching(false);

    // Keep the current geofence radius.
    setLocation(previous => ({
      coordinate: result.coordinate,
      radius: previous.radius,
    }));

    // Explicit camera request.
    searchSelectionId.current += 1;

    setSearchFocus({
      coordinate: result.coordinate,
      requestId: searchSelectionId.current,
    });
  };

  const handleSave = async () => {
    if (!location.coordinate || isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      const saved = await onSave({
        title: trimmedTitle,
        description: description.trim(),
        coordinate: location.coordinate,
        radius: location.radius,
        remindAt: remindAt.toISOString(),
      });

      if (!saved) {
        setIsSaving(false);
      }
    } catch {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.main}>
      <View style={styles.header}>
        <View style={styles.headerTexts}>
          <Text size="title" weight="bold">
            {isEditing
              ? 'Edit Reminder'
              : 'New Reminder'}
          </Text>

          <Text
            color="subtext"
            style={styles.headerSubtitle}
          >
            Set location trigger & boundary
          </Text>
        </View>

        <View style={styles.headerActions}>
          {isEditing && reminder && (
            <IconButton
              icon="trash-outline"
              color="danger"
              accessibilityLabel="Delete reminder"
              onPress={() =>
                onDeletePress(reminder)
              }
            />
          )}

          <IconButton
            icon="close"
            accessibilityLabel="Close"
            onPress={onClose}
          />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={!isAdjustingMap}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextField
          label="Reminder title"
          trailingIcon="notifications-outline"
          placeholder="e.g. Pick up prescription"
          value={title}
          onChangeText={setTitle}
          returnKeyType="done"
          maxLength={TITLE_MAX_LENGTH}
        />

        <TextField
          label="Notes (optional)"
          labelAccessory={
            <Text
              size="caption"
              color="subtext"
            >
              {description.length}/{NOTES_MAX_LENGTH}
            </Text>
          }
          placeholder="Add details"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={NOTES_MAX_LENGTH}
        />

        <DateTimeField
          label="Due Date & Time"
          value={remindAt}
          onChange={setRemindAt}
          minimumDate={
            isEditing
              ? undefined
              : startOfDay(new Date())
          }
        />

        {/* LOCATION SEARCH */}
        <View style={styles.searchSection}>
          <Text
            weight="semiBold"
            size="caption"
            style={styles.sectionLabel}
          >
            Search Location
          </Text>

          <View style={styles.searchInputRow}>
            <Icon
              name="search-outline"
              size={20}
              color="primary"
            />

            <TextInput
              style={styles.searchInput}
              placeholder="Search a place or address..."
              placeholderTextColor="#888888"
              value={searchText}
              onChangeText={setSearchText}
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="search"
              accessibilityLabel="Search location"
            />

            {isSearching && (
              <ActivityIndicator
                size="small"
                color={Colors.primary}
              />
            )}
          </View>

          {searchResults.length > 0 && (
            <View style={styles.resultsContainer}>
              {searchResults.map(result => (
                <Pressable
                  key={result.id}
                  style={styles.resultRow}
                  accessibilityRole="button"
                  onPress={() =>
                    handleSelectLocation(result)
                  }
                >
                  <Icon
                    name="location-outline"
                    size={18}
                    color="primary"
                  />

                  <View style={styles.resultText}>
                    <Text weight="semiBold">
                      {result.name}
                    </Text>

                    {!!result.address && (
                      <Text
                        size="caption"
                        color="subtext"
                      >
                        {result.address}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {!!searchError && (
            <Text
              size="caption"
              color="subtext"
              style={styles.searchMessage}
            >
              {searchError}
            </Text>
          )}
        </View>

        {/* LOCATION AND GEOFENCE */}
        <View>
          <View style={styles.locationLabelRow}>
            <Text
              weight="semiBold"
              size="caption"
              style={styles.sectionLabel}
            >
              Location & Geofence
            </Text>

            {!!location.coordinate && (
              <View style={styles.coordinateChip}>
                <Icon
                  name="pin-outline"
                  size={12}
                  color="primaryDark"
                />

                <Text
                  size="caption"
                  weight="semiBold"
                  color="primaryDark"
                >
                  {formatCoordinate(
                    location.coordinate,
                  )}
                </Text>
              </View>
            )}
          </View>

          <LocationPicker
            value={location}
            userCoordinate={userCoordinate}
            onChange={setLocation}
            onAdjustingChange={setIsAdjustingMap}
            searchFocus={searchFocus}
          />
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          label="Save Reminder"
          icon="checkmark-circle-outline"
          disabled={!canSave}
          loading={isSaving}
          onPress={handleSave}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  main: {
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  headerTexts: {
    flexShrink: 1,
  },
  headerSubtitle: {
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginLeft: Spacing.md,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  locationLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  coordinateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primaryMuted,
  },
  searchSection: {
    gap: Spacing.sm,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 50,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    paddingVertical: Spacing.sm,
  },
  resultsContainer: {
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.inputBg,
  },
  resultText: {
    flex: 1,
    gap: 3,
  },
  searchMessage: {
    marginTop: Spacing.xs,
  },
  actions: {
    paddingTop: Spacing.md,
  },
});
