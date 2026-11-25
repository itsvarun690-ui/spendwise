package com.spendwise.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object AuthSessionStore {
    private const val PREF = "encrypted_supabase_session"
    private const val ALIAS = "spendwise_supabase_session_v1"
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generateKey()
        }
    }
    @Synchronized fun save(context: Context, data: Map<String, String>) {
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key()); val encrypted = c.doFinal(JSONObject(data).toString().toByteArray())
        val packed = ByteBuffer.allocate(c.iv.size + encrypted.size).put(c.iv).put(encrypted).array()
        context.getSharedPreferences(PREF, 0).edit().putString("session", Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
    }
    @Synchronized fun read(context: Context): JSONObject? = try {
        val packed = Base64.decode(context.getSharedPreferences(PREF, 0).getString("session", "") ?: "", Base64.NO_WRAP)
        if (packed.isEmpty()) null else { val b = ByteBuffer.wrap(packed); val iv = ByteArray(12); b.get(iv); val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)); JSONObject(String(c.doFinal(ByteArray(b.remaining()).also(b::get)))) }
    } catch (_: Exception) { null }
    fun isConfigured(context: Context) = read(context) != null
    @Synchronized fun clear(context: Context) { context.getSharedPreferences(PREF, 0).edit().clear().apply() }
}

class ConfirmedDraftWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val session = AuthSessionStore.read(applicationContext) ?: return@withContext Result.failure()
        val rows = SecureCandidateStore.list(applicationContext)
        var retry = false
        for (i in 0 until rows.length()) {
            val item = rows.optJSONObject(i) ?: continue
            if (item.optString("state") != "proceed_queued") continue
            // A phone can change Spendwise accounts. Never sync one user's consented
            // draft using another user's authenticated session.
            if (item.optString("confirmedUserId") != session.optString("userId")) continue
            if (item.optString("status") == "reconciliation"
                || (item.optString("status") != "confirmed_debit" && !item.optBoolean("confirmedByUser", false))) continue
            try {
                var token = session.getString("accessToken")
                if (token.isNullOrBlank()) token = refresh(session)
                val draft = item.optJSONObject("confirmedDraft") ?: continue
                // The fingerprint is generated locally from the UPI reference when present,
                // or the conservative fallback identity; the RPC ledger makes retries atomic.
                val payload = JSONObject()
                    .put("p_idempotency_key", item.optString("fingerprint"))
                    .put("p_category_id", draft.optString("category_id").takeIf { it.isNotBlank() })
                    .put("p_amount", draft.getDouble("amount"))
                    .put("p_spent_on", draft.getString("spent_on"))
                    .put("p_payment_method", draft.getString("payment_method"))
                    .put("p_description", draft.optString("description"))
                val url = session.getString("supabaseUrl").trimEnd('/') + "/rest/v1/rpc/save_detected_expense"
                val code = request(url, "POST", session.getString("publishableKey"), token!!, payload.toString(), "return=representation")
                if (code in 200..299) SecureCandidateStore.decide(applicationContext, item.optString("id"), "saved") else if (code == 401) { refresh(session); retry = true } else if (code >= 500) retry = true
                // Keep confirmed drafts in proceed_queued on terminal 4xx too. A schema,
                // validation, or expired-auth issue must not silently discard user intent.
            } catch (_: Exception) { retry = true }
        }
        if (retry) Result.retry() else Result.success()
    }
    private fun refresh(session: JSONObject): String {
        val base = session.getString("supabaseUrl").trimEnd('/')
        val body = JSONObject().put("refresh_token", session.getString("refreshToken")).toString()
        val conn = URL("$base/auth/v1/token?grant_type=refresh_token").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"; conn.doOutput = true; conn.connectTimeout = 15000; conn.readTimeout = 15000
        conn.setRequestProperty("Content-Type", "application/json"); conn.setRequestProperty("apikey", session.getString("publishableKey")); conn.outputStream.use { it.write(body.toByteArray()) }
        val code = conn.responseCode
        if (code !in 200..299) throw IllegalStateException("Session refresh failed")
        val fresh = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
        session.put("accessToken", fresh.getString("access_token")); session.put("refreshToken", fresh.optString("refresh_token", session.getString("refreshToken")))
        AuthSessionStore.save(applicationContext, mapOf("supabaseUrl" to session.getString("supabaseUrl"), "publishableKey" to session.getString("publishableKey"), "accessToken" to session.getString("accessToken"), "refreshToken" to session.getString("refreshToken"), "userId" to session.getString("userId")))
        return session.getString("accessToken")
    }
    private fun request(url: String, method: String, key: String, token: String, body: String, prefer: String): Int {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method; conn.doOutput = true; conn.connectTimeout = 15000; conn.readTimeout = 15000
        conn.setRequestProperty("Content-Type", "application/json"); conn.setRequestProperty("apikey", key); conn.setRequestProperty("Authorization", "Bearer $token"); conn.setRequestProperty("Prefer", prefer)
        conn.outputStream.use { it.write(body.toByteArray()) }; return conn.responseCode
    }
}
