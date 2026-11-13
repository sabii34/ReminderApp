
package com.reminderapp.geofence

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

object ReminderAlarmScheduler {

    private const val TAG = "ReminderAlarmScheduler"

    private fun pending(
        context: Context,
        reminder: GeofenceReminder
    ): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            reminder.id.hashCode(),
            Intent(context, ReminderScheduledReceiver::class.java)
                .putExtra("reminderId", reminder.id),
            PendingIntent.FLAG_UPDATE_CURRENT or
                PendingIntent.FLAG_IMMUTABLE
        )

    fun sync(
        context: Context,
        reminders: List<GeofenceReminder>
    ) {
        val manager =
            context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        reminders.forEach { reminder ->
            val pi = pending(context, reminder)

            if (reminder.remindAt <= System.currentTimeMillis()) {
                manager.cancel(pi)
                return@forEach
            }

            try {
                if (
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    !manager.canScheduleExactAlarms()
                ) {
                    Log.e(
                        TAG,
                        "Exact alarm access not granted for ${reminder.id}"
                    )

                    // Fallback: schedule an inexact alarm.
                    manager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        reminder.remindAt,
                        pi
                    )
                } else {
                    manager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        reminder.remindAt,
                        pi
                    )

                    Log.i(
                        TAG,
                        "Exact alarm scheduled for ${reminder.id} at ${reminder.remindAt}"
                    )
                }
            } catch (error: SecurityException) {
                Log.e(TAG, "Unable to schedule exact alarm", error)

                manager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    reminder.remindAt,
                    pi
                )
            }
        }
    }

    fun cancel(
        context: Context,
        reminder: GeofenceReminder
    ) {
        val manager =
            context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        manager.cancel(pending(context, reminder))
    }
}
