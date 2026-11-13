
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

import { toLocalDayKey } from '@src/helpers/date';
import { Reminder } from '@src/modules/reminders/types';

/**
 * Arrival and scheduled reminder alerts.
 *
 * The native ReminderGeofence module registers each open reminder's
 * location with the operating system.
 *
 * Android:
 * - Registers reminder locations with Google Play services.
 * - Sends the scheduled reminder timestamp to native Android.
 * - Handles geofence ENTER and EXIT events natively.
 * - Native notification handling decides whether an arrival or
 *   scheduled notification should be displayed.
 *
 * The native scheduled notification handler must check whether
 * the user is currently inside the reminder's geofence.
 */

interface NativeGeofenceReminder {
  id: string;
  title: string;
  body: string;

  /** Local due date, "yyyy-MM-dd". */
  dueDay: string;

  /** Scheduled reminder timestamp in milliseconds. */
  remindAt: number;

  latitude: number;
  longitude: number;
  radius: number;
}

export type LocationAccess = 'always' | 'whenInUse' | 'denied';

export interface AlertStatus {
  notifications: boolean;
  location: LocationAccess;
}

export interface SyncResult {
  /** Number of areas the OS is watching. */
  watching: number;
  error: string | null;
}

interface ReminderGeofenceModule {
  sync: (
    reminders: NativeGeofenceReminder[],
  ) => Promise<SyncResult>;

  getStatus: () => Promise<AlertStatus>;

  displayNotification: (
    title: string,
    body: string,
  ) => Promise<void>;

  /** iOS only: asks for notification and "Always" location access. */
  requestPermissions?: () => Promise<AlertStatus>;
}

const getNative = () =>
  NativeModules.ReminderGeofence as
    | ReminderGeofenceModule
    | undefined;

/**
 * Converts a React Native reminder into the native reminder format.
 *
 * remindAt is sent as a Unix timestamp in milliseconds.
 */
export const toNativeReminder = (
  reminder: Reminder,
): NativeGeofenceReminder => {
  const remindAt = new Date(reminder.remindAt).getTime();

  return {
    id: reminder.id,
    title: reminder.title,
    body: reminder.description,

    dueDay: toLocalDayKey(
      new Date(reminder.remindAt),
    ),

    remindAt,

    latitude: reminder.coordinate[1],
    longitude: reminder.coordinate[0],
    radius: reminder.radius,
  };
};

let lastSynced: Reminder[] = [];

/**
 * Synchronizes open reminders with native geofence registration.
 *
 * Completed reminders are excluded.
 *
 * Passing an empty list stops watching all reminder locations,
 * for example when the user logs out.
 */
export const syncGeofences = async (
  reminders: Reminder[],
): Promise<SyncResult | null> => {
  lastSynced = reminders;

  const native = getNative();

  if (!native) {
    return null;
  }

  const open = reminders.filter(
    item => !item.isCompleted,
  );

  const result = await native.sync(
    open.map(toNativeReminder),
  );

  if (result.error) {
    console.warn(
      '[Alerts] reminder areas not watched:',
      result.error,
    );
  }

  return result;
};

/**
 * Registers the previously synchronized reminders again.
 *
 * Used after permission changes.
 */
export const resyncGeofences = () =>
  syncGeofences(lastSynced);

/**
 * Gets the current native notification and location permission status.
 */
export const getAlertStatus =
  async (): Promise<AlertStatus | null> =>
    getNative()?.getStatus() ?? null;

/**
 * Returns true when notification permission and Always location
 * permission are both enabled.
 */
export const isFullyEnabled = (
  status: AlertStatus | null,
) =>
  !!status &&
  status.notifications &&
  status.location === 'always';

/**
 * Requests the Android permissions required for geofence alerts.
 */
const requestAndroidPermissions = async () => {
  const { PERMISSIONS, RESULTS } = PermissionsAndroid;

  const apiLevel = Number(Platform.Version);

  const location = await PermissionsAndroid.request(
    PERMISSIONS.ACCESS_FINE_LOCATION,
  );

  if (apiLevel >= 33) {
    await PermissionsAndroid.request(
      PERMISSIONS.POST_NOTIFICATIONS,
    );
  }

  /**
   * Background location must be requested separately.
   *
   * On Android 11 and newer, the user may need to select
   * "Allow all the time" from the system settings.
   */
  if (
    location === RESULTS.GRANTED &&
    apiLevel >= 29
  ) {
    await PermissionsAndroid.request(
      PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
    );
  }
};

/**
 * Requests the permissions needed for arrival alerts.
 *
 * After requesting permissions, synchronizes geofences again
 * and returns the updated native permission status.
 */
export const requestAlertPermissions =
  async (): Promise<AlertStatus | null> => {
    const native = getNative();

    if (!native) {
      return null;
    }

    if (Platform.OS === 'android') {
      await requestAndroidPermissions();
    } else {
      await native.requestPermissions?.();
    }

    await resyncGeofences();

    return native.getStatus();
  };

/**
 * Displays a notification while the application is open.
 *
 * Native Android notification handling is responsible for
 * displaying geofence arrival and scheduled notifications.
 */
export const displayNotification = async (
  title: string,
  body: string,
) =>
  getNative()?.displayNotification(
    title,
    body,
  );
