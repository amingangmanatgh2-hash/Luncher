package com.dlck.lnch.ai.intent

import com.dlck.lnch.data.apps.AppCategory
import com.dlck.lnch.data.apps.AppInfo

/**
 * A deterministic, offline first pass over the user's sentence.
 *
 * Why it exists:
 *  * common commands ("open YouTube", «تنظیمات وای‌فای رو باز کن») resolve instantly with no
 *    network round-trip and no token cost;
 *  * the launcher keeps working for those commands when Gemini is unreachable or unconfigured.
 *
 * It is intentionally conservative: when it is not confident it returns `null` and the request is
 * handed to Gemini.
 */
object LocalIntentMatcher {

    private val openVerbsFa = listOf("باز کن", "بازکن", "اجرا کن", "اجراکن", "برو به", "بیار")
    private val openVerbsEn = listOf("open", "launch", "start", "run", "go to")

    private val settingsWordsFa = listOf("تنظیمات", "ستینگ")
    private val settingsWordsEn = listOf("settings", "setting")

    private val settingsTargets: List<Pair<SettingsTarget, List<String>>> = listOf(
        SettingsTarget.WIFI to listOf("wifi", "wi-fi", "wireless", "وای فای", "وایفای", "وای‌فای"),
        SettingsTarget.BLUETOOTH to listOf("bluetooth", "بلوتوث"),
        SettingsTarget.DISPLAY to listOf("display", "screen", "brightness", "نمایش", "صفحه", "روشنایی"),
        SettingsTarget.SOUND to listOf("sound", "volume", "audio", "صدا", "صوت"),
        SettingsTarget.BATTERY to listOf("battery", "power", "باتری", "شارژ"),
        SettingsTarget.APPS to listOf("apps", "applications", "برنامه ها", "برنامه‌ها", "اپلیکیشن"),
        SettingsTarget.LOCATION to listOf("location", "gps", "موقعیت", "مکان"),
        SettingsTarget.STORAGE to listOf("storage", "memory", "حافظه", "فضا"),
        SettingsTarget.SECURITY to listOf("security", "lock", "امنیت", "قفل"),
        SettingsTarget.NETWORK to listOf("network", "internet", "data", "شبکه", "اینترنت", "دیتا"),
        SettingsTarget.DATE to listOf("date", "time", "clock", "تاریخ", "ساعت", "زمان"),
        SettingsTarget.LANGUAGE to listOf("language", "locale", "زبان"),
        SettingsTarget.ACCESSIBILITY to listOf("accessibility", "دسترس پذیری", "دسترس‌پذیری"),
        SettingsTarget.HOME to listOf("home app", "launcher", "default home", "لانچر", "صفحه اصلی"),
        SettingsTarget.NOTIFICATIONS to listOf("notification", "اعلان", "نوتیفیکیشن"),
    )

    private val recentWords = listOf(
        "recent", "recently", "last used", "today", "اخیر", "اخیرا", "اخیراً",
        "امروز استفاده", "آخرین برنامه",
    )

    private val categoryWords: List<Pair<AppCategory, List<String>>> = listOf(
        AppCategory.GAME to listOf("game", "games", "بازی", "بازی ها", "بازی‌ها"),
        AppCategory.SOCIAL to listOf("social", "شبکه اجتماعی", "اجتماعی"),
        AppCategory.MEDIA to listOf("music", "video", "media", "موزیک", "ویدیو", "چندرسانه"),
        AppCategory.NEWS to listOf("news", "خبر", "اخبار"),
        AppCategory.MAPS to listOf("maps", "navigation", "نقشه", "مسیریاب"),
        AppCategory.PRODUCTIVITY to listOf("productivity", "بهره وری", "بهره‌وری", "کاری"),
    )

    private val timerWords = listOf("timer", "تایمر", "زمان سنج", "زمان‌سنج", "آلارم", "alarm")
    private val webWords = listOf("search the web", "google", "گوگل کن", "سرچ کن", "در وب", "وب")

    fun match(rawInput: String, apps: List<AppInfo>): LauncherIntent? {
        val text = AppMatcher.normalize(rawInput)
        if (text.isBlank()) return null

        matchTimer(text)?.let { return it }
        matchSettings(text)?.let { return it }
        matchRecent(text)?.let { return it }
        matchCategory(text)?.let { return it }
        matchOpenApp(text, rawInput, apps)?.let { return it }
        matchWeb(text)?.let { return it }
        return null
    }

    private fun matchTimer(text: String): LauncherIntent? {
        if (timerWords.none { text.contains(AppMatcher.normalize(it)) }) return null
        val number = Regex("(\\d+)").find(text)?.groupValues?.get(1)?.toIntOrNull() ?: return null
        val isHour = text.contains("hour") || text.contains("ساعت")
        val isSecond = text.contains("second") || text.contains("ثانیه")
        val seconds = when {
            isHour -> number * 3600
            isSecond -> number
            else -> number * 60 // minutes are the default unit
        }
        if (seconds !in 1..86400) return null
        return LauncherIntent.CreateTimer(seconds, null)
    }

    private fun matchSettings(text: String): LauncherIntent? {
        val mentionsSettings = (settingsWordsFa + settingsWordsEn)
            .any { text.contains(AppMatcher.normalize(it)) }
        val target = settingsTargets.firstOrNull { (_, words) ->
            words.any { text.contains(AppMatcher.normalize(it)) }
        }?.first

        return when {
            mentionsSettings && target != null -> LauncherIntent.OpenSettings(target)
            mentionsSettings && isOpenCommand(text) -> LauncherIntent.OpenSettings(SettingsTarget.MAIN)
            target != null && isOpenCommand(text) -> LauncherIntent.OpenSettings(target)
            else -> null
        }
    }

    private fun matchRecent(text: String): LauncherIntent? {
        val mentionsRecent = recentWords.any { text.contains(AppMatcher.normalize(it)) }
        val mentionsApps = text.contains("app") || text.contains("برنامه") || text.contains("اپ")
        return if (mentionsRecent && mentionsApps) {
            LauncherIntent.ShowApps(category = null, recentOnly = true)
        } else {
            null
        }
    }

    private fun matchCategory(text: String): LauncherIntent? {
        val wantsList = text.contains("show") || text.contains("list") || text.contains("find") ||
            text.contains("نشون") || text.contains("نمایش") || text.contains("پیدا") ||
            text.contains("لیست")
        if (!wantsList) return null
        val category = categoryWords.firstOrNull { (_, words) ->
            words.any { text.contains(AppMatcher.normalize(it)) }
        }?.first ?: return null
        return LauncherIntent.ShowApps(category = category, recentOnly = false)
    }

    private fun matchOpenApp(text: String, raw: String, apps: List<AppInfo>): LauncherIntent? {
        if (!isOpenCommand(text)) return null
        val stripped = stripVerbs(text)
        if (stripped.isBlank()) return null
        // Only accept when an installed app actually matches — otherwise let Gemini interpret it.
        val candidate = AppMatcher.best(stripped, apps) ?: return null
        return if (AppMatcher.normalize(candidate.label).length >= 2) {
            LauncherIntent.OpenApp(stripped)
        } else {
            null
        }
    }

    private fun matchWeb(text: String): LauncherIntent? {
        val mentionsWeb = webWords.any { text.contains(AppMatcher.normalize(it)) }
        if (!mentionsWeb) return null
        val q = stripVerbs(text)
            .replace("گوگل", "")
            .replace("google", "")
            .replace("search", "")
            .replace("سرچ", "")
            .replace("در وب", "")
            .trim()
        return if (q.length >= 2) LauncherIntent.SearchWeb(q) else null
    }

    private fun isOpenCommand(text: String): Boolean =
        (openVerbsFa + openVerbsEn).any { text.contains(AppMatcher.normalize(it)) }

    private fun stripVerbs(text: String): String {
        var result = text
        for (verb in openVerbsFa + openVerbsEn) {
            result = result.replace(AppMatcher.normalize(verb), " ")
        }
        for (filler in listOf("رو", "را", "please", "لطفا", "لطفاً", "the", "app", "برنامه", "اپ")) {
            result = result.replace(Regex("(^|\\s)${Regex.escape(filler)}(\\s|$)"), " ")
        }
        return result.replace(Regex("\\s+"), " ").trim()
    }
}
