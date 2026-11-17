
import React, {
  ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import type { Feature, Point, Position } from 'geojson';
import type { SearchBounds } from '@src/services/locationSearch/locationSearchTypes';

import { Icon } from '@src/components/Icon';
import { Text } from '@src/components/Text';
import { Colors } from '@src/constants/colors';
import { MapConfig } from '@src/constants/config';
import { Radius, Spacing } from '@src/constants/layout';
import { Shadows } from '@src/constants/shadows';
import {
  bearingBetween,
  destinationPoint,
  distanceBetween,
  formatDistance,
  getCircleBounds,
} from '@src/helpers/geo';
import { useResponsive } from '@src/hooks/useResponsive';
import { DraggableMarker } from '@src/modules/reminders/components/DraggableMarker';
import { GeofenceLayer } from '@src/modules/reminders/components/GeofenceLayer';
import { RadiusHandle } from '@src/modules/reminders/components/RadiusHandle';
import { ReminderPin } from '@src/modules/reminders/components/ReminderPin';
import { normalizeRadius } from '@src/modules/reminders/helpers';
import { Geofence } from '@src/modules/reminders/types';

export interface PickerValue {
  coordinate: Position | null;
  radius: number;
}

export interface SearchLocationFocus {
  coordinate: Position;
  requestId: number;
  bounds?: SearchBounds;
}

interface LocationPickerProps {
  value: PickerValue;
  userCoordinate: Position | null;
  onChange: (value: PickerValue) => void;
  onAdjustingChange: (isAdjusting: boolean) => void;
  searchFocus?: SearchLocationFocus | null;
  onVisibleBoundsChange?: (bounds: SearchBounds) => void;
  onUseMyLocation?: () => void;
}

type CameraFocus = Geofence & {
  bounds?: SearchBounds;
};

const CAMERA_PADDING = {
  paddingTop: Spacing.xl,
  paddingBottom: Spacing.xl,
  paddingLeft: Spacing.xl,
  paddingRight: Spacing.xl,
};

const MAP_HEIGHT_RATIO = 0.3;
const MAP_MIN_HEIGHT = 200;
const MAP_MAX_HEIGHT = 320;
const DEFAULT_HANDLE_BEARING = Math.PI / 2;

export const LocationPicker = (props: LocationPickerProps) => {
  const {
    value,
    userCoordinate,
    onChange,
    onAdjustingChange,
    searchFocus,
    onVisibleBoundsChange,
    onUseMyLocation,
  } = props;

  const { coordinate, radius } = value;
  const { height } = useResponsive();

  const [handleBearing, setHandleBearing] = useState(
    DEFAULT_HANDLE_BEARING,
  );

  const [isDragging, setIsDragging] = useState(false);

  const mapRef = useRef<Mapbox.MapView>(null);
  const mapContainerRef = useRef<ComponentRef<typeof View>>(null);

  const [cameraFocus, setCameraFocus] = useState<CameraFocus | null>(
    coordinate ? { coordinate, radius } : null,
  );

  // Use city geographic bounds when a city is selected.
  // Otherwise use the existing geofence circle bounds.
  const cameraBounds = useMemo(() => {
    if (!cameraFocus) {
      return undefined;
    }

    if (cameraFocus.bounds) {
      return {
        ne: [
          cameraFocus.bounds.east,
          cameraFocus.bounds.north,
        ] as Position,
        sw: [
          cameraFocus.bounds.west,
          cameraFocus.bounds.south,
        ] as Position,
      };
    }

    return getCircleBounds(
      cameraFocus.coordinate,
      cameraFocus.radius,
    );
  }, [cameraFocus]);

  // Move the camera when an explicit search selection occurs.
  useEffect(() => {
    if (!searchFocus) {
      return;
    }

    setCameraFocus({
      coordinate: searchFocus.coordinate,
      radius,
      bounds: searchFocus.bounds,
    });

    // requestId identifies each explicit search selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFocus?.requestId]);

  const handleCoordinate = useMemo(
    () =>
      coordinate
        ? destinationPoint(
            coordinate,
            radius,
            handleBearing,
          )
        : null,
    [coordinate, radius, handleBearing],
  );

  const handleMapPress = useCallback(
    (feature: Feature<Point>) => {
      onChange({
        coordinate: feature.geometry.coordinates,
        radius,
      });
    },
    [onChange, radius],
  );

  const handleMapLoaded = () => {
    setCameraFocus(current => {
      // Do not overwrite a city camera selection.
      if (current?.bounds) {
        return current;
      }

      if (coordinate) {
        return { coordinate, radius };
      }

      return current;
    });
  };

  // Report the currently visible map boundaries to the parent.
  const handleMapIdle = useCallback(
    (state: Mapbox.MapState) => {
      const { ne, sw } = state.properties.bounds;

      onVisibleBoundsChange?.({
        north: ne[1],
        east: ne[0],
        south: sw[1],
        west: sw[0],
      });
    },
    [onVisibleBoundsChange],
  );

  const handlePinDrag = (nextCoordinate: Position) => {
    onChange({
      coordinate: nextCoordinate,
      radius,
    });
  };

  const handleRadiusDrag = (point: Position) => {
    if (!coordinate) {
      return;
    }

    setHandleBearing(
      bearingBetween(coordinate, point),
    );

    onChange({
      coordinate,
      radius: normalizeRadius(
        distanceBetween(coordinate, point),
      ),
    });
  };

  const handleDragStart = () => {
    setIsDragging(true);
    onAdjustingChange(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    onAdjustingChange(false);
  };

  // Return the map and search workflow to the user's GPS location.
  const handleUseMyLocation = () => {
    if (!userCoordinate) {
      return;
    }

    onChange({
      coordinate: userCoordinate,
      radius,
    });

    setCameraFocus({
      coordinate: userCoordinate,
      radius,
    });

    onUseMyLocation?.();
  };

  return (
    <View>
      <View
        ref={mapContainerRef}
        style={[
          styles.mapCard,
          {
            height: Math.min(
              MAP_MAX_HEIGHT,
              Math.max(
                MAP_MIN_HEIGHT,
                height * MAP_HEIGHT_RATIO,
              ),
            ),
          },
        ]}
      >
        <Mapbox.MapView
          ref={mapRef}
          style={styles.map}
          scrollEnabled={!isDragging}
          zoomEnabled={!isDragging}
          styleURL={Mapbox.StyleURL.Street}
          surfaceView={false}
          onMapIdle={handleMapIdle}
          compassEnabled={false}
          scaleBarEnabled={false}
          onPress={handleMapPress}
          onDidFinishLoadingMap={handleMapLoaded}
        >
          <Mapbox.Camera
            defaultSettings={
              userCoordinate
                ? {
                    centerCoordinate: userCoordinate,
                    zoomLevel: MapConfig.userZoomLevel,
                  }
                : {
                    zoomLevel: MapConfig.defaultZoomLevel,
                  }
            }
            bounds={cameraBounds}
            padding={CAMERA_PADDING}
            animationDuration={MapConfig.animationDuration}
          />

          {!!coordinate && !!handleCoordinate && (
            <>
              <GeofenceLayer
                id="picker"
                geofences={[
                  { coordinate, radius },
                ]}
              />

              <DraggableMarker
                coordinate={handleCoordinate}
                mapRef={mapRef}
                mapContainerRef={mapContainerRef}
                accessibilityLabel="Resize reminder area"
                onDragStart={handleDragStart}
                onDrag={handleRadiusDrag}
                onDragEnd={handleDragEnd}
              >
                <RadiusHandle />
              </DraggableMarker>

              <DraggableMarker
                coordinate={coordinate}
                mapRef={mapRef}
                mapContainerRef={mapContainerRef}
                accessibilityLabel="Move reminder location"
                onDragStart={handleDragStart}
                onDrag={handlePinDrag}
                onDragEnd={handleDragEnd}
              >
                <ReminderPin />
              </DraggableMarker>
            </>
          )}
        </Mapbox.MapView>

        {!!coordinate && (
          <View
            style={styles.radiusPill}
            pointerEvents="none"
          >
            <Icon
              name="radio-button-on"
              size={16}
              color="primary"
            />
            <Text weight="bold">
              Radius: {formatDistance(radius)}
            </Text>
          </View>
        )}
      </View>

      {coordinate ? (
        <Text
          size="caption"
          color="subtext"
          style={styles.hint}
        >
          Drag the pin to move the reminder, or drag the
          handle on the edge to resize the circle.
        </Text>
      ) : (
        <View style={styles.emptyRow}>
          <Icon
            name="location-outline"
            size={18}
            color="placeholder"
          />
          <Text
            size="caption"
            color="subtext"
            style={styles.emptyText}
          >
            Tap the map or search to choose a location
          </Text>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={!userCoordinate}
        hitSlop={Spacing.sm}
        onPress={handleUseMyLocation}
        style={[
          styles.myLocation,
          !userCoordinate && styles.disabled,
        ]}
      >
        <Icon
          name="navigate-outline"
          size={16}
          color="primary"
        />
        <Text
          size="caption"
          weight="semiBold"
          color="primary"
        >
          Use my location
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  mapCard: {
    overflow: 'hidden',
    borderRadius: Radius.lg,
    backgroundColor: Colors.inputBg,
  },
  map: {
    flex: 1,
  },
  radiusPill: {
    position: 'absolute',
    left: Spacing.md,
    bottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.cardBg,
    ...Shadows.card,
  },
  hint: {
    marginTop: Spacing.md,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  emptyText: {
    marginLeft: Spacing.sm,
  },
  myLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    marginTop: Spacing.md,
  },
  disabled: {
    opacity: 0.4,
  },
});
