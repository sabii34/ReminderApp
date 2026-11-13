
package com.reminderapp.geofence

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/** JS entry point: keeps native reminders and alarms synchronized. */
class ReminderGeofenceModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  /**
   * Synchronizes reminders from React Native with:
   * 1. Native reminder storage
   * 2. Android scheduled alarms
   * 3. Android geofences
   */
  @ReactMethod
  fun sync(reminders: ReadableArray, promise: Promise) {
    try {
      val parsed =
        (0 until reminders.size()).mapNotNull { index ->
          val item = reminders.getMap(index)
            ?: return@mapNotNull null

          val id = item.getString("id")
            ?: return@mapNotNull null

          val dueDay = item.getString("dueDay")
            ?: return@mapNotNull null

          val latitude =
            if (item.hasKey("latitude") && !item.isNull("latitude")) {
              item.getDouble("latitude")
            } else {
              return@mapNotNull null
            }

          val longitude =
            if (item.hasKey("longitude") && !item.isNull("longitude")) {
              item.getDouble("longitude")
            } else {
              return@mapNotNull null
            }

          val radius =
            if (item.hasKey("radius") && !item.isNull("radius")) {
              item.getDouble("radius").toFloat()
            } else {
              100f
            }

          val remindAt =
            if (item.hasKey("remindAt") && !item.isNull("remindAt")) {
              item.getDouble("remindAt").toLong()
            } else {
              0L
            }

          GeofenceReminder(
            id = id,
            title = item.getString("title") ?: "",
            body = item.getString("body") ?: "",
            dueDay = dueDay,
            latitude = latitude,
            longitude = longitude,
            radius = radius,
            remindAt = remindAt,
          )
        }

      val context = reactApplicationContext

      // Prepare the notification channel.
      ReminderNotifier.ensureChannel(context)

      // Save reminders in native storage.
      GeofenceStore.saveReminders(context, parsed)

      // Schedule or cancel Android alarms.
      ReminderAlarmScheduler.sync(context, parsed)

      // Register reminders with Android geofencing.
      GeofenceRegistrar.registerStored(context) { registered, error ->

        promise.resolve(
          Arguments.createMap().apply {
            putInt("watching", registered)

            if (error != null) {
              putString("error", error)
            } else {
              putNull("error")
            }
          },
        )
      }

    } catch (exception: Exception) {
      promise.reject(
        "GEOFENCE_SYNC_ERROR",
        exception.message
          ?: "Failed to synchronize geofence reminders",
        exception,
      )
    }
  }

  /**
   * Returns notification and location permission status.
   */
  @ReactMethod
  fun getStatus(promise: Promise) {
    val context = reactApplicationContext

    promise.resolve(
      Arguments.createMap().apply {
        putBoolean(
          "notifications",
          ReminderNotifier.canNotify(context),
        )

        putString(
          "location",
          when {
            GeofenceRegistrar.hasBackgroundLocationPermission(context) ->
              "always"

            GeofenceRegistrar.hasLocationPermission(context) ->
              "whenInUse"

            else ->
              "denied"
          },
        )
      },
    )
  }

  /**
   * Displays a notification requested by React Native.
   */
  @ReactMethod
  fun displayNotification(
    title: String,
    body: String,
    promise: Promise,
  ) {
    try {
      val context = reactApplicationContext

      ReminderNotifier.show(
        context,
        (title + body).hashCode(),
        title,
        body,
        null,
      )

      promise.resolve(null)

    } catch (exception: Exception) {
      promise.reject(
        "DISPLAY_NOTIFICATION_ERROR",
        exception.message
          ?: "Failed to display notification",
        exception,
      )
    }
  }

  // Required by React Native NativeEventEmitter.
  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit

  companion object {
    const val NAME = "ReminderGeofence"
  }
}
