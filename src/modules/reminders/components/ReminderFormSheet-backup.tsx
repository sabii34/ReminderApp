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

import {
  searchNearbyPlaces,
  searchPlacesInBounds,
} from '@src/services/locationSearch/overpassService';

import { searchCities } from '@src/services/locationSearch/cityGeocoder';

import type {
  SearchBounds,
  SearchResult,
  CitySearchResult,
} from '@src/services/locationSearch/locationSearchTypes';

export interface ReminderFormSheetProps {
  visible: boolean;
  reminder: Reminder | null;
  userCoordinate: Position | null;
  onSave: (draft: ReminderDraft) => Promise<boolean>;
  onDeletePress: (reminder: Reminder) => void;
  onClose: () => void;
}

type SearchAreaMode = 'gps' | 'map';

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

  // Place search
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Separate city search
  const [citySearchText, setCitySearchText] = useState('');
  const [cityResults, setCityResults] = useState<CitySearchResult[]>([]);
  const [isSearchingCity, setIsSearchingCity] = useState(false);
  const [citySearchError, setCitySearchError] = useState('');

  // Map search area
  const [visibleBounds, setVisibleBounds] =
    useState<SearchBounds | null>(null);

  const [searchAreaMode, setSearchAreaMode] =
    useState<SearchAreaMode>('gps');

  const [searchFocus, setSearchFocus] =
    useState<SearchLocationFocus | null>(null);

  const searchRequestId = useRef(0);
  const citySearchRequestId = useRef(0);
  const searchSelectionId = useRef(0);
  const selectedCityRef = useRef('');

  const [isAdjustingMap, setIsAdjustingMap] =
    useState(false);

  const [isSaving, setIsSaving] = useState(false);

  const trimmedTitle = title.trim();

  const canSave =
    !!trimmedTitle && !!location.coordinate;

  // ---------------------------------------------------------
  // PLACE SEARCH
  // GPS FIRST -> VISIBLE MAP FALLBACK
  // ---------------------------------------------------------

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
      setIsSearching(true);
      setSearchError('');

      try {
        let results: SearchResult[] = [];

        // GPS mode: search around the user's current location.
        if (
          searchAreaMode === 'gps' &&
          userCoordinate
        ) {
          results = await searchNearbyPlaces(
            query,
            userCoordinate,
            5000,
            controller.signal,
          );
        }

        if (
          controller.signal.aborted ||
          requestId !== searchRequestId.current
        ) {
          return;
        }

        // If GPS search finds nothing, search the visible map.
        // Map mode searches only the visible map area.
        if (
          results.length === 0 &&
          visibleBounds
        ) {
          results = await searchPlacesInBounds(
            query,
            visibleBounds,
            controller.signal,
          );
        }

        if (
          controller.signal.aborted ||
          requestId !== searchRequestId.current
        ) {
          return;
        }

        setSearchResults(results);

        if (results.length === 0) {
          setSearchError(
            searchAreaMode === 'gps'
              ? 'No matching places found nearby or in the visible map area. Try searching for a city below.'
              : 'No matching places found in this map area. Move the map or search for another city.',
          );
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestId !== searchRequestId.current
        ) {
          return;
        }

        console.error('[POI SEARCH ERROR]', error);

        setSearchResults([]);
        setSearchError(
          error instanceof Error
            ? error.message
            : 'Unknown POI search error.',
        );
      } finally {
        if (requestId === searchRequestId.current) {
          setIsSearching(false);
        }
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    searchText,
    userCoordinate,
    visibleBounds,
    searchAreaMode,
  ]);

  // ---------------------------------------------------------
  // CITY SEARCH
  // GEOAPIFY
  // ---------------------------------------------------------

  useEffect(() => {
    const query = citySearchText.trim();

    // Keep the selected city visible without searching for it again.
    if (query && query === selectedCityRef.current) {
      setCityResults([]);
      setCitySearchError('');
      setIsSearchingCity(false);
      return;
    }

    const requestId = ++citySearchRequestId.current;

    if (query.length < 3) {
      setCityResults([]);
      setCitySearchError('');
      setIsSearchingCity(false);
      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setIsSearchingCity(true);
      setCitySearchError('');

      try {
        const results = await searchCities(
          query,
          controller.signal,
        );

        if (
          controller.signal.aborted ||
          requestId !== citySearchRequestId.current
        ) {
          return;
        }

        setCityResults(results);

        if (results.length === 0) {
          setCitySearchError('No matching cities found.');
        }
      } catch {
        if (
          controller.signal.aborted ||
          requestId !== citySearchRequestId.current
        ) {
          return;
        }

        setCityResults([]);

        setCitySearchError(
          'Unable to search cities. Check your internet connection and Geoapify API key.',
        );
      } finally {
        if (requestId === citySearchRequestId.current) {
          setIsSearchingCity(false);
        }
      }
    }, 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [citySearchText]);

  // ---------------------------------------------------------
  // SELECT A CITY OR A REAL PLACE
  // ---------------------------------------------------------

  const handleSelectPlace = (
    result: SearchResult,
  ) => {
    searchRequestId.current += 1;

    setSearchText('');
    setSearchResults([]);
    setSearchError('');
    setIsSearching(false);

    // A real POI selection updates the reminder location.
    // Keep the existing geofence radius.
    setLocation(previous => ({
      coordinate: result.coordinate,
      radius: previous.radius,
    }));

    searchSelectionId.current += 1;

    setSearchFocus({
      coordinate: result.coordinate,
      requestId: searchSelectionId.current,
    });
  };

  const handleSelectCity = (
    city: CitySearchResult,
  ) => {
    citySearchRequestId.current += 1;
    searchRequestId.current += 1;

    selectedCityRef.current = city.name;
    setCitySearchText(city.name);
    setCityResults([]);
    setCitySearchError('');

    setSearchText('');
    setSearchResults([]);
    setSearchError('');

    // Switch to map mode so POI searches do not return
    // results from the user's original GPS location.
    setSearchAreaMode('map');

    searchSelectionId.current += 1;

    // IMPORTANT:
    // Selecting a city moves the map only.
    // It does not update the reminder's saved coordinate.
    setSearchFocus({
      coordinate: city.coordinate,
      requestId: searchSelectionId.current,
      bounds: city.bounds,
    });
  };

  // ---------------------------------------------------------
  // USE MY LOCATION
  // ---------------------------------------------------------

  const handleUseMyLocation = () => {
    setSearchAreaMode('gps');

    searchRequestId.current += 1;
    citySearchRequestId.current += 1;

    setSearchText('');
    setSearchResults([]);
    setSearchError('');

    setCitySearchText('');
    setCityResults([]);
    setCitySearchError('');

    setIsSearching(false);
    setIsSearchingCity(false);
  };

  // ---------------------------------------------------------
  // MAP VISIBLE BOUNDS
  // ---------------------------------------------------------

  const handleVisibleBoundsChange = (
    bounds: SearchBounds,
  ) => {
    setVisibleBounds(bounds);
  };

  // ---------------------------------------------------------
  // SAVE REMINDER
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------

  return (
    <View style={styles.main}>
      {/* HEADER */}

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
              onPress={() => onDeletePress(reminder)}
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
        {/* TITLE */}

        <TextField
          label="Reminder title"
          trailingIcon="notifications-outline"
          placeholder="e.g. Pick up prescription"
          value={title}
          onChangeText={setTitle}
          returnKeyType="done"
          maxLength={TITLE_MAX_LENGTH}
        />

        {/* NOTES */}

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

        {/* DATE AND TIME */}

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

        {/* ------------------------------------------------- */}
        {/* CITY SEARCH */}
        {/* ------------------------------------------------- */}

        <View style={styles.searchSection}>
          <Text
            weight="semiBold"
            size="caption"
            style={styles.sectionLabel}
          >
            Search City or Country
          </Text>

          <View style={styles.searchInputRow}>
            <Icon
              name="globe-outline"
              size={20}
              color="primary"
            />

            <TextInput
              style={styles.searchInput}
              placeholder="e.g. London, Manchester..."
              placeholderTextColor="#888888"
              value={citySearchText}
              onChangeText={text => {
                selectedCityRef.current = '';
                setCitySearchText(text);
              }}
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="search"
              accessibilityLabel="Search city or country"
            />

            {isSearchingCity && (
              <ActivityIndicator
                size="small"
                color={Colors.primary}
              />
            )}
          </View>

          {cityResults.length > 0 && (
            <View style={styles.resultsContainer}>
              {cityResults.map(city => (
                <Pressable
                  key={city.id}
                  style={styles.resultRow}
                  accessibilityRole="button"
                  onPress={() => handleSelectCity(city)}
                >
                  <Icon
                    name="business-outline"
                    size={18}
                    color="primary"
                  />

                  <View style={styles.resultText}>
                    <Text weight="semiBold">
                      {city.name}
                    </Text>

                    {!!city.address && (
                      <Text
                        size="caption"
                        color="subtext"
                      >
                        {city.address}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {!!citySearchError && (
            <Text
              size="caption"
              color="subtext"
              style={styles.searchMessage}
            >
              {citySearchError}
            </Text>
          )}

          <Text
            size="caption"
            color="subtext"
          >
            Select a city to move the map. This will not set your reminder location.
          </Text>
        </View>

        {/* ------------------------------------------------- */}
        {/* POI SEARCH */}
        {/* ------------------------------------------------- */}

        <View style={styles.searchSection}>
          <Text
            weight="semiBold"
            size="caption"
            style={styles.sectionLabel}
          >
            Search Place or Business
          </Text>

          <View style={styles.searchInputRow}>
            <Icon
              name="search-outline"
              size={20}
              color="primary"
            />

            <TextInput
              style={styles.searchInput}
              placeholder="Search a mall, shop, hospital..."
              placeholderTextColor="#888888"
              value={searchText}
              onChangeText={setSearchText}
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="search"
              accessibilityLabel="Search place or business"
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
                  onPress={() => handleSelectPlace(result)}
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

          <Text
            size="caption"
            color="subtext"
          >
            {searchAreaMode === 'gps'
              ? 'Searching near your current GPS location first, then the visible map area.'
              : 'Searching places inside the visible map area.'}
          </Text>
        </View>

        {/* ------------------------------------------------- */}
        {/* LOCATION AND GEOFENCE */}
        {/* ------------------------------------------------- */}

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
                  {formatCoordinate(location.coordinate)}
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
            onVisibleBoundsChange={handleVisibleBoundsChange}
            onUseMyLocation={handleUseMyLocation}
          />
        </View>
      </ScrollView>

      {/* SAVE BUTTON */}

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

// ---------------------------------------------------------
// STYLES
// ---------------------------------------------------------

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