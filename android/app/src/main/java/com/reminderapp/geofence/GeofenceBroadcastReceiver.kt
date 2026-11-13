
package com.reminderapp.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent

/**
 * Receives geofence transitions from Play services.
 *
 * Handles:
 * - ENTER: User enters a reminder's location.
 * - EXIT: User leaves a reminder's location.
 *
 * This receiver can run when the app is in the foreground,
 * background, or not currently running.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val event = GeofencingEvent.fromIntent(intent)

    if (event == null) {
      Log.w(
        TAG,
        "Received geofence broadcast without a valid event",
      )
      return
    }

    if (event.hasError()) {
      val message =
        GeofenceStatusCodes.getStatusCodeString(event.errorCode)

      Log.w(
        TAG,
        "Geofence error: $message",
      )

      return
    }

    val transition = event.geofenceTransition

    val ids =
      event.triggeringGeofences
        .orEmpty()
        .map { it.requestId }
        .filter { it.isNotBlank() }

    if (ids.isEmpty()) {
      Log.w(
        TAG,
        "Geofence transition received without reminder IDs",
      )
      return
    }

    when (transition) {

      Geofence.GEOFENCE_TRANSITION_ENTER -> {
        Log.d(
          TAG,
          "User entered geofence: $ids",
        )

        // Persist the current inside state for each reminder.
        ids.forEach { id ->
          GeofenceStore.setInside(
            context,
            id,
            true,
          )
        }

        // Process arrival notifications.
        // ReminderNotifier should decide whether the reminder
        // has already been notified and whether it is eligible.
        ReminderNotifier.handleEntered(
          context,
          ids,
        )
      }

      Geofence.GEOFENCE_TRANSITION_EXIT -> {
        Log.d(
          TAG,
          "User exited geofence: $ids",
        )

        // Persist that the user is no longer inside.
        // The scheduled notification must check this state
        // before displaying its notification.
        ids.forEach { id ->
          GeofenceStore.setInside(
            context,
            id,
            false,
          )
        }
      }

      else -> {
        Log.d(
          TAG,
          "Ignoring geofence transition: $transition",
        )
      }
    }
  }

  companion object {
    private const val TAG = "GeofenceReceiver"
  }
}
