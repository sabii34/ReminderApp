
package com.reminderapp

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.MediaPlayer
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.reminderapp.geofence.GeofenceStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AlarmActivity : Activity() {

    companion object {
        private const val TAG = "AlarmActivity"
    }

    private var mediaPlayer: MediaPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Log.i(TAG, "AlarmActivity onCreate called")

        prepareAlarmWindow()

        displayReminder(intent)
    }

    // Handles another reminder when Android reuses this Activity.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)

        Log.i(TAG, "AlarmActivity onNewIntent called")

        // Update the Activity's current Intent.
        setIntent(intent)

        // Stop the previous reminder's sound.
        stopAlarmSound()

        // Display the newly received reminder.
        displayReminder(intent)
    }

    private fun prepareAlarmWindow() {

        // Allow the alarm to appear over the lock screen.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }

        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_FULLSCREEN
        )
    }

    private fun displayReminder(alarmIntent: Intent) {

        val reminderId =
            alarmIntent.getStringExtra("reminderId")

        if (reminderId.isNullOrBlank()) {
            Log.e(TAG, "Cannot display alarm: reminderId is missing")
            finish()
            return
        }

        val reminder =
            GeofenceStore.findReminder(this, reminderId)

        if (reminder == null) {
            Log.e(TAG, "Reminder not found: $reminderId")
            finish()
            return
        }

        Log.i(
            TAG,
            "Displaying reminder: $reminderId | Title: ${reminder.title}"
        )

        showAlarmScreen(
            reminder.title,
            reminder.body,
            reminder.remindAt
        )

        startAlarmSound()
    }

    private fun showAlarmScreen(
        title: String,
        description: String,
        remindAt: Long
    ) {

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(35), dp(28), dp(35))

            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(
                    Color.rgb(48, 35, 105),
                    Color.rgb(91, 57, 153),
                    Color.rgb(35, 45, 105)
                )
            )
        }

        val heading = TextView(this).apply {
            text = "REMINDER ALARM"
            textSize = 15f
            setTextColor(Color.WHITE)
            letterSpacing = 0.18f
            gravity = Gravity.CENTER
        }

        val time = TextView(this).apply {
            text = SimpleDateFormat(
                "hh:mm",
                Locale.getDefault()
            ).format(Date(remindAt))

            textSize = 64f

            typeface = Typeface.create(
                "sans-serif-light",
                Typeface.NORMAL
            )

            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }

        val amPm = TextView(this).apply {
            text = SimpleDateFormat(
                "a",
                Locale.getDefault()
            ).format(Date(remindAt))

            textSize = 19f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }

        val reminderTitle = TextView(this).apply {
            text = title
            textSize = 27f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }

        val reminderDescription = TextView(this).apply {
            text = description.ifBlank {
                "Your scheduled reminder is due."
            }

            textSize = 17f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }

        val scheduledTime = TextView(this).apply {
            text = "Scheduled for " +
                SimpleDateFormat(
                    "hh:mm a",
                    Locale.getDefault()
                ).format(Date(remindAt))

            textSize = 14f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
        }

        val dismissButton = Button(this).apply {
            text = "DISMISS"
            textSize = 17f
            isAllCaps = true

            setTextColor(
                Color.rgb(65, 45, 125)
            )

            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(32).toFloat()
            }

            setPadding(
                dp(35),
                dp(14),
                dp(35),
                dp(14)
            )

            setOnClickListener {

                Log.i(TAG, "Dismiss clicked")

                stopAlarmSound()

                // Uses the latest Intent, including a second reminder.
                val notificationId =
                    intent.getIntExtra("notificationId", 0)

                val notificationManager =
                    getSystemService(Context.NOTIFICATION_SERVICE)
                        as NotificationManager

                notificationManager.cancel(notificationId)

                finish()
            }
        }

        root.addView(
            heading,
            centeredParams(bottom = 35)
        )

        root.addView(
            time,
            centeredParams()
        )

        root.addView(
            amPm,
            centeredParams(bottom = 45)
        )

        root.addView(
            reminderTitle,
            centeredParams(bottom = 15)
        )

        root.addView(
            reminderDescription,
            centeredParams(bottom = 25)
        )

        root.addView(
            scheduledTime,
            centeredParams(bottom = 65)
        )

        root.addView(
            dismissButton,
            centeredParams()
        )

        setContentView(root)
    }

    private fun startAlarmSound() {

        try {
            mediaPlayer = MediaPlayer.create(
                this,
                R.raw.reminder_alert
            )?.apply {
                isLooping = true
                start()
            }

            Log.i(TAG, "Alarm sound started")

        } catch (error: Exception) {

            Log.e(
                TAG,
                "Unable to start alarm sound",
                error
            )
        }
    }

    private fun stopAlarmSound() {

        val player = mediaPlayer
        mediaPlayer = null

        try {
            player?.let {

                if (it.isPlaying) {
                    it.stop()
                }

                it.release()
            }

            Log.i(TAG, "Alarm sound stopped")

        } catch (error: Exception) {

            Log.e(
                TAG,
                "Unable to stop alarm sound",
                error
            )
        }
    }

    override fun onDestroy() {
        Log.i(TAG, "AlarmActivity onDestroy called")

        stopAlarmSound()

        super.onDestroy()
    }

    private fun centeredParams(
        bottom: Int = 0
    ): LinearLayout.LayoutParams {

        return LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER
            bottomMargin = dp(bottom)
        }
    }

    private fun dp(value: Int): Int {
        return (
            value * resources.displayMetrics.density
        ).toInt()
    }
}

