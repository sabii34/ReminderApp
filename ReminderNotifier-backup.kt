
package com.reminderapp.geofence

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.reminderapp.MainActivity
import com.reminderapp.R

object ReminderNotifier {

    private const val TAG = "ReminderNotifier"

    /**
     * Keep the existing channel ID.
     */
    const val CHANNEL_ID = "reminder_alerts_v1"

    /**
     * Prevent simultaneous alarm and geofence events from
     * processing the same reminder concurrently in this process.
     *
     * This lock is process-local. Persistent notification state
     * is also checked through GeofenceStore.
     */
    private val notificationLock = Any()

    /**
     * Custom reminder ringtone.
     */
    private fun soundUri(context: Context): Uri =
        Uri.parse(
            "${ContentResolver.SCHEME_ANDROID_RESOURCE}://" +
                "${context.packageName}/${R.raw.reminder_alert}",
        )

    /**
     * Creates the notification channel.
     *
     * Existing channel settings are preserved.
     */
    fun ensureChannel(context: Context) {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val manager =
            context.getSystemService(NotificationManager::class.java)

        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return
        }

        val channel =
            NotificationChannel(
                CHANNEL_ID,
                "Location reminders",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {

                description =
                    "Alerts when you arrive at a reminder's place"

                enableVibration(true)

                setSound(
                    soundUri(context),
                    AudioAttributes.Builder()
                        .setUsage(
                            AudioAttributes.USAGE_NOTIFICATION,
                        )
                        .setContentType(
                            AudioAttributes.CONTENT_TYPE_SONIFICATION,
                        )
                        .build(),
                )
            }

        manager.createNotificationChannel(channel)
    }

    /**
     * Checks whether notifications are allowed.
     */
    fun canNotify(context: Context): Boolean {

        val manager =
            NotificationManagerCompat.from(context)

        val granted =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED

        return granted && manager.areNotificationsEnabled()
    }

    /**
     * Called when the user enters a reminder geofence.
     *
     * ENTER records that the user is inside.
     *
     * The notification is sent only if:
     * - The reminder still exists.
     * - Its due date has not passed.
     * - Its scheduled time has arrived.
     * - Notifications are allowed.
     * - It has not already been notified.
     */
    fun handleEntered(
        context: Context,
        reminderIds: List<String>,
    ) {

        for (id in reminderIds) {

            val reminder =
                GeofenceStore.findReminder(context, id)

            if (reminder == null) {

                Log.i(
                    TAG,
                    "Entered $id: reminder no longer exists",
                )

                continue
            }

            // Record the ENTER event.
            GeofenceStore.setInside(
                context,
                id,
                true,
            )

            Log.i(
                TAG,
                "Entered $id: geofence state updated",
            )

            // Check whether the scheduled time has arrived.
            handleScheduled(
                context,
                id,
            )
        }
    }

    /**
     * Called by:
     *
     * 1. ReminderScheduledReceiver when the scheduled alarm fires.
     * 2. handleEntered when the user enters the geofence.
     *
     * Both event sources use this centralized handler.
     */
    fun handleScheduled(
        context: Context,
        reminderId: String,
    ) {

        synchronized(notificationLock) {

            // Always retrieve the latest stored reminder.
            val reminder =
                GeofenceStore.findReminder(
                    context,
                    reminderId,
                )

            if (reminder == null) {

                Log.i(
                    TAG,
                    "Scheduled $reminderId: reminder no longer exists",
                )

                return
            }

            // Reject reminders without a valid scheduled time.
            if (reminder.remindAt <= 0L) {

                Log.w(
                    TAG,
                    "Scheduled $reminderId: invalid remindAt",
                )

                return
            }

            // Reject reminders whose due date has passed.
            if (reminder.dueDay < GeofenceStore.today()) {

                Log.i(
                    TAG,
                    "Scheduled $reminderId: reminder is past due",
                )

                return
            }

            // Wait until the scheduled time.
            val currentTime =
                System.currentTimeMillis()

                Log.i(
    TAG,
    "TIME DEBUG | ID=$reminderId | " +
        "NOW=${currentTime} | " +
        "REMIND_AT=${reminder.remindAt} | " +
        "DIFFERENCE_MS=${reminder.remindAt - currentTime} | " +
        "DUE_DAY=${reminder.dueDay}"
)

            if (currentTime < reminder.remindAt) {

                Log.i(
                    TAG,
                    "Scheduled $reminderId: scheduled time has not arrived",
                )

                return
            }

            // Wait until the user is inside the geofence.
            if (!GeofenceStore.isInside(
                    context,
                    reminderId,
                )
            ) {

                Log.i(
                    TAG,
                    "Scheduled $reminderId: user is outside the geofence",
                )

                return
            }

            // Prevent another notification for the same reminder/day.
            if (GeofenceStore.wasNotified(
                    context,
                    reminder,
                )
            ) {

                Log.i(
                    TAG,
                    "Scheduled $reminderId: already notified",
                )

                return
            }

            // Check notification permission.
            if (!canNotify(context)) {

                Log.w(
                    TAG,
                    "Scheduled $reminderId: notifications are not allowed",
                )

                return
            }

            /**
             * Record notification state before displaying.
             *
             * This reduces duplicate notification attempts when
             * alarm and geofence events arrive close together.
             */
            GeofenceStore.markNotified(
                context,
                reminder,
            )

            // Display the existing reminder notification.
            show(
                context,
                reminder.id.hashCode(),
                reminder.title,
                reminder.body,
                reminder.id,
            )

            Log.i(
                TAG,
                "Scheduled $reminderId: notification requested",
            )
        }
    }

    /**
     * Displays a reminder notification.
     *
     * Preserves the existing:
     * - Custom ringtone
     * - Notification channel
     * - Notification icon
     * - Accent color
     * - Vibration
     * - Notification tap behavior
     */
    fun show(
        context: Context,
        notificationId: Int,
        title: String,
        body: String,
        reminderId: String?,
    ) {

        if (!canNotify(context)) {
            return
        }

        ensureChannel(context)

        val openApp =
            Intent(
                context,
                MainActivity::class.java,
            ).apply {

                flags =
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP

                reminderId?.let {
                    putExtra(
                        "reminderId",
                        it,
                    )
                }
            }

        val contentIntent =
            PendingIntent.getActivity(
                context,
                notificationId,
                openApp,
                PendingIntent.FLAG_UPDATE_CURRENT or
                    PendingIntent.FLAG_IMMUTABLE,
            )

        val text =
            body.ifBlank {
                "You've arrived at this reminder's place."
            }

        val notification =
            NotificationCompat.Builder(
                context,
                CHANNEL_ID,
            )
                .setSmallIcon(
                    R.drawable.ic_stat_reminder,
                )
                .setColor(
                    ContextCompat.getColor(
                        context,
                        R.color.notification_accent,
                    ),
                )
                .setContentTitle(
                    title,
                )
                .setContentText(
                    text,
                )
                .setStyle(
                    NotificationCompat.BigTextStyle()
                        .bigText(text),
                )
                .setPriority(
                    NotificationCompat.PRIORITY_HIGH,
                )
                .setCategory(
                    NotificationCompat.CATEGORY_REMINDER,
                )
                // Android versions before 8 use this sound.
                // Android 8+ uses the notification channel sound.
                .setSound(
                    soundUri(context),
                )
                .setDefaults(
                    NotificationCompat.DEFAULT_VIBRATE,
                )
                .setAutoCancel(
                    true,
                )
                .setContentIntent(
                    contentIntent,
                )
                .build()

        try {

            NotificationManagerCompat
                .from(context)
                .notify(
                    notificationId,
                    notification,
                )

        } catch (error: SecurityException) {

            Log.w(
                TAG,
                "Notification permission was revoked",
                error,
            )
        }
    }
}
