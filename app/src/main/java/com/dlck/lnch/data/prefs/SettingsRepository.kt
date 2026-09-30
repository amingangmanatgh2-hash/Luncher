package com.dlck.lnch.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "dlck_lnch_settings",
)

/**
 * Persisted launcher preferences. Nothing sensitive is stored here — the Gemini credential lives
 * in [com.dlck.lnch.data.secure.CredentialStore] instead.
 */
class SettingsRepository(private val context: Context) {

    private object Keys {
        val themeMode = stringPreferencesKey("theme_mode")
        val dynamicColor = booleanPreferencesKey("dynamic_color")
        val accent = stringPreferencesKey("accent")
        val language = stringPreferencesKey("language")
        val drawerSort = stringPreferencesKey("drawer_sort")
        val gridColumns = intPreferencesKey("grid_columns")
        val iconSize = intPreferencesKey("icon_size")
        val showLabels = booleanPreferencesKey("show_labels")
        val backgroundDim = floatPreferencesKey("background_dim")
        val animations = booleanPreferencesKey("animations")
        val showClock = booleanPreferencesKey("show_clock")
        val showDate = booleanPreferencesKey("show_date")
        val showSearchBar = booleanPreferencesKey("show_search")
        val showRecent = booleanPreferencesKey("show_recent")
        val showSuggestions = booleanPreferencesKey("show_suggestions")
        val clock24 = booleanPreferencesKey("clock_24h")
        val persianDate = booleanPreferencesKey("persian_date")
        val favoritesRows = intPreferencesKey("favorites_rows")
        val geminiModel = stringPreferencesKey("gemini_model")
        val iconPack = stringPreferencesKey("icon_pack")
        val showBadges = booleanPreferencesKey("show_badges")
        val showWidgets = booleanPreferencesKey("show_widgets")
        val swipeUp = stringPreferencesKey("gesture_swipe_up")
        val swipeDown = stringPreferencesKey("gesture_swipe_down")
        val doubleTap = stringPreferencesKey("gesture_double_tap")
    }

    val settings: Flow<LauncherSettings> = context.settingsDataStore.data
        .catch { throwable ->
            if (throwable is IOException) emit(emptyPreferences()) else throw throwable
        }
        .map { prefs -> prefs.toSettings() }

    private fun Preferences.toSettings(): LauncherSettings {
        val defaults = LauncherSettings()
        return LauncherSettings(
            themeMode = this[Keys.themeMode]?.toEnum<ThemeMode>() ?: defaults.themeMode,
            dynamicColor = this[Keys.dynamicColor] ?: defaults.dynamicColor,
            accent = this[Keys.accent]?.toEnum<AccentColor>() ?: defaults.accent,
            language = this[Keys.language]?.toEnum<AppLanguage>() ?: defaults.language,
            drawerSort = this[Keys.drawerSort]?.toEnum<DrawerSort>() ?: defaults.drawerSort,
            gridColumns = this[Keys.gridColumns] ?: defaults.gridColumns,
            iconSizeDp = this[Keys.iconSize] ?: defaults.iconSizeDp,
            showLabels = this[Keys.showLabels] ?: defaults.showLabels,
            backgroundDim = this[Keys.backgroundDim] ?: defaults.backgroundDim,
            animationsEnabled = this[Keys.animations] ?: defaults.animationsEnabled,
            showClock = this[Keys.showClock] ?: defaults.showClock,
            showDate = this[Keys.showDate] ?: defaults.showDate,
            showSearchBar = this[Keys.showSearchBar] ?: defaults.showSearchBar,
            showRecent = this[Keys.showRecent] ?: defaults.showRecent,
            showSuggestions = this[Keys.showSuggestions] ?: defaults.showSuggestions,
            use24HourClock = this[Keys.clock24] ?: defaults.use24HourClock,
            persianDate = this[Keys.persianDate] ?: defaults.persianDate,
            favoritesRows = this[Keys.favoritesRows] ?: defaults.favoritesRows,
            geminiModel = this[Keys.geminiModel] ?: defaults.geminiModel,
            iconPack = this[Keys.iconPack] ?: defaults.iconPack,
            showBadges = this[Keys.showBadges] ?: defaults.showBadges,
            showWidgets = this[Keys.showWidgets] ?: defaults.showWidgets,
            swipeUpAction = this[Keys.swipeUp]?.toEnum<GestureAction>() ?: defaults.swipeUpAction,
            swipeDownAction = this[Keys.swipeDown]?.toEnum<GestureAction>()
                ?: defaults.swipeDownAction,
            doubleTapAction = this[Keys.doubleTap]?.toEnum<GestureAction>()
                ?: defaults.doubleTapAction,
        )
    }

    private inline fun <reified T : Enum<T>> String.toEnum(): T? =
        runCatching { enumValueOf<T>(this@toEnum) }.getOrNull()

    private suspend fun edit(block: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        context.settingsDataStore.edit(block)
    }

    suspend fun setThemeMode(mode: ThemeMode) = edit { it[Keys.themeMode] = mode.name }
    suspend fun setDynamicColor(enabled: Boolean) = edit { it[Keys.dynamicColor] = enabled }
    suspend fun setAccent(accent: AccentColor) = edit { it[Keys.accent] = accent.name }
    suspend fun setLanguage(language: AppLanguage) = edit { it[Keys.language] = language.name }
    suspend fun setDrawerSort(sort: DrawerSort) = edit { it[Keys.drawerSort] = sort.name }
    suspend fun setGridColumns(value: Int) = edit { it[Keys.gridColumns] = value.coerceIn(3, 6) }
    suspend fun setIconSize(value: Int) = edit { it[Keys.iconSize] = value.coerceIn(40, 80) }
    suspend fun setShowLabels(value: Boolean) = edit { it[Keys.showLabels] = value }
    suspend fun setBackgroundDim(value: Float) = edit { it[Keys.backgroundDim] = value.coerceIn(0f, 0.9f) }
    suspend fun setAnimations(value: Boolean) = edit { it[Keys.animations] = value }
    suspend fun setShowClock(value: Boolean) = edit { it[Keys.showClock] = value }
    suspend fun setShowDate(value: Boolean) = edit { it[Keys.showDate] = value }
    suspend fun setShowSearchBar(value: Boolean) = edit { it[Keys.showSearchBar] = value }
    suspend fun setShowRecent(value: Boolean) = edit { it[Keys.showRecent] = value }
    suspend fun setShowSuggestions(value: Boolean) = edit { it[Keys.showSuggestions] = value }
    suspend fun setClock24(value: Boolean) = edit { it[Keys.clock24] = value }
    suspend fun setPersianDate(value: Boolean) = edit { it[Keys.persianDate] = value }
    suspend fun setFavoritesRows(value: Int) = edit { it[Keys.favoritesRows] = value.coerceIn(1, 3) }
    suspend fun setGeminiModel(model: String) = edit { it[Keys.geminiModel] = model }
    suspend fun setIconPack(packageName: String) = edit { it[Keys.iconPack] = packageName }
    suspend fun setShowBadges(value: Boolean) = edit { it[Keys.showBadges] = value }
    suspend fun setShowWidgets(value: Boolean) = edit { it[Keys.showWidgets] = value }
    suspend fun setSwipeUpAction(a: GestureAction) = edit { it[Keys.swipeUp] = a.name }
    suspend fun setSwipeDownAction(a: GestureAction) = edit { it[Keys.swipeDown] = a.name }
    suspend fun setDoubleTapAction(a: GestureAction) = edit { it[Keys.doubleTap] = a.name }

    suspend fun resetAll() = context.settingsDataStore.edit { it.clear() }
}
