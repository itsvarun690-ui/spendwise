
package com.spendwise.app

import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SpendwiseTransactions")
class SpendwiseTransactionsPlugin : Plugin() {

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
}
