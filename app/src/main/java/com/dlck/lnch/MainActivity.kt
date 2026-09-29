package com.dlck.lnch

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.os.LocaleListCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dlck.lnch.data.prefs.AppLanguage
import com.dlck.lnch.ui.LauncherRoot
import com.dlck.lnch.ui.LauncherViewModel
import com.dlck.lnch.ui.Screen
import com.dlck.lnch.ui.theme.DlckLnchTheme

/**
 * The single activity of the launcher.
 *
 * It is registered for CATEGORY_HOME, so Android can use DLCK LNCH as the device home screen.
 * Pressing the physical/gesture Home button re-delivers the intent to this instance
 * (launchMode="singleTask"), which is handled in [onNewIntent] by returning to the home screen.
 */
class MainActivity : AppCompatActivity() {

    private val viewModel: LauncherViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        handleLaunchIntent(intent, initial = true)

        setContent {
            val settings by viewModel.settings.collectAsStateWithLifecycle()

            LaunchedEffect(settings.language) {
                applyLanguage(settings.language)
            }

            DlckLnchTheme(settings = settings) {
                LauncherRoot(viewModel = viewModel)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunchIntent(intent, initial = false)
    }

    override fun onResume() {
        super.onResume()
        // Coming back from system settings: refresh things that may have changed outside the app.
        viewModel.refreshUsageAccess()
    }

    private fun handleLaunchIntent(intent: Intent?, initial: Boolean) {
        when (intent?.action) {
            Intent.ACTION_ASSIST -> viewModel.navigate(Screen.Chat)
            else -> if (!initial) viewModel.goHome()
        }
    }

    private fun applyLanguage(language: AppLanguage) {
        val tag = language.tag
        val current = AppCompatDelegate.getApplicationLocales().toLanguageTags()
        val desired = tag.orEmpty()
        if (current == desired) return
        AppCompatDelegate.setApplicationLocales(
            if (tag == null) {
                LocaleListCompat.getEmptyLocaleList()
            } else {
                LocaleListCompat.forLanguageTags(tag)
            },
        )
    }
}
