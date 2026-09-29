package com.dlck.lnch.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.IOException

private val Context.appStateDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "dlck_lnch_app_state",
)

@Serializable
data class UsageStat(
    val launchCount: Int = 0,
    val lastLaunchedAt: Long = 0L,
)

/**
 * Favourites, pins, hidden apps and DLCK LNCH's own launch history.
 *
 * The launch history is recorded locally by the launcher itself, which is why "Recently used"
 * works with **zero** extra permissions. The optional PACKAGE_USAGE_STATS permission only makes
 * the list richer (apps opened from outside the launcher).
 */
class AppStateRepository(private val context: Context) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private object Keys {
        val favorites = stringPreferencesKey("favorites")
        val pinned = stringPreferencesKey("pinned")
        val hidden = stringPreferencesKey("hidden")
        val usage = stringPreferencesKey("usage")
    }

    data class AppState(
        val favorites: List<String> = emptyList(),
        val pinned: Set<String> = emptySet(),
        val hidden: Set<String> = emptySet(),
        val usage: Map<String, UsageStat> = emptyMap(),
    )

    val state: Flow<AppState> = context.appStateDataStore.data
        .catch { throwable ->
            if (throwable is IOException) emit(emptyPreferences()) else throw throwable
        }
        .map { prefs ->
            AppState(
                favorites = prefs[Keys.favorites].decodeList(),
                pinned = prefs[Keys.pinned].decodeList().toSet(),
                hidden = prefs[Keys.hidden].decodeList().toSet(),
                usage = prefs[Keys.usage].decodeUsage(),
            )
        }

    private fun String?.decodeList(): List<String> =
        if (this.isNullOrBlank()) emptyList()
        else runCatching { json.decodeFromString<List<String>>(this) }.getOrDefault(emptyList())

    private fun String?.decodeUsage(): Map<String, UsageStat> =
        if (this.isNullOrBlank()) emptyMap()
        else runCatching { json.decodeFromString<Map<String, UsageStat>>(this) }
            .getOrDefault(emptyMap())

    suspend fun toggleFavorite(key: String) = context.appStateDataStore.edit { prefs ->
        val current = prefs[Keys.favorites].decodeList().toMutableList()
        if (!current.remove(key)) current.add(key)
        prefs[Keys.favorites] = json.encodeToString(current)
    }

    suspend fun setFavorites(keys: List<String>) = context.appStateDataStore.edit { prefs ->
        prefs[Keys.favorites] = json.encodeToString(keys)
    }

    suspend fun togglePinned(key: String) = context.appStateDataStore.edit { prefs ->
        val current = prefs[Keys.pinned].decodeList().toMutableSet()
        if (!current.remove(key)) current.add(key)
        prefs[Keys.pinned] = json.encodeToString(current.toList())
    }

    suspend fun toggleHidden(key: String) = context.appStateDataStore.edit { prefs ->
        val current = prefs[Keys.hidden].decodeList().toMutableSet()
        if (!current.remove(key)) current.add(key)
        prefs[Keys.hidden] = json.encodeToString(current.toList())
    }

    suspend fun recordLaunch(key: String, now: Long = System.currentTimeMillis()) =
        context.appStateDataStore.edit { prefs ->
            val usage = prefs[Keys.usage].decodeUsage().toMutableMap()
            val existing = usage[key] ?: UsageStat()
            usage[key] = existing.copy(
                launchCount = existing.launchCount + 1,
                lastLaunchedAt = now,
            )
            // Keep the map small: only the 80 most recently used entries survive.
            val trimmed = usage.entries
                .sortedByDescending { it.value.lastLaunchedAt }
                .take(80)
                .associate { it.key to it.value }
            prefs[Keys.usage] = json.encodeToString(trimmed)
        }

    suspend fun clearUsage() = context.appStateDataStore.edit { it.remove(Keys.usage) }

    suspend fun resetAll() = context.appStateDataStore.edit { it.clear() }
}
