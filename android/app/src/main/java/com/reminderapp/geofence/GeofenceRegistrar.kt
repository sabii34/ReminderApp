
package com.reminderapp.geofence

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * Registers stored reminders with Google Play services.
 *
 * Supports ENTER and EXIT transitions so the application can:
 *
 * 1. Notify when the user enters a reminder location.
 * 2. Track when the user leaves a reminder location.
 * 3. Check whether the user is inside when the scheduled reminder fires.
 *
 * Reminders are not filtered by dueDay here, so overdue reminders
 * can still be registered and processed.
 */
object GeofenceRegistrar {

  private const val TAG = "GeofenceRegistrar"

  /**
   * Google Play services allows at most 100 geofences per application.
   */
  private const val MAX_GEOFENCES = 100

  /**
   * Creates the broadcast PendingIntent used by Google Play services
   * to deliver geofence transition events.
   */
  private fun pendingIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      0,
      Intent(context, GeofenceBroadcastReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or
        (
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE
          } else {
            0
          }
        ),
    )

  /**
   * Checks whether fine location permission is granted.
   */
  fun hasLocationPermission(context: Context): Boolean =
    granted(
      context,
      Manifest.permission.ACCESS_FINE_LOCATION,
    )

  /**
   * Checks whether background location permission is granted.
   *
   * Android 10 and newer require ACCESS_BACKGROUND_LOCATION
   * for geofence events while the application is not in use.
   */
  fun hasBackgroundLocationPermission(context: Context): Boolean =
    hasLocationPermission(context) &&
      (
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
          granted(
            context,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION,
          )
      )

  /**
   * Checks whether the specified permission is granted.
   */
  private fun granted(
    context: Context,
    permission: String,
  ): Boolean =
    ContextCompat.checkSelfPermission(
      context,
      permission,
    ) == PackageManager.PERMISSION_GRANTED

  /**
   * Registers the reminders saved in GeofenceStore.
   *
   * This method:
   *
   * - Loads saved reminders.
   * - Keeps reminders with valid locations.
   * - Registers up to 100 reminders.
   * - Supports ENTER and EXIT transitions.
   * - Does not remove overdue reminders based on dueDay.
   * - Replaces the previously registered geofences.
   *
   * The callback returns the number of registered reminders
   * and an optional error string.
   */
  @SuppressLint("MissingPermission")
  fun registerStored(
    context: Context,
    onDone: (registered: Int, error: String?) -> Unit = { _, _ -> },
  ) {

    val client =
      LocationServices.getGeofencingClient(context)

    val intent =
      pendingIntent(context)

    /**
     * Load reminders from native storage.
     *
     * Do not filter by dueDay here.
     * Overdue reminders must remain eligible for geofence events.
     */
    val watchable =
      GeofenceStore.loadReminders(context)
        .filter {
          it.id.isNotBlank() &&
            it.latitude.isFinite() &&
            it.longitude.isFinite() &&
            it.radius.isFinite() &&
            it.radius > 0f &&
            it.latitude in -90.0..90.0 &&
            it.longitude in -180.0..180.0
        }
        .distinctBy {
          it.id
        }
        .take(MAX_GEOFENCES)

    /**
     * Remove the existing registrations before registering
     * the current reminder list.
     */
    client.removeGeofences(intent)
      .addOnCompleteListener {

        /**
         * No reminders need to be registered.
         */
        if (watchable.isEmpty()) {
          Log.i(
            TAG,
            "No valid reminder areas to register",
          )

          onDone(
            0,
            null,
          )

          return@addOnCompleteListener
        }

        /**
         * Location permission is required before registration.
         */
        if (!hasLocationPermission(context)) {
          Log.w(
            TAG,
            "Location permission is missing",
          )

          onDone(
            0,
            "location_permission_missing",
          )

          return@addOnCompleteListener
        }

        /**
         * Create a geofence for each stored reminder.
         *
         * ENTER:
         * User enters the reminder location.
         *
         * EXIT:
         * User leaves the reminder location.
         */
        val geofences =
          watchable.map { reminder ->

            Geofence.Builder()
              .setRequestId(
                reminder.id,
              )
              .setCircularRegion(
                reminder.latitude,
                reminder.longitude,
                reminder.radius,
              )
              .setExpirationDuration(
                Geofence.NEVER_EXPIRE,
              )
              .setTransitionTypes(
                Geofence.GEOFENCE_TRANSITION_ENTER or
                  Geofence.GEOFENCE_TRANSITION_EXIT,
              )
              .build()
          }

        /**
         * Build the geofencing request.
         *
         * Initial trigger is disabled so registration itself
         * does not generate an immediate ENTER event.
         *
         * Actual ENTER transitions are handled by
         * GeofenceBroadcastReceiver.
         */
        val request =
          GeofencingRequest.Builder()
            .setInitialTrigger(
    Geofence.GEOFENCE_TRANSITION_ENTER,
)
            .addGeofences(
              geofences,
            )
            .build()

        /**
         * Register the reminders with Google Play services.
         */
        client.addGeofences(
          request,
          intent,
        )
          .addOnSuccessListener {

            Log.i(
              TAG,
              "Watching ${watchable.size} reminder area(s)",
            )

            onDone(
              watchable.size,
              null,
            )
          }
          .addOnFailureListener { error ->

            val code =
              (error as? ApiException)?.statusCode

            val reason =
              when (code) {

                GeofenceStatusCodes
                  .GEOFENCE_INSUFFICIENT_LOCATION_PERMISSION ->
                  "background_location_permission_missing"

                GeofenceStatusCodes
                  .GEOFENCE_NOT_AVAILABLE ->
                  "location_services_off"

                else ->
                  error.message ?: "geofence_error"
              }

            Log.w(
              TAG,
              "Could not watch reminder areas: $reason",
              error,
            )

            onDone(
              0,
              reason,
            )
          }
      }
  }
}
