
package com.reminderapp.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Restores scheduled alarms and geofences after:
 * - Device reboot
 * - Application update
 */
class GeofenceBootReceiver : BroadcastReceiver() {

  override fun onReceive(
    context: Context,
    intent: Intent,
  ) {

    when (intent.action) {

      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> {

        Log.i(
          TAG,
          "Device reboot or application update detected. Restoring reminders.",
        )

        val appContext = context.applicationContext
        val pendingResult = goAsync()

        try {

          // Restore scheduled alarms from saved reminders.
          val reminders =
            GeofenceStore.loadReminders(appContext)

          ReminderAlarmScheduler.sync(
            appContext,
            reminders,
          )

          Log.i(
            TAG,
            "Restored scheduled alarms for ${reminders.size} reminder(s)",
          )

          // Restore geofence registrations.
          GeofenceRegistrar.registerStored(
            appContext,
          ) { registered, error ->

            if (error != null) {

              Log.w(
                TAG,
                "Could not restore geofences: $error",
              )

            } else {

              Log.i(
                TAG,
                "Successfully restored $registered geofence(s)",
              )
            }

            pendingResult.finish()
          }

        } catch (exception: Exception) {

          Log.e(
            TAG,
            "Failed to restore reminders after reboot",
            exception,
          )

          pendingResult.finish()
        }
      }

      else -> {

        Log.d(
          TAG,
          "Ignoring boot receiver action: ${intent.action}",
        )
      }
    }
  }

  companion object {
    private const val TAG = "GeofenceBootReceiver"
  }
}
