
package com.reminderapp.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class ReminderScheduledReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {

    val id = intent.getStringExtra("reminderId")

    if (id.isNullOrBlank()) {
      Log.w(
        "ReminderScheduled",
        "Scheduled alarm received without reminderId",
      )
      return
    }

    val reminder =
      GeofenceStore.findReminder(context, id)

    if (reminder == null) {
      Log.i(
        "ReminderScheduled",
        "$id: reminder no longer exists",
      )
      return
    }

    if (reminder.dueDay < GeofenceStore.today()) {
      Log.i(
        "ReminderScheduled",
        "$id: reminder is past its due day",
      )
      return
    }

    // Use the centralized scheduled notification handler.
    // It checks notification permission and geofence state.
    ReminderNotifier.handleScheduled(
      context,
      id,
    )
  }
}
