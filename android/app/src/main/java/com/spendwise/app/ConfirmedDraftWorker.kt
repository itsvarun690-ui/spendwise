
package com.spendwise.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
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

        return KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        ).run {
            init(
                KeyGenParameterSpec.Builder(
                    ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            generateKey()
        }
    }

    @Synchronized
    fun save(context: Context, data: Map<String, String>) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = c.doFinal(JSONObject(data).toString().toByteArray())

        val packed = ByteBuffer.allocate(c.iv.size + encrypted.size)
            .put(c.iv)
            .put(encrypted)
            .array()

        context.getSharedPreferences(PREF, 0).edit()
            .putString("session", Base64.encodeToString(packed, Base64.NO_WRAP))
            .apply()
    }

    @Synchronized
    fun read(context: Context): JSONObject? = try {
        val packed = Base64.decode(
            context.getSharedPreferences(PREF, 0).getString("session", "") ?: "",
            Base64.NO_WRAP
        )

        if (packed.isEmpty()) {
            null
        } else {
            val b = ByteBuffer.wrap(packed)
            val iv = ByteArray(12)
            b.get(iv)

            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))

            JSONObject(
                String(c.doFinal(ByteArray(b.remaining()).also(b::get)))
            )
        }
    } catch (_: Exception) {
        null
    }

    fun isConfigured(context: Context) = read(context) != null

    @Synchronized
    fun clear(context: Context) {
        context.getSharedPreferences(PREF, 0).edit().clear().apply()
    }
}
