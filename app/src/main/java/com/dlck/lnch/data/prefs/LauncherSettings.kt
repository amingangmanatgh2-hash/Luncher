package com.dlck.lnch.data.prefs

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

enum class ThemeMode { SYSTEM, LIGHT, DARK }

enum class AppLanguage(val tag: String?) {
    SYSTEM(null),
    ENGLISH("en"),
    PERSIAN("fa"),
}

/** Ordering applied to the app drawer list. */
enum class DrawerSort { NAME_ASC, NAME_DESC, MOST_USED, NEWEST }

/**
 * What a home-screen gesture does. Every entry maps to something the launcher can perform with a
 * plain, safe API — there is deliberately no "run command" style action.
 */
enum class GestureAction {
    NONE,
    APP_DRAWER,
    SEARCH,
    ASSISTANT,
    SETTINGS,
    WALLPAPER,
    AI_SETUP,
}

enum class AccentColor(val seed: Color) {
    CYAN(Color(0xFF22D3EE)),
    VIOLET(Color(0xFF8B5CF6)),
    EMERALD(Color(0xFF10B981)),
    AMBER(Color(0xFFF59E0B)),
    ROSE(Color(0xFFF43F5E)),
    BLUE(Color(0xFF3B82F6)),
}

@Immutable
data class LauncherSettings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val dynamicColor: Boolean = true,
    val accent: AccentColor = AccentColor.CYAN,
    val language: AppLanguage = AppLanguage.SYSTEM,

    val drawerSort: DrawerSort = DrawerSort.NAME_ASC,

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

    /** Package name of the installed icon pack to theme icons with; blank = stock icons. */
    val iconPack: String = "",
    /** Unread-notification dots on icons (needs the notification-listener permission). */
    val showBadges: Boolean = true,
    /** Home-screen widgets row. */
    val showWidgets: Boolean = true,

    val swipeUpAction: GestureAction = GestureAction.APP_DRAWER,
    val swipeDownAction: GestureAction = GestureAction.SEARCH,
    val doubleTapAction: GestureAction = GestureAction.ASSISTANT,
) {
    val drawerColumns: Int get() = gridColumns.coerceIn(3, 6)
    val favoritesCapacity: Int get() = drawerColumns * favoritesRows.coerceIn(1, 3)
}
