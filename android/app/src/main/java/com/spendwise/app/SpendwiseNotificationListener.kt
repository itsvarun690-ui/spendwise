package com.spendwise.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.net.Uri
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object SecureCandidateStore {
    private const val PREF = "encrypted_candidates"
    private const val KEY_ALIAS = "spendwise_tx_queue_v1"
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generateKey()
        }
    }
    private fun prefs(context: Context) = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
    private fun read(context: Context): JSONArray = try {
        val packed = Base64.decode(prefs(context).getString("q", "") ?: "", Base64.NO_WRAP)
        if (packed.isEmpty()) JSONArray() else {
            val input = ByteBuffer.wrap(packed); val iv = ByteArray(12); input.get(iv)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            JSONArray(String(cipher.doFinal(ByteArray(input.remaining()).also(input::get)), Charsets.UTF_8))
        }
    } catch (_: Exception) { JSONArray() }
    @Synchronized fun list(context: Context): JSONArray = read(context)
    @Synchronized fun add(context: Context, item: Candidate): Boolean {
        val rows = read(context)
        val duplicate = (0 until rows.length()).any { index ->
            val prior = rows.optJSONObject(index) ?: return@any false
            if (prior.optString("fingerprint") == item.fingerprint) return@any true
            if (item.reference.isNotBlank() || prior.optString("reference").isNotBlank()) return@any false
            val priorTime = prior.optLong("event_time", 0L)
            val sameMerchant = prior.optString("merchant").trim().equals(item.merchant.trim(), ignoreCase = true)
            val sameAmount = prior.optString("amount") == item.amount
            sameMerchant && sameAmount && priorTime > 0 && kotlin.math.abs(priorTime - item.eventTime) <= 120_000L
        }
        if (duplicate) return false
        rows.put(JSONObject().put("id", item.id).put("amount", item.amount).put("merchant", item.merchant).put("spent_on", item.spentOn).put("bank", item.bank)
            .put("reference", item.reference).put("source", item.source).put("status", item.status).put("fingerprint", item.fingerprint)
            .put("event_time", item.eventTime).put("source_label", item.source).put("state", "pending"))
        write(context, rows); return true
    }
    @Synchronized fun decide(context: Context, id: String, state: String) {
        val rows = read(context)
        for (i in 0 until rows.length()) if (rows.optJSONObject(i)?.optString("id") == id) rows.getJSONObject(i).put("state", state)
        write(context, rows)
    }
    @Synchronized fun queueConfirmed(context: Context, id: String, draft: JSONObject, userId: String, userValidated: Boolean) {
        val rows = read(context)
        for (i in 0 until rows.length()) rows.optJSONObject(i)?.takeIf { it.optString("id") == id && it.optString("status") != "reconciliation" && (it.optString("status") == "confirmed_debit" || userValidated) }?.apply {
            put("state", "proceed_queued"); put("confirmedDraft", draft); put("confirmedUserId", userId); put("confirmedByUser", userValidated)
        }
        write(context, rows)
    }
    private fun write(context: Context, rows: JSONArray) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(rows.toString().toByteArray(Charsets.UTF_8))
        val packed = ByteBuffer.allocate(cipher.iv.size + encrypted.size).put(cipher.iv).put(encrypted).array()
        prefs(context).edit().putString("q", Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
    }
    fun paused(context: Context) = context.getSharedPreferences("detection", Context.MODE_PRIVATE).getBoolean("paused", true)
    fun enabled(context: Context) = !paused(context)
    fun smsEnabled(context: Context) = context.getSharedPreferences("detection", Context.MODE_PRIVATE).getBoolean("sms_enabled", false)
}

class SpendwiseNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (!SecureCandidateStore.enabled(this)) return
        val selected = getSharedPreferences("detection", MODE_PRIVATE).getStringSet("packages", emptySet()) ?: emptySet()
        if (sbn.packageName !in TransactionParser.supportedPackages || sbn.packageName !in selected) return
        val extras = sbn.notification.extras ?: return
        // Extract only in memory after package allowlist check. Original text is never retained.
        val text = listOf(extras.getCharSequence(Notification.EXTRA_TITLE), extras.getCharSequence(Notification.EXTRA_TEXT), extras.getCharSequence(Notification.EXTRA_BIG_TEXT))
            .filterNotNull().joinToString(" ").take(1200)
        if (text.isBlank()) return
        if (sbn.packageName == "com.google.android.apps.messaging"
            && !Regex("\\b(sbi|state bank of india|sbibnk|sbiupi)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)) return
        val candidate = TransactionParser.parse(text, sbn.packageName, sbn.postTime) ?: return
        if (SecureCandidateStore.add(this, candidate) && candidate.status == "confirmed_debit") postAlert(candidate)
    }
    companion object {
        fun postAlert(context: Context, c: Candidate) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("detected_payments", "Payment review", NotificationManager.IMPORTANCE_DEFAULT))
            val intent = Intent(context, MainActivity::class.java).setAction("com.spendwise.REVIEW").setData(Uri.parse("spendwise://review/${c.id}")).putExtra("candidate_id", c.id).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val pi = PendingIntent.getActivity(context, c.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, "detected_payments") else Notification.Builder(context)
            manager.notify(c.id.hashCode(), builder.setSmallIcon(com.spendwise.app.R.mipmap.ic_launcher).setContentTitle("Payment detected — Add expense?")
                .setContentText("₹${c.amount} paid${if (c.merchant.isNotBlank()) " to ${c.merchant}" else ""}.").setContentIntent(pi).setAutoCancel(true).build())
        }
    }
}

class SpendwiseSmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION || !SecureCandidateStore.smsEnabled(context) || SecureCandidateStore.paused(context)) return
        val messages = try { Telephony.Sms.Intents.getMessagesFromIntent(intent) } catch (_: Exception) { return }
        val parts = messages.groupBy { it.originatingAddress.orEmpty() }
        for ((sender, group) in parts) {
            // SBI transaction sender IDs commonly use SBI/SBIBNK/SBIINB/SBIPSG; reject all other senders.
            if (!sender.uppercase().matches(Regex("(?:[A-Z]{2}-)?SBI[A-Z0-9]{0,10}(?:-[A-Z])?"))) continue
            val text = group.joinToString("") { it.messageBody.orEmpty() }.take(1200)
            val eventTime = group.maxOfOrNull { it.timestampMillis } ?: System.currentTimeMillis()
            val candidate = TransactionParser.parse(text, "com.google.android.apps.messaging", eventTime, "sbi_sms") ?: continue
            if (SecureCandidateStore.add(context, candidate) && candidate.status == "confirmed_debit") SpendwiseNotificationListener.postAlert(context, candidate)
        }
    }
}
