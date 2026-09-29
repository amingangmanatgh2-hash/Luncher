package com.dlck.lnch.ai.intent

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.AlarmClock
import android.provider.Settings
import androidx.core.net.toUri
import com.dlck.lnch.R
import com.dlck.lnch.data.apps.AppCategory
import com.dlck.lnch.data.apps.AppInfo
import com.dlck.lnch.data.apps.AppRepository
import com.dlck.lnch.data.apps.canHandle

/**
 * Turns a validated [LauncherIntent] into a real Android action.
 *
 * Hard rules enforced here:
 *  * only the intents defined in [LauncherIntent] can ever be executed;
 *  * every outgoing intent is a standard, documented Android action — no shell, no reflection,
 *    no arbitrary component names supplied by the model;
 *  * web searches are escaped and sent through the platform search intent;
 *  * if nothing on the device can handle an action we fail gracefully instead of crashing.
 */
class IntentExecutor(
    private val context: Context,
    private val appRepository: AppRepository,
) {

    /** What the executor did (or wants to do), ready to be shown in the chat. */
    data class Outcome(
        val success: Boolean,
        val message: String,
        val navigation: Navigation? = null,
        val suggestions: List<AppInfo> = emptyList(),
    )

    sealed interface Navigation {
        data class OpenDrawer(val query: String?, val category: AppCategory?) : Navigation
        data object ShowRecent : Navigation
    }

    /** A short, localized description used by the confirmation card. */
    fun describe(intent: LauncherIntent): String = when (intent) {
        is LauncherIntent.OpenApp -> {
            val resolved = AppMatcher.best(intent.appQuery, appRepository.apps.value)
            context.getString(R.string.intent_open_app, resolved?.label ?: intent.appQuery)
        }

        is LauncherIntent.SearchApp -> context.getString(R.string.intent_search_app, intent.query)
        is LauncherIntent.OpenSettings ->
            context.getString(R.string.intent_open_settings, labelFor(intent.target))

        is LauncherIntent.ShowApps -> context.getString(
            R.string.intent_show_apps,
            when {
                intent.recentOnly -> context.getString(R.string.home_recent)
                intent.category != null -> categoryLabel(intent.category)
                else -> context.getString(R.string.category_all)
            },
        )

        is LauncherIntent.CreateTimer ->
            context.getString(R.string.intent_create_timer, formatDuration(intent.seconds))

        is LauncherIntent.SearchWeb -> context.getString(R.string.intent_search_web, intent.query)
        LauncherIntent.GeneralChat -> ""
    }

    fun execute(intent: LauncherIntent): Outcome = when (intent) {
        is LauncherIntent.OpenApp -> openApp(intent.appQuery)
        is LauncherIntent.SearchApp -> Outcome(
            success = true,
            message = describe(intent),
            navigation = Navigation.OpenDrawer(intent.query, null),
        )

        is LauncherIntent.OpenSettings -> openSettings(intent.target)
        is LauncherIntent.ShowApps -> Outcome(
            success = true,
            message = describe(intent),
            navigation = if (intent.recentOnly) {
                Navigation.ShowRecent
            } else {
                Navigation.OpenDrawer(null, intent.category)
            },
        )

        is LauncherIntent.CreateTimer -> createTimer(intent)
        is LauncherIntent.SearchWeb -> searchWeb(intent.query)
        LauncherIntent.GeneralChat -> Outcome(true, "")
    }

    // ------------------------------------------------------------------ apps

    private fun openApp(query: String): Outcome {
        val ranked = AppMatcher.rank(query, appRepository.apps.value)
        val target = ranked.firstOrNull()
            ?: return Outcome(
                success = false,
                message = context.getString(R.string.intent_no_app_found, query),
            )

        val launched = appRepository.launch(target)
        return Outcome(
            success = launched,
            message = if (launched) {
                context.getString(R.string.intent_open_app, target.label)
            } else {
                context.getString(R.string.intent_no_app_found, query)
            },
            suggestions = ranked.drop(1).take(3),
        )
    }

    // -------------------------------------------------------------- settings

    private fun openSettings(target: SettingsTarget): Outcome {
        val candidates = intentsFor(target)
        for (intent in candidates) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (context.canHandle(intent)) {
                return try {
                    context.startActivity(intent)
                    Outcome(true, context.getString(R.string.intent_open_settings, labelFor(target)))
                } catch (e: ActivityNotFoundException) {
                    continue
                }
            }
        }
        return Outcome(false, context.getString(R.string.intent_no_handler))
    }

    private fun intentsFor(target: SettingsTarget): List<Intent> = when (target) {
        SettingsTarget.WIFI -> listOf(Intent(Settings.ACTION_WIFI_SETTINGS))
        SettingsTarget.BLUETOOTH -> listOf(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        SettingsTarget.DISPLAY -> listOf(Intent(Settings.ACTION_DISPLAY_SETTINGS))
        SettingsTarget.SOUND -> listOf(Intent(Settings.ACTION_SOUND_SETTINGS))
        SettingsTarget.BATTERY -> listOf(
            Intent(Intent.ACTION_POWER_USAGE_SUMMARY),
            Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS),
        )

        SettingsTarget.APPS -> listOf(
            Intent(Settings.ACTION_APPLICATION_SETTINGS),
            Intent(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS),
        )

        SettingsTarget.LOCATION -> listOf(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        SettingsTarget.STORAGE -> listOf(Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS))
        SettingsTarget.SECURITY -> listOf(Intent(Settings.ACTION_SECURITY_SETTINGS))
        SettingsTarget.NETWORK -> listOf(
            Intent(Settings.ACTION_WIRELESS_SETTINGS),
            Intent(Settings.ACTION_DATA_ROAMING_SETTINGS),
        )

        SettingsTarget.DATE -> listOf(Intent(Settings.ACTION_DATE_SETTINGS))
        SettingsTarget.LANGUAGE -> listOf(Intent(Settings.ACTION_LOCALE_SETTINGS))
        SettingsTarget.ACCESSIBILITY -> listOf(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        SettingsTarget.HOME -> listOf(Intent(Settings.ACTION_HOME_SETTINGS))
        SettingsTarget.NOTIFICATIONS -> listOf(
            Intent("android.settings.NOTIFICATION_SETTINGS"),
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
        )

        SettingsTarget.MAIN -> listOf(Intent(Settings.ACTION_SETTINGS))
    } + Intent(Settings.ACTION_SETTINGS) // always-available fallback

    fun labelFor(target: SettingsTarget): String = context.getString(
        when (target) {
            SettingsTarget.WIFI -> R.string.settings_target_wifi
            SettingsTarget.BLUETOOTH -> R.string.settings_target_bluetooth
            SettingsTarget.DISPLAY -> R.string.settings_target_display
            SettingsTarget.SOUND -> R.string.settings_target_sound
            SettingsTarget.BATTERY -> R.string.settings_target_battery
            SettingsTarget.APPS -> R.string.settings_target_apps
            SettingsTarget.LOCATION -> R.string.settings_target_location
            SettingsTarget.STORAGE -> R.string.settings_target_storage
            SettingsTarget.SECURITY -> R.string.settings_target_security
            SettingsTarget.NETWORK -> R.string.settings_target_network
            SettingsTarget.DATE -> R.string.settings_target_date
            SettingsTarget.LANGUAGE -> R.string.settings_target_language
            SettingsTarget.ACCESSIBILITY -> R.string.settings_target_accessibility
            SettingsTarget.HOME -> R.string.settings_target_home
            SettingsTarget.NOTIFICATIONS -> R.string.settings_target_notifications
            SettingsTarget.MAIN -> R.string.settings_target_main
        },
    )

    private fun categoryLabel(category: AppCategory): String = context.getString(
        when (category) {
            AppCategory.GAME -> R.string.category_game
            AppCategory.SOCIAL -> R.string.category_social
            AppCategory.PRODUCTIVITY -> R.string.category_productivity
            AppCategory.MEDIA -> R.string.category_media
            AppCategory.NEWS -> R.string.category_news
            AppCategory.MAPS -> R.string.category_maps
            AppCategory.SYSTEM -> R.string.category_system
            AppCategory.OTHER -> R.string.category_other
        },
    )

    // ----------------------------------------------------------------- timer

    private fun createTimer(intent: LauncherIntent.CreateTimer): Outcome {
        val timerIntent = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, intent.seconds)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        intent.label?.takeIf { it.isNotBlank() }?.let {
            timerIntent.putExtra(AlarmClock.EXTRA_MESSAGE, it)
        }

        if (!context.canHandle(timerIntent)) {
            return Outcome(false, context.getString(R.string.intent_no_handler))
        }
        return try {
            context.startActivity(timerIntent)
            Outcome(
                true,
                context.getString(R.string.intent_create_timer, formatDuration(intent.seconds)),
            )
        } catch (e: ActivityNotFoundException) {
            Outcome(false, context.getString(R.string.intent_no_handler))
        }
    }

    // ------------------------------------------------------------------- web

    private fun searchWeb(query: String): Outcome {
        val webSearch = Intent(Intent.ACTION_WEB_SEARCH)
            .putExtra(android.app.SearchManager.QUERY, query)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        val browser = Intent(
            Intent.ACTION_VIEW,
            "https://www.google.com/search?q=${Uri.encode(query)}".toUri(),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        for (candidate in listOf(webSearch, browser)) {
            if (context.canHandle(candidate)) {
                return try {
                    context.startActivity(candidate)
                    Outcome(true, context.getString(R.string.intent_search_web, query))
                } catch (e: ActivityNotFoundException) {
                    continue
                }
            }
        }
        return Outcome(false, context.getString(R.string.intent_no_handler))
    }

    // ----------------------------------------------------------------- utils

    fun formatDuration(seconds: Int): String {
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        return buildList {
            if (h > 0) add("$h h")
            if (m > 0) add("$m min")
            if (s > 0 && h == 0) add("$s s")
        }.joinToString(" ").ifBlank { "$seconds s" }
    }
}
