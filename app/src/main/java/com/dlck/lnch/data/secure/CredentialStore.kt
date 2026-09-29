package com.dlck.lnch.data.secure

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The single place where the Gemini credential lives.
 *
 * Design rules enforced here:
 *  * the key is only ever supplied by the user at runtime — never compiled in, never in Git;
 *  * it is stored in [EncryptedSharedPreferences] (AES-256-GCM, key material in the Android
 *    Keystore, hardware-backed where the device supports it);
 *  * [readKey] is the only accessor and is used exclusively to build the HTTPS request header;
 *  * nothing in this class ever logs, formats or exposes the key value.
 */
class CredentialStore(context: Context) {

    private val appContext = context.applicationContext

    private val prefs: SharedPreferences by lazy { createPrefs() }

    private val _configured = MutableStateFlow(false)
    /** Whether a credential exists. Exposes a boolean only — never the value. */
    val configured: StateFlow<Boolean> = _configured.asStateFlow()

    init {
        _configured.value = runCatching { prefs.contains(KEY_API) && !readKey().isNullOrBlank() }
            .getOrDefault(false)
    }

    private fun createPrefs(): SharedPreferences = try {
        val masterKey = MasterKey.Builder(appContext, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (t: Throwable) {
        // A corrupted keystore entry (e.g. after a restore onto another device) must not brick the
        // launcher. We drop the encrypted file and start over; the user simply re-enters the key.
        Log.w(TAG, "Encrypted store unavailable (${t.javaClass.simpleName}); recreating.")
        runCatching { appContext.deleteSharedPreferences(PREFS_NAME) }
        val masterKey = MasterKey.Builder(appContext, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /** Internal read used only when building an authenticated request. */
    fun readKey(): String? = runCatching { prefs.getString(KEY_API, null) }
        .getOrNull()
        ?.takeIf { it.isNotBlank() }

    fun saveKey(rawKey: String) {
        val cleaned = rawKey.trim()
        prefs.edit().putString(KEY_API, cleaned).putLong(KEY_SAVED_AT, System.currentTimeMillis())
            .apply()
        _configured.value = cleaned.isNotBlank()
    }

    fun clearKey() {
        prefs.edit().remove(KEY_API).remove(KEY_SAVED_AT).remove(KEY_LAST_OK).apply()
        _configured.value = false
    }

    fun hasKey(): Boolean = !readKey().isNullOrBlank()

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL)?.takeIf { it.isNotBlank() }
            ?: DEFAULT_BASE_URL
        set(value) {
            prefs.edit().putString(KEY_BASE_URL, value.trim().trimEnd('/')).apply()
        }

    /** Timestamp of the last successful connection test (0 = never). Safe to display. */
    var lastSuccessfulCheck: Long
        get() = prefs.getLong(KEY_LAST_OK, 0L)
        set(value) {
            prefs.edit().putLong(KEY_LAST_OK, value).apply()
        }

    val savedAt: Long get() = prefs.getLong(KEY_SAVED_AT, 0L)

    /** True when the endpoint is a user-supplied proxy rather than Google directly. */
    val usesCustomEndpoint: Boolean get() = baseUrl != DEFAULT_BASE_URL

    companion object {
        private const val TAG = "CredentialStore"
        private const val PREFS_NAME = "dlck_lnch_secure_prefs"
        private const val KEY_API = "gemini_api_key"
        private const val KEY_BASE_URL = "gemini_base_url"
        private const val KEY_LAST_OK = "gemini_last_ok"
        private const val KEY_SAVED_AT = "gemini_saved_at"
        const val DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"
    }
}
