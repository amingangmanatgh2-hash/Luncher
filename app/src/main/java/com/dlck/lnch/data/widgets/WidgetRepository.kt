package com.dlck.lnch.data.widgets

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
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.IOException

private val Context.widgetDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "dlck_lnch_widgets",
)

/**
 * One widget placed on the home screen.
 *
 * [appWidgetId] is the id handed out by the system `AppWidgetHost`; it is the only thing that
 * really has to survive a restart, the rest is presentation.
 */
@Serializable
data class WidgetSpec(
    val appWidgetId: Int,
    val provider: String = "",
    val label: String = "",
    val heightDp: Int = DEFAULT_HEIGHT_DP,
) {
    companion object {
        const val DEFAULT_HEIGHT_DP = 110
        const val MIN_HEIGHT_DP = 60
        const val MAX_HEIGHT_DP = 420
    }
}

/** Persists the home-screen widget list (ids + sizes) in its own DataStore file. */
class WidgetRepository(private val context: Context) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private object Keys {
        val widgets = stringPreferencesKey("widgets")
    }

    val widgets: Flow<List<WidgetSpec>> = context.widgetDataStore.data
        .catch { throwable ->
            if (throwable is IOException) emit(emptyPreferences()) else throw throwable
        }
        .map { prefs -> prefs[Keys.widgets].decode() }

    private fun String?.decode(): List<WidgetSpec> =
        if (this.isNullOrBlank()) emptyList()
        else runCatching { json.decodeFromString<List<WidgetSpec>>(this) }
            .getOrDefault(emptyList())

    suspend fun add(spec: WidgetSpec) = context.widgetDataStore.edit { prefs ->
        val current = prefs[Keys.widgets].decode().filterNot { it.appWidgetId == spec.appWidgetId }
        prefs[Keys.widgets] = json.encodeToString(current + spec)
    }

    suspend fun remove(appWidgetId: Int) = context.widgetDataStore.edit { prefs ->
        val current = prefs[Keys.widgets].decode().filterNot { it.appWidgetId == appWidgetId }
        prefs[Keys.widgets] = json.encodeToString(current)
    }

    suspend fun resize(appWidgetId: Int, heightDp: Int) = context.widgetDataStore.edit { prefs ->
        val clamped = heightDp.coerceIn(WidgetSpec.MIN_HEIGHT_DP, WidgetSpec.MAX_HEIGHT_DP)
        val current = prefs[Keys.widgets].decode().map {
            if (it.appWidgetId == appWidgetId) it.copy(heightDp = clamped) else it
        }
        prefs[Keys.widgets] = json.encodeToString(current)
    }

    suspend fun replaceAll(specs: List<WidgetSpec>) = context.widgetDataStore.edit { prefs ->
        prefs[Keys.widgets] = json.encodeToString(specs)
    }

    suspend fun clear() = context.widgetDataStore.edit { it.clear() }
}
