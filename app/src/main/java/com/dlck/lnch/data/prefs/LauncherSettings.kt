package com.dlck.lnch.data.prefs

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

enum class ThemeMode { SYSTEM, LIGHT, DARK }

enum class AppLanguage(val tag: String?) {
    SYSTEM(null),
    ENGLISH("en"),
    PERSIAN("fa"),
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

    val gridColumns: Int = 4,
    val iconSizeDp: Int = 56,
    val showLabels: Boolean = true,
    val backgroundDim: Float = 0.45f,
    val animationsEnabled: Boolean = true,

    val showClock: Boolean = true,
    val showDate: Boolean = true,
    val showSearchBar: Boolean = true,
    val showRecent: Boolean = true,
    val use24HourClock: Boolean = true,
    val persianDate: Boolean = false,
    val favoritesRows: Int = 2,

    val geminiModel: String = "gemini-2.5-flash",
) {
    val drawerColumns: Int get() = gridColumns.coerceIn(3, 6)
    val favoritesCapacity: Int get() = drawerColumns * favoritesRows.coerceIn(1, 3)
}
