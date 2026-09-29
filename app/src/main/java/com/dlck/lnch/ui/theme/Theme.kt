package com.dlck.lnch.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import com.dlck.lnch.data.prefs.AccentColor
import com.dlck.lnch.data.prefs.LauncherSettings
import com.dlck.lnch.data.prefs.ThemeMode

private fun Color.shift(factor: Float): Color = Color(
    red = (red * factor).coerceIn(0f, 1f),
    green = (green * factor).coerceIn(0f, 1f),
    blue = (blue * factor).coerceIn(0f, 1f),
    alpha = alpha,
)

private fun darkSchemeFor(accent: AccentColor): ColorScheme {
    val seed = accent.seed
    return darkColorScheme(
        primary = seed,
        onPrimary = Color(0xFF04121A),
        primaryContainer = seed.shift(0.35f),
        onPrimaryContainer = Color(0xFFE6FBFF),
        secondary = seed.shift(0.75f),
        onSecondary = Color(0xFF04121A),
        secondaryContainer = Color(0xFF1B2333),
        onSecondaryContainer = Color(0xFFDCE6F2),
        tertiary = Color(0xFFB794F6),
        background = Color(0xFF080B12),
        onBackground = Color(0xFFECEFF5),
        surface = Color(0xFF0D111A),
        onSurface = Color(0xFFECEFF5),
        surfaceVariant = Color(0xFF1A2130),
        onSurfaceVariant = Color(0xFFB9C2D0),
        outline = Color(0xFF4A5567),
        outlineVariant = Color(0xFF2A3342),
        error = Color(0xFFFF6B6B),
        onError = Color(0xFF2A0000),
        errorContainer = Color(0xFF5C1A1A),
        onErrorContainer = Color(0xFFFFDAD6),
        scrim = Color(0xFF000000),
    )
}

private fun lightSchemeFor(accent: AccentColor): ColorScheme {
    val seed = accent.seed
    return lightColorScheme(
        primary = seed.shift(0.72f),
        onPrimary = Color.White,
        primaryContainer = seed.shift(1.25f).copy(alpha = 1f),
        onPrimaryContainer = Color(0xFF04121A),
        secondary = seed.shift(0.6f),
        onSecondary = Color.White,
        secondaryContainer = Color(0xFFE3EAF3),
        onSecondaryContainer = Color(0xFF16202E),
        tertiary = Color(0xFF6D4AAE),
        background = Color(0xFFF7F9FC),
        onBackground = Color(0xFF121722),
        surface = Color(0xFFFFFFFF),
        onSurface = Color(0xFF121722),
        surfaceVariant = Color(0xFFE8EDF4),
        onSurfaceVariant = Color(0xFF454F5E),
        outline = Color(0xFF9AA5B4),
        outlineVariant = Color(0xFFD3DBE5),
        error = Color(0xFFB3261E),
        onError = Color.White,
        errorContainer = Color(0xFFF9DEDC),
        onErrorContainer = Color(0xFF410E0B),
        scrim = Color(0xFF000000),
    )
}

private val LauncherTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.copy(fontWeight = FontWeight.Light),
        headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.SemiBold),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        bodyMedium = base.bodyMedium.copy(lineHeight = 22.sp),
        labelSmall = base.labelSmall.copy(fontWeight = FontWeight.Medium),
    )
}

/** Big translucent clock face used on the home screen. */
val ClockTextStyle = TextStyle(
    fontSize = 64.sp,
    fontWeight = FontWeight.Thin,
    letterSpacing = (-1).sp,
)

@Composable
fun DlckLnchTheme(
    settings: LauncherSettings,
    content: @Composable () -> Unit,
) {
    val systemDark = isSystemInDarkTheme()
    val dark = when (settings.themeMode) {
        ThemeMode.SYSTEM -> systemDark
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }

    val context = LocalContext.current
    val supportsDynamic = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val scheme = when {
        settings.dynamicColor && supportsDynamic && dark -> dynamicDarkColorScheme(context)
        settings.dynamicColor && supportsDynamic && !dark -> dynamicLightColorScheme(context)
        dark -> darkSchemeFor(settings.accent)
        else -> lightSchemeFor(settings.accent)
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            WindowCompat.setDecorFitsSystemWindows(window, false)
            val controller = WindowCompat.getInsetsController(window, view)
            // On the home screen we draw over the wallpaper, so icon contrast follows the theme.
            val lightIcons = !dark && scheme.background.luminance() > 0.5f
            controller.isAppearanceLightStatusBars = lightIcons
            controller.isAppearanceLightNavigationBars = lightIcons
        }
    }

    MaterialTheme(
        colorScheme = scheme,
        typography = LauncherTypography,
        content = content,
    )
}
