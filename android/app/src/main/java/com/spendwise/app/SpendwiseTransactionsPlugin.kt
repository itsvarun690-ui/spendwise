
package com.spendwise.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "SpendwiseTransactions",
    permissions = [
        Permission(
            alias = "sms",
            strings = [Manifest.permission.RECEIVE_SMS]
        )
    ]
)
class SpendwiseTransactionsPlugin : Plugin() {

    @PluginMethod
    fun getCandidates(call: PluginCall) {
        val prefs = context.getSharedPreferences("detection", 0)
        val sources = JSArray()

        prefs.getStringSet("packages", emptySet())?.forEach {
            sources.put(it)
        }

        call.resolve(
            JSObject()
                .put("candidates", SecureCandidateStore.list(context))
                .put("paused", SecureCandidateStore.paused(context))
                .put("selectedSources", sources)
                .put(
                    "smsEnabled",
                    SecureCandidateStore.smsEnabled(context) &&
                        getPermissionState("sms") == PermissionState.GRANTED
                )
        )
    }

    @PluginMethod
    fun skip(call: PluginCall) = decide(call, "skipped")

    @PluginMethod
    fun markSaved(call: PluginCall) = decide(call, "saved")

    private fun decide(call: PluginCall, state: String) {
        val id = call.getString("id")

        if (id.isNullOrBlank()) {
            call.reject("Missing candidate ID")
            return
        }

        SecureCandidateStore.decide(context, id, state)
        call.resolve()
    }

    @PluginMethod
    fun queueConfirmed(call: PluginCall) {
        val id = call.getString("id")
        val draft = call.getObject("draft")
        val userId = call.getString("userId")
        val userValidated = call.getBoolean("userValidated") ?: false

        if (id.isNullOrBlank() || draft == null || userId.isNullOrBlank()) {
            call.reject("Missing candidate, user, or confirmed draft")
            return
        }

        SecureCandidateStore.queueConfirmed(
            context,
            id,
            draft,
            userId,
            userValidated
        )

        if (AuthSessionStore.isConfigured(context)) {
            val request =
                OneTimeWorkRequestBuilder<ConfirmedDraftWorker>()
                    .setConstraints(
                        Constraints.Builder()
                            .setRequiredNetworkType(NetworkType.CONNECTED)
                            .build()
                    )
                    .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                "spendwise-confirmed-drafts",
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request
            )
        }

        call.resolve()
    }

    @PluginMethod
    fun configure(call: PluginCall) {
        val prefs = context.getSharedPreferences("detection", 0)

        val paused = call.getBoolean("paused") ?: true
        val smsEnabled =
            call.getBoolean("smsEnabled")
                ?: prefs.getBoolean("sms_enabled", false)

        val packages = call.getArray("packages") ?: JSArray()
        val approved = mutableSetOf<String>()

        for (i in 0 until packages.length()) {
            packages.optString(i)
                ?.takeIf { it in TransactionParser.supportedPackages }
                ?.let(approved::add)
        }

        prefs.edit()
            .putBoolean("paused", paused)
            .putStringSet("packages", approved)
            .putBoolean(
                "sms_enabled",
                smsEnabled &&
                    getPermissionState("sms") == PermissionState.GRANTED
            )
            .apply()

        if (
            !paused &&
            Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            activity.requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                8502
            )
        }

        if (
            smsEnabled &&
            getPermissionState("sms") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias(
                "sms",
                call,
                "smsPermissionCallback"
            )
            return
        }

        val sources = JSArray()
        approved.forEach { sources.put(it) }

        call.resolve(
            JSObject()
                .put("paused", paused)
                .put("selectedSources", sources)
                .put(
                    "smsEnabled",
                    smsEnabled &&
                        getPermissionState("sms") == PermissionState.GRANTED
                )
        )
    }

    @PermissionCallback
    private fun smsPermissionCallback(call: PluginCall) {
        val granted =
            getPermissionState("sms") == PermissionState.GRANTED

        val requestedSmsEnabled =
            call.getBoolean("smsEnabled") ?: false

        context.getSharedPreferences("detection", 0)
            .edit()
            .putBoolean(
                "sms_enabled",
                granted && requestedSmsEnabled
            )
            .apply()

        val prefs = context.getSharedPreferences("detection", 0)
        val sources = JSArray()

        prefs.getStringSet("packages", emptySet())?.forEach {
            sources.put(it)
        }

        call.resolve(
            JSObject()
                .put("paused", prefs.getBoolean("paused", true))
                .put("selectedSources", sources)
                .put(
                    "smsEnabled",
                    granted && prefs.getBoolean("sms_enabled", false)
                )
        )
    }

    @PluginMethod
    fun getLaunchCandidate(call: PluginCall) {
        val id = activity.intent?.getStringExtra("candidate_id")

        if (id != null) {
            activity.intent?.removeExtra("candidate_id")
        }

        call.resolve(JSObject().put("candidateId", id))
    }

    @PluginMethod
    fun setAuthSession(call: PluginCall) {
        val fields = listOf(
            "supabaseUrl",
            "publishableKey",
            "accessToken",
            "refreshToken",
            "userId"
        ).associateWith { call.getString(it) }

        if (fields.values.any { it.isNullOrBlank() }) {
            call.reject(
                "Supabase URL, publishable key, tokens and authenticated user ID are required"
            )
            return
        }

        try {
            AuthSessionStore.save(
                context,
                fields.mapValues { it.value!! }
            )

            enqueueConfirmedDrafts()
            call.resolve()
        } catch (e: Exception) {
            call.reject("Unable to securely store session", e)
        }
    }

    @PluginMethod
    fun clearAuthSession(call: PluginCall) {
        AuthSessionStore.clear(context)
        call.resolve()
    }

    @PluginMethod
    fun getAuthSession(call: PluginCall) {
        val stored = AuthSessionStore.read(context)
        val result = JSObject()

        if (stored != null) {
            result.put("accessToken", stored.optString("accessToken"))
            result.put("refreshToken", stored.optString("refreshToken"))
        }

        call.resolve(result)
    }

    private fun enqueueConfirmedDrafts() {
        val request =
            OneTimeWorkRequestBuilder<ConfirmedDraftWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "spendwise-confirmed-drafts",
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request
        )
    }

    @PluginMethod
    fun openNotificationAccess(call: PluginCall) {
        try {
            activity.startActivity(
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            )
            call.resolve()
        } catch (e: Exception) {
            call.reject(
                "Unable to open Android notification access settings",
                e
            )
        }
    }
}
