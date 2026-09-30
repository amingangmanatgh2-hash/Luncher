package com.dlck.lnch.data.backup

import com.dlck.lnch.data.prefs.AccentColor
import com.dlck.lnch.data.prefs.AppLanguage
import com.dlck.lnch.data.prefs.AppStateRepository
import com.dlck.lnch.data.prefs.DrawerSort
import com.dlck.lnch.data.prefs.FolderData
import com.dlck.lnch.data.prefs.GestureAction
import com.dlck.lnch.data.prefs.LauncherSettings
import com.dlck.lnch.data.prefs.SettingsRepository
import com.dlck.lnch.data.prefs.ThemeMode
import com.dlck.lnch.data.prefs.UsageStat
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * The on-disk shape of a DLCK LNCH backup.
 *
 * Everything is plain, human-readable JSON with defaults on every field, so a file written by an
 * older (or newer) build still restores what it can instead of failing. **No credential is ever
 * included** — the Gemini API key lives in EncryptedSharedPreferences and is deliberately left
 * out of the export.
 */
@Serializable
data class BackupFile(
    val format: Int = BackupCodec.FORMAT_VERSION,
    val app: String = "DLCK LNCH",
    val createdAt: Long = 0L,
    val settings: SettingsSnapshot = SettingsSnapshot(),
    val favorites: List<String> = emptyList(),
    val pinned: List<String> = emptyList(),
    val hidden: List<String> = emptyList(),
    val folders: List<FolderData> = emptyList(),
    val usage: Map<String, UsageStat> = emptyMap(),
)

/** Settings are stored by name so an added or removed enum entry cannot corrupt a restore. */
@Serializable
data class SettingsSnapshot(
    val themeMode: String = ThemeMode.SYSTEM.name,
    val dynamicColor: Boolean = true,
    val accent: String = AccentColor.CYAN.name,
    val language: String = AppLanguage.SYSTEM.name,
    val drawerSort: String = DrawerSort.NAME_ASC.name,
    val gridColumns: Int = 4,
    val iconSizeDp: Int = 56,
    val showLabels: Boolean = true,
    val backgroundDim: Float = 0.45f,
    val animationsEnabled: Boolean = true,
    val showClock: Boolean = true,
    val showDate: Boolean = true,
    val showSearchBar: Boolean = true,
    val showRecent: Boolean = true,
    val showSuggestions: Boolean = true,
    val use24HourClock: Boolean = true,
    val persianDate: Boolean = false,
    val favoritesRows: Int = 2,
    val geminiModel: String = "gemini-2.5-flash",
    val iconPack: String = "",
    val showBadges: Boolean = true,
    val showWidgets: Boolean = true,
    val swipeUpAction: String = GestureAction.APP_DRAWER.name,
    val swipeDownAction: String = GestureAction.SEARCH.name,
    val doubleTapAction: String = GestureAction.ASSISTANT.name,
)

/**
 * Pure conversion between the live state and the backup file — no Android, no I/O, unit-tested.
 */
object BackupCodec {

    const val FORMAT_VERSION = 1

    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = true
    }

    fun snapshot(settings: LauncherSettings): SettingsSnapshot = SettingsSnapshot(
        themeMode = settings.themeMode.name,
        dynamicColor = settings.dynamicColor,
        accent = settings.accent.name,
        language = settings.language.name,
        drawerSort = settings.drawerSort.name,
        gridColumns = settings.gridColumns,
        iconSizeDp = settings.iconSizeDp,
        showLabels = settings.showLabels,
        backgroundDim = settings.backgroundDim,
        animationsEnabled = settings.animationsEnabled,
        showClock = settings.showClock,
        showDate = settings.showDate,
        showSearchBar = settings.showSearchBar,
        showRecent = settings.showRecent,
        showSuggestions = settings.showSuggestions,
        use24HourClock = settings.use24HourClock,
        persianDate = settings.persianDate,
        favoritesRows = settings.favoritesRows,
        geminiModel = settings.geminiModel,
        iconPack = settings.iconPack,
        showBadges = settings.showBadges,
        showWidgets = settings.showWidgets,
        swipeUpAction = settings.swipeUpAction.name,
        swipeDownAction = settings.swipeDownAction.name,
        doubleTapAction = settings.doubleTapAction.name,
    )

    /** Rebuilds settings, falling back to the current value for anything unreadable. */
    fun restore(snapshot: SettingsSnapshot, current: LauncherSettings): LauncherSettings =
        LauncherSettings(
            themeMode = snapshot.themeMode.toEnumOr(current.themeMode),
            dynamicColor = snapshot.dynamicColor,
            accent = snapshot.accent.toEnumOr(current.accent),
            language = snapshot.language.toEnumOr(current.language),
            drawerSort = snapshot.drawerSort.toEnumOr(current.drawerSort),
            gridColumns = snapshot.gridColumns.coerceIn(3, 6),
            iconSizeDp = snapshot.iconSizeDp.coerceIn(40, 80),
            showLabels = snapshot.showLabels,
            backgroundDim = snapshot.backgroundDim.coerceIn(0f, 0.9f),
            animationsEnabled = snapshot.animationsEnabled,
            showClock = snapshot.showClock,
            showDate = snapshot.showDate,
            showSearchBar = snapshot.showSearchBar,
            showRecent = snapshot.showRecent,
            showSuggestions = snapshot.showSuggestions,
            use24HourClock = snapshot.use24HourClock,
            persianDate = snapshot.persianDate,
            favoritesRows = snapshot.favoritesRows.coerceIn(1, 3),
            geminiModel = snapshot.geminiModel.ifBlank { current.geminiModel },
            iconPack = snapshot.iconPack,
            showBadges = snapshot.showBadges,
            showWidgets = snapshot.showWidgets,
            swipeUpAction = snapshot.swipeUpAction.toEnumOr(current.swipeUpAction),
            swipeDownAction = snapshot.swipeDownAction.toEnumOr(current.swipeDownAction),
            doubleTapAction = snapshot.doubleTapAction.toEnumOr(current.doubleTapAction),
        )

    fun build(
        settings: LauncherSettings,
        state: AppStateRepository.AppState,
        now: Long,
    ): BackupFile = BackupFile(
        createdAt = now,
        settings = snapshot(settings),
        favorites = state.favorites,
        pinned = state.pinned.toList().sorted(),
        hidden = state.hidden.toList().sorted(),
        folders = state.folders,
        usage = state.usage,
    )

    fun encode(file: BackupFile): String = json.encodeToString(file)

    /** @return the parsed backup, or null when the text is not a valid DLCK LNCH backup. */
    fun decode(text: String): BackupFile? = runCatching {
        json.decodeFromString<BackupFile>(text)
    }.getOrNull()?.takeIf { it.format in 1..FORMAT_VERSION }

    private inline fun <reified T : Enum<T>> String.toEnumOr(fallback: T): T =
        runCatching { enumValueOf<T>(this) }.getOrDefault(fallback)
}

/**
 * Applies a decoded backup to the real repositories.
 * Kept separate from [BackupCodec] so the conversion logic stays testable without Android.
 */
class BackupManager(
    private val settingsRepository: SettingsRepository,
    private val appStateRepository: AppStateRepository,
) {

    suspend fun export(settings: LauncherSettings, state: AppStateRepository.AppState): String =
        BackupCodec.encode(BackupCodec.build(settings, state, System.currentTimeMillis()))

    /** @return true when the text was a readable backup and has been applied. */
    suspend fun import(text: String, current: LauncherSettings): Boolean {
        val backup = BackupCodec.decode(text) ?: return false
        val restored = BackupCodec.restore(backup.settings, current)

        settingsRepository.setThemeMode(restored.themeMode)
        settingsRepository.setDynamicColor(restored.dynamicColor)
        settingsRepository.setAccent(restored.accent)
        settingsRepository.setLanguage(restored.language)
        settingsRepository.setDrawerSort(restored.drawerSort)
        settingsRepository.setGridColumns(restored.gridColumns)
        settingsRepository.setIconSize(restored.iconSizeDp)
        settingsRepository.setShowLabels(restored.showLabels)
        settingsRepository.setBackgroundDim(restored.backgroundDim)
        settingsRepository.setAnimations(restored.animationsEnabled)
        settingsRepository.setShowClock(restored.showClock)
        settingsRepository.setShowDate(restored.showDate)
        settingsRepository.setShowSearchBar(restored.showSearchBar)
        settingsRepository.setShowRecent(restored.showRecent)
        settingsRepository.setShowSuggestions(restored.showSuggestions)
        settingsRepository.setClock24(restored.use24HourClock)
        settingsRepository.setPersianDate(restored.persianDate)
        settingsRepository.setFavoritesRows(restored.favoritesRows)
        settingsRepository.setGeminiModel(restored.geminiModel)
        settingsRepository.setIconPack(restored.iconPack)
        settingsRepository.setShowBadges(restored.showBadges)
        settingsRepository.setShowWidgets(restored.showWidgets)
        settingsRepository.setSwipeUpAction(restored.swipeUpAction)
        settingsRepository.setSwipeDownAction(restored.swipeDownAction)
        settingsRepository.setDoubleTapAction(restored.doubleTapAction)

        appStateRepository.setFavorites(backup.favorites)
        appStateRepository.setPinned(backup.pinned.toSet())
        appStateRepository.setHidden(backup.hidden.toSet())
        appStateRepository.setFolders(backup.folders)
        appStateRepository.setUsage(backup.usage)
        return true
    }
}
