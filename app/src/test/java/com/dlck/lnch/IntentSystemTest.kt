package com.dlck.lnch

import com.dlck.lnch.ai.intent.AiDecision
import com.dlck.lnch.ai.intent.IntentValidator
import com.dlck.lnch.ai.intent.LauncherIntent
import com.dlck.lnch.ai.intent.LocalIntentMatcher
import com.dlck.lnch.ai.intent.SettingsTarget
import com.dlck.lnch.data.apps.AppCategory
import com.dlck.lnch.data.apps.AppInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IntentSystemTest {

    private fun app(label: String, pkg: String) = AppInfo(
        packageName = pkg,
        activityName = "$pkg.Main",
        label = label,
        category = AppCategory.OTHER,
        isSystemApp = false,
        firstInstallTime = 0L,
    )

    private val apps = listOf(
        app("YouTube", "com.google.android.youtube"),
        app("Telegram", "org.telegram.messenger"),
    )

    // ------------------------------------------------------------- validator

    @Test
    fun `unknown intent name collapses to general chat`() {
        val result = IntentValidator.validate(
            AiDecision(intent = "RUN_SHELL_COMMAND", query = "rm -rf /"),
        )
        assertEquals(LauncherIntent.GeneralChat, result)
    }

    @Test
    fun `open app without app name collapses to general chat`() {
        assertEquals(
            LauncherIntent.GeneralChat,
            IntentValidator.validate(AiDecision(intent = "OPEN_APP")),
        )
    }

    @Test
    fun `timer outside allowed range is rejected`() {
        assertEquals(
            LauncherIntent.GeneralChat,
            IntentValidator.validate(AiDecision(intent = "CREATE_TIMER", seconds = 999_999)),
        )
        assertEquals(
            LauncherIntent.GeneralChat,
            IntentValidator.validate(AiDecision(intent = "CREATE_TIMER", seconds = 0)),
        )
        assertEquals(
            LauncherIntent.CreateTimer(600, null),
            IntentValidator.validate(AiDecision(intent = "CREATE_TIMER", seconds = 600)),
        )
    }

    @Test
    fun `unknown settings target falls back to main settings`() {
        val result = IntentValidator.validate(
            AiDecision(intent = "OPEN_SETTINGS", settings = "please_root_my_phone"),
        )
        assertEquals(LauncherIntent.OpenSettings(SettingsTarget.MAIN), result)
    }

    @Test
    fun `sensitive intents require confirmation`() {
        assertTrue(LauncherIntent.OpenSettings(SettingsTarget.WIFI).requiresConfirmation)
        assertTrue(LauncherIntent.CreateTimer(60, null).requiresConfirmation)
        assertTrue(LauncherIntent.SearchWeb("kotlin").requiresConfirmation)
        assertTrue(!LauncherIntent.OpenApp("youtube").requiresConfirmation)
    }

    // ---------------------------------------------------------- local parser

    @Test
    fun `persian open command is handled offline`() {
        val result = LocalIntentMatcher.match("یوتیوب رو باز کن", apps)
        assertTrue(result is LauncherIntent.OpenApp)
    }

    @Test
    fun `english open command is handled offline`() {
        val result = LocalIntentMatcher.match("open telegram", apps)
        assertTrue(result is LauncherIntent.OpenApp)
    }

    @Test
    fun `persian wifi settings command is handled offline`() {
        val result = LocalIntentMatcher.match("تنظیمات وای فای رو باز کن", apps)
        assertEquals(LauncherIntent.OpenSettings(SettingsTarget.WIFI), result)
    }

    @Test
    fun `persian timer command computes seconds`() {
        val result = LocalIntentMatcher.match("یه تایمر 10 دقیقه ای بساز", apps)
        assertEquals(LauncherIntent.CreateTimer(600, null), result)
    }

    @Test
    fun `english timer in minutes`() {
        assertEquals(
            LauncherIntent.CreateTimer(300, null),
            LocalIntentMatcher.match("set a 5 minute timer", apps),
        )
    }

    @Test
    fun `open request for a non installed app is deferred to the model`() {
        assertEquals(null, LocalIntentMatcher.match("open spotify", apps))
    }

    @Test
    fun `free form question is deferred to the model`() {
        assertEquals(null, LocalIntentMatcher.match("چند تا برنامه برای درس خوندن پیشنهاد بده", apps))
    }
}
