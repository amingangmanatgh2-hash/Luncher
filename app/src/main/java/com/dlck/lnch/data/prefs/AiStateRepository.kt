package com.dlck.lnch.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.IOException

private val Context.aiDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "dlck_lnch_ai",
)

@Serializable
data class StoredMessage(
    val role: String,
    val text: String,
    val timestamp: Long = 0L,
)

@Serializable
data class AiUsage(
    val totalRequests: Int = 0,
    val totalPromptTokens: Int = 0,
    val totalResponseTokens: Int = 0,
    val lastRequestAt: Long = 0L,
    val failedRequests: Int = 0,
)

/**
 * Chat transcript + local usage counters.
 *
 * The transcript contains only what the user typed and what the model answered. It never
 * contains the credential.
 */
class AiStateRepository(private val context: Context) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private object Keys {
        val history = stringPreferencesKey("chat_history")
        val requests = intPreferencesKey("usage_requests")
        val failures = intPreferencesKey("usage_failures")
        val promptTokens = intPreferencesKey("usage_prompt_tokens")
        val responseTokens = intPreferencesKey("usage_response_tokens")
        val lastRequest = longPreferencesKey("usage_last_request")
    }

    private val data: Flow<Preferences> = context.aiDataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }

    val history: Flow<List<StoredMessage>> = data.map { prefs ->
        val raw = prefs[Keys.history]
        if (raw.isNullOrBlank()) {
            emptyList()
        } else {
            runCatching { json.decodeFromString<List<StoredMessage>>(raw) }
                .getOrDefault(emptyList())
        }
    }

    val usage: Flow<AiUsage> = data.map { prefs ->
        AiUsage(
            totalRequests = prefs[Keys.requests] ?: 0,
            totalPromptTokens = prefs[Keys.promptTokens] ?: 0,
            totalResponseTokens = prefs[Keys.responseTokens] ?: 0,
            lastRequestAt = prefs[Keys.lastRequest] ?: 0L,
            failedRequests = prefs[Keys.failures] ?: 0,
        )
    }

    suspend fun currentUsage(): AiUsage = usage.first()

    suspend fun saveHistory(messages: List<StoredMessage>) = context.aiDataStore.edit { prefs ->
        prefs[Keys.history] = json.encodeToString(messages.takeLast(40))
    }

    suspend fun clearHistory() = context.aiDataStore.edit { it.remove(Keys.history) }

    suspend fun recordRequest(promptTokens: Int, responseTokens: Int) =
        context.aiDataStore.edit { prefs ->
            prefs[Keys.requests] = (prefs[Keys.requests] ?: 0) + 1
            prefs[Keys.promptTokens] = (prefs[Keys.promptTokens] ?: 0) + promptTokens
            prefs[Keys.responseTokens] = (prefs[Keys.responseTokens] ?: 0) + responseTokens
            prefs[Keys.lastRequest] = System.currentTimeMillis()
        }

    suspend fun recordFailure() = context.aiDataStore.edit { prefs ->
        prefs[Keys.failures] = (prefs[Keys.failures] ?: 0) + 1
        prefs[Keys.lastRequest] = System.currentTimeMillis()
    }

    suspend fun resetUsage() = context.aiDataStore.edit { prefs ->
        prefs.remove(Keys.requests)
        prefs.remove(Keys.failures)
        prefs.remove(Keys.promptTokens)
        prefs.remove(Keys.responseTokens)
        prefs.remove(Keys.lastRequest)
    }
}
