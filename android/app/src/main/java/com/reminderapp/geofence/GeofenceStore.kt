
package com.reminderapp.geofence

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A reminder as the native layer needs it to watch its area and alert.
 *
 * remindAt is the scheduled reminder timestamp in milliseconds.
 */
data class GeofenceReminder(
    val id: String,
    val title: String,
    val body: String,

    /**
     * Local due date, yyyy-MM-dd.
     */
    val dueDay: String,

    /**
     * Scheduled reminder time in milliseconds.
     */
    val remindAt: Long,

    val latitude: Double,
    val longitude: Double,
    val radius: Float,
) {
    fun toJson(): JSONObject =
        JSONObject()
            .put("id", id)
            .put("title", title)
            .put("body", body)
            .put("dueDay", dueDay)
            .put("remindAt", remindAt)
            .put("latitude", latitude)
            .put("longitude", longitude)
            .put("radius", radius.toDouble())

    companion object {
        fun fromJson(json: JSONObject) =
            GeofenceReminder(
                id = json.getString("id"),
                title = json.getString("title"),
                body = json.optString("body"),
                dueDay = json.getString("dueDay"),

                // Defaults to 0 for reminders saved before this field existed.
                remindAt = json.optLong("remindAt", 0L),

                latitude = json.getDouble("latitude"),
                longitude = json.getDouble("longitude"),
                radius = json.getDouble("radius").toFloat(),
            )
    }
}

/**
 * Persists watched reminders and notification state.
 *
 * This allows native geofence and alarm events to access reminder data
 * without requiring the React Native JavaScript app to be running.
 */
object GeofenceStore {

    private const val PREFS = "reminder_geofences"

    private const val KEY_REMINDERS = "reminders"

    /**
     * Tracks reminders that have already sent their arrival notification.
     */
    private const val KEY_NOTIFIED = "notified"

    /**
     * Tracks reminder locations where the user is currently considered inside.
     */
    private const val KEY_INSIDE = "inside"

    /**
     * Returns today's date in yyyy-MM-dd format.
     */
    fun today(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    private fun prefs(context: Context) =
        context.getSharedPreferences(
            PREFS,
            Context.MODE_PRIVATE,
        )

    /**
     * Save reminders received from the React Native application.
     */
    fun saveReminders(
        context: Context,
        reminders: List<GeofenceReminder>,
    ) {
        val json = JSONArray(
            reminders.map { it.toJson() },
        ).toString()

        prefs(context)
            .edit()
            .putString(KEY_REMINDERS, json)
            .apply()

        pruneNotified(context)

        pruneInside(context, reminders)
    }

    /**
     * Load all saved reminders.
     */
    fun loadReminders(
        context: Context,
    ): List<GeofenceReminder> {
        val raw =
            prefs(context).getString(KEY_REMINDERS, null)
                ?: return emptyList()

        val array = JSONArray(raw)

        return (0 until array.length()).map {
            GeofenceReminder.fromJson(
                array.getJSONObject(it),
            )
        }
    }

    /**
     * Find one reminder by its ID.
     */
    fun findReminder(
        context: Context,
        id: String,
    ): GeofenceReminder? =
        loadReminders(context)
            .firstOrNull { it.id == id }

    /**
     * Notification key for the reminder's due date.
     */
    private fun notifiedKey(
        reminder: GeofenceReminder,
    ): String =
        "${reminder.id}|${reminder.dueDay}"

    /**
     * Check whether an arrival notification has already been sent
     * for this reminder and due date.
     */
    fun wasNotified(
        context: Context,
        reminder: GeofenceReminder,
    ): Boolean =
        prefs(context)
            .getStringSet(KEY_NOTIFIED, emptySet())!!
            .contains(notifiedKey(reminder))

    /**
     * Mark an arrival notification as sent.
     */
    fun markNotified(
        context: Context,
        reminder: GeofenceReminder,
    ) {
        val current =
            prefs(context)
                .getStringSet(KEY_NOTIFIED, emptySet())!!
                .toMutableSet()

        current.add(notifiedKey(reminder))

        prefs(context)
            .edit()
            .putStringSet(KEY_NOTIFIED, current)
            .apply()
    }

    /**
     * Returns true if the user is currently tracked as inside
     * the reminder geofence.
     */
    fun isInside(
        context: Context,
        id: String,
    ): Boolean =
        prefs(context)
            .getStringSet(KEY_INSIDE, emptySet())!!
            .contains(id)

    /**
     * Update the user's inside/outside state for a reminder.
     *
     * ENTER transition: inside = true
     * EXIT transition: inside = false
     */
    fun setInside(
        context: Context,
        id: String,
        inside: Boolean,
    ) {
        val current =
            prefs(context)
                .getStringSet(KEY_INSIDE, emptySet())!!
                .toMutableSet()

        if (inside) {
            current.add(id)
        } else {
            current.remove(id)
        }

        prefs(context)
            .edit()
            .putStringSet(KEY_INSIDE, current)
            .apply()
    }

    /**
     * Remove inside-state entries for reminders that no longer exist.
     */
    private fun pruneInside(
        context: Context,
        reminders: List<GeofenceReminder>,
    ) {
        val validIds =
            reminders.map { it.id }.toSet()

        val current =
            prefs(context)
                .getStringSet(KEY_INSIDE, emptySet())!!
                .toMutableSet()

        val kept =
            current.filter { it in validIds }.toSet()

        if (kept.size != current.size) {
            prefs(context)
                .edit()
                .putStringSet(KEY_INSIDE, kept)
                .apply()
        }
    }

    /**
     * Remove notification records for past due dates.
     */
    private fun pruneNotified(
        context: Context,
    ) {
        val today = today()

        val current =
            prefs(context)
                .getStringSet(KEY_NOTIFIED, emptySet())!!

        val kept =
            current.filter {
                it.substringAfterLast('|') >= today
            }.toSet()

        if (kept.size != current.size) {
            prefs(context)
                .edit()
                .putStringSet(KEY_NOTIFIED, kept)
                .apply()
        }
    }
}
