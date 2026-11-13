
package com.reminderapp.geofence

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.reminderapp.AlarmActivity
import com.reminderapp.R

object ReminderNotifier {

    private const val TAG = "ReminderNotifier"

    // New channel because Android preserves existing channel settings.
    const val CHANNEL_ID = "reminder_alarm_v2"

    private val notificationLock = Any()

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val manager =
            context.getSystemService(NotificationManager::class.java)

        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return
        }

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Reminder alarms",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Full-screen location and scheduled reminder alarms"
            enableVibration(true)
            setSound(null, null)
        }

        manager.createNotificationChannel(channel)
    }

    fun canNotify(context: Context): Boolean {
        val manager = NotificationManagerCompat.from(context)

        val granted =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED

        return granted && manager.areNotificationsEnabled()
    }

    fun handleEntered(
        context: Context,
        reminderIds: List<String>
    ) {
        for (id in reminderIds) {
            val reminder = GeofenceStore.findReminder(context, id)

            if (reminder == null) {
                Log.i(TAG, "Entered $id: reminder no longer exists")
                continue
            }

            GeofenceStore.setInside(context, id, true)

            Log.i(TAG, "Entered $id: geofence state updated")

            handleScheduled(context, id)
        }
    }

    fun handleScheduled(
        context: Context,
        reminderId: String
    ) {
        synchronized(notificationLock) {

            val reminder =
                GeofenceStore.findReminder(context, reminderId)

            if (reminder == null) {
                Log.i(TAG, "Scheduled $reminderId: reminder no longer exists")
                return
            }

            if (reminder.remindAt <= 0L) {
                Log.w(TAG, "Scheduled $reminderId: invalid remindAt")
                return
            }

            if (reminder.dueDay < GeofenceStore.today()) {
                Log.i(TAG, "Scheduled $reminderId: reminder is past due")
                return
            }

            val currentTime = System.currentTimeMillis()

            Log.i(
                TAG,
                "TIME DEBUG | ID=$reminderId | " +
                    "NOW=$currentTime | " +
                    "REMIND_AT=${reminder.remindAt} | " +
                    "DIFFERENCE_MS=${reminder.remindAt - currentTime} | " +
                    "DUE_DAY=${reminder.dueDay}"
            )

            if (currentTime < reminder.remindAt) {
                Log.i(TAG, "Scheduled $reminderId: scheduled time has not arrived")
                return
            }

            if (!GeofenceStore.isInside(context, reminderId)) {
                Log.i(TAG, "Scheduled $reminderId: user is outside the geofence")
                return
            }

            if (GeofenceStore.wasNotified(context, reminder)) {
                Log.i(TAG, "Scheduled $reminderId: already notified")
                return
            }

            if (!canNotify(context)) {
                Log.w(TAG, "Scheduled $reminderId: notifications are not allowed")
                return
            }

            // Prevent duplicate alarm launches.
            GeofenceStore.markNotified(context, reminder)

            show(
                context,
                reminder.id.hashCode(),
                reminder.title,
                reminder.body,
                reminder.id
            )

            Log.i(TAG, "Scheduled $reminderId: alarm notification requested")
        }
    }

    fun show(
        context: Context,
        notificationId: Int,
        title: String,
        body: String,
        reminderId: String?
    ) {
        if (!canNotify(context)) {
            return
        }

        ensureChannel(context)

        val alarmIntent = Intent(
            context,
            AlarmActivity::class.java
        ).apply {
data = android.net.Uri.parse(
        "reminderapp://alarm/$reminderId"
    )
            flags =
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP

            reminderId?.let {
                putExtra("reminderId", it)
            }

            putExtra("notificationId", notificationId)
        }

        val alarmPendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or
                PendingIntent.FLAG_IMMUTABLE
        )

        val notificationText = body.ifBlank {
            "Your scheduled reminder is due."
        }

        val notification = NotificationCompat.Builder(
            context,
            CHANNEL_ID
        )
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setColor(
                ContextCompat.getColor(
                    context,
                    R.color.notification_accent
                )
            )
            .setContentTitle(title)
            .setContentText(notificationText)
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(notificationText)
            )
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(alarmPendingIntent, true)
            .setContentIntent(alarmPendingIntent)
            .setAutoCancel(true)
            .setOngoing(false)
            .setVibrate(longArrayOf(0, 500, 250, 500))
            .build()

        try {
            NotificationManagerCompat
                .from(context)
                .notify(notificationId, notification)

        } catch (error: SecurityException) {
            Log.w(TAG, "Notification permission was revoked", error)
        }
    }
}
