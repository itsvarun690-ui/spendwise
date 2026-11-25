
package com.spendwise.app

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
}
