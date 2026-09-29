package com.dlck.lnch.ai.intent

import com.dlck.lnch.data.apps.AppCategory
import kotlinx.serialization.Serializable

/**
 * The *complete* set of actions the AI is allowed to request.
 *
 * The model can never express anything outside this list: its answer is parsed into
 * [AiDecision] and then validated into one of these types. Unknown values collapse to
 * [LauncherIntent.GeneralChat]. There is no code path that lets a model run a shell command,
 * an arbitrary intent, or an arbitrary URL.
 */
sealed interface LauncherIntent {

    /** Human-readable summary shown in the confirmation / result card. */
    val requiresConfirmation: Boolean get() = false

    data class OpenApp(val appQuery: String) : LauncherIntent

    data class SearchApp(val query: String) : LauncherIntent

    data class OpenSettings(val target: SettingsTarget) : LauncherIntent {
        override val requiresConfirmation: Boolean get() = true
    }

    data class ShowApps(val category: AppCategory?, val recentOnly: Boolean) : LauncherIntent

    data class CreateTimer(val seconds: Int, val label: String?) : LauncherIntent {
        override val requiresConfirmation: Boolean get() = true
    }

    data class SearchWeb(val query: String) : LauncherIntent {
        override val requiresConfirmation: Boolean get() = true
    }

    data object GeneralChat : LauncherIntent
}

/** Whitelisted system settings screens. */
enum class SettingsTarget(val id: String) {
    WIFI("wifi"),
    BLUETOOTH("bluetooth"),
    DISPLAY("display"),
    SOUND("sound"),
    BATTERY("battery"),
    APPS("apps"),
    LOCATION("location"),
    STORAGE("storage"),
    SECURITY("security"),
    NETWORK("network"),
    DATE("date"),
    LANGUAGE("language"),
    ACCESSIBILITY("accessibility"),
    HOME("home"),
    NOTIFICATIONS("notifications"),
    MAIN("main"),
    ;

    companion object {
        fun from(value: String?): SettingsTarget {
            if (value.isNullOrBlank()) return MAIN
            val needle = value.trim().lowercase()
            return entries.firstOrNull { it.id == needle }
                ?: entries.firstOrNull { needle.contains(it.id) }
                ?: MAIN
        }
    }
}

/** Raw JSON contract returned by the model. Every field is optional and untrusted. */
@Serializable
data class AiDecision(
    val intent: String = "GENERAL_CHAT",
    val app: String? = null,
    val query: String? = null,
    val settings: String? = null,
    val category: String? = null,
    val seconds: Int? = null,
    val recent: Boolean = false,
    val reply: String = "",
)

object IntentValidator {

    private const val MAX_TIMER_SECONDS = 24 * 60 * 60

    /** Converts an untrusted model answer into a safe [LauncherIntent]. */
    fun validate(decision: AiDecision): LauncherIntent = when (decision.intent.trim().uppercase()) {
        "OPEN_APP" -> decision.app?.takeIf { it.isNotBlank() }
            ?.let { LauncherIntent.OpenApp(it.trim().take(80)) }
            ?: LauncherIntent.GeneralChat

        "SEARCH_APP" -> {
            val q = (decision.query ?: decision.app).orEmpty().trim().take(80)
            if (q.isBlank()) LauncherIntent.GeneralChat else LauncherIntent.SearchApp(q)
        }

        "OPEN_SETTINGS" -> LauncherIntent.OpenSettings(SettingsTarget.from(decision.settings))

        "SHOW_APPS" -> LauncherIntent.ShowApps(
            category = parseCategory(decision.category),
            recentOnly = decision.recent || decision.category?.equals("recent", true) == true,
        )

        "CREATE_TIMER" -> {
            val seconds = decision.seconds ?: 0
            if (seconds in 1..MAX_TIMER_SECONDS) {
                LauncherIntent.CreateTimer(seconds, decision.query?.take(60))
            } else {
                LauncherIntent.GeneralChat
            }
        }

        "SEARCH_WEB" -> decision.query?.takeIf { it.isNotBlank() }
            ?.let { LauncherIntent.SearchWeb(it.trim().take(200)) }
            ?: LauncherIntent.GeneralChat

        else -> LauncherIntent.GeneralChat
    }

    fun parseCategory(value: String?): AppCategory? {
        if (value.isNullOrBlank()) return null
        return when (value.trim().uppercase()) {
            "GAME", "GAMES" -> AppCategory.GAME
            "SOCIAL" -> AppCategory.SOCIAL
            "PRODUCTIVITY", "WORK", "STUDY" -> AppCategory.PRODUCTIVITY
            "MEDIA", "AUDIO", "VIDEO", "MUSIC", "IMAGE" -> AppCategory.MEDIA
            "NEWS" -> AppCategory.NEWS
            "MAPS", "NAVIGATION" -> AppCategory.MAPS
            "SYSTEM" -> AppCategory.SYSTEM
            "OTHER" -> AppCategory.OTHER
            else -> null
        }
    }
}
