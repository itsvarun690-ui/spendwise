package com.spendwise.app

import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

internal data class Candidate(
    val id: String,
    val amount: String,
    val merchant: String,
    val spentOn: String,
    val reference: String,
    val bank: String,
    val source: String,
    val status: String,
    val fingerprint: String,
    val eventTime: Long
)

internal object TransactionParser {
    val supportedPackages = setOf(
        "com.sbi.lotusintouch",
        "com.google.android.apps.nbu.paisa.user",
        "money.super.payments",
        "com.google.android.apps.messaging"
    )
    private val outgoing = Regex("\\b(paid|debited|debit|sent|payment\\s+of|purchase)\\b", RegexOption.IGNORE_CASE)
    private val success = Regex("\\b(successful|success|completed|paid|debited)\\b", RegexOption.IGNORE_CASE)
    private val incoming = Regex("\\b(credited|received|deposit|refund|reversed|reversal|reimbursement)\\b", RegexOption.IGNORE_CASE)
    private val failPending = Regex("\\b(failed|declined|pending|processing|scheduled|unsuccessful)\\b", RegexOption.IGNORE_CASE)

    fun parse(text: String, source: String, eventTime: Long, family: String = source): Candidate? {
        if (source !in supportedPackages) return null
        if (Regex("\\b(otp|one[ -]?time[ -]?password|pin|password|passcode)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)) return null
        val sbiContext = source == "com.sbi.lotusintouch" || family == "sbi_sms"
            || Regex("\\b(sbi|state bank of india|sbibnk|sbiupi)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val status = when {
            Regex("\\b(refund|reversed|reversal|chargeback)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "reconciliation"
            failPending.containsMatchIn(text) -> return null
            incoming.containsMatchIn(text) -> return null
            outgoing.containsMatchIn(text) && success.containsMatchIn(text) && sbiContext -> "confirmed_debit"
            else -> "review"
        }
        val amountMatch = Regex("(?:₹|rs\\.?\\s?|inr\\s*)([0-9,]+(?:\\.[0-9]{1,2})?)", RegexOption.IGNORE_CASE).find(text)
            ?: Regex("(?:amount|paid|debited)\\s*(?:of|:)?\\s*₹?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)", RegexOption.IGNORE_CASE).find(text)
        val amount = amountMatch?.groupValues?.get(1)?.replace(",", "")?.toBigDecimalOrNull()
        if (amount == null || amount <= java.math.BigDecimal.ZERO || amount > java.math.BigDecimal("100000000")) return null
        val ref = Regex("(?:upi\\s*ref(?:erence)?|txn(?:\\s*id)?|utr|reference)\\s*(?:no\\.?|:|#)?\\s*([A-Z0-9]{8,})", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1).orEmpty().take(64)
        val merchant = Regex("(?:to|at|towards)\\s+([A-Za-z0-9 .&'-]{2,40})", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)?.trim()?.take(40).orEmpty()
        val normalizedAmount = amount.stripTrailingZeros().toPlainString()
        val roundedTime = (eventTime / 60_000L) * 60_000L
        val normalizedMerchant = merchant.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), " ").trim()
        // A UPI reference is globally useful across app/SMS sources. Without one,
        // use the transaction tuple without package identity to catch cross-source repeats.
        val identity = if (ref.isNotBlank()) "ref|${ref.uppercase(Locale.ROOT)}" else "$normalizedAmount|$normalizedMerchant|$roundedTime"
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        val date = Instant.ofEpochMilli(eventTime).atZone(ZoneId.systemDefault()).toLocalDate().toString()
        val sourceLabel = when {
            family == "sbi_sms" -> "SBI SMS"
            source == "com.sbi.lotusintouch" -> "SBI YONO"
            source == "com.google.android.apps.nbu.paisa.user" -> "Google Pay"
            source == "money.super.payments" -> "Super.money"
            else -> "Android Messages"
        }
        return Candidate(fingerprint, normalizedAmount, merchant, date, ref, if (sbiContext) "SBI" else "Unknown", sourceLabel, status, fingerprint, eventTime)
    }
}
