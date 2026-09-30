package com.dlck.lnch

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.os.LocaleListCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.dlck.lnch.data.prefs.AppLanguage
import com.dlck.lnch.ui.BackupBridge
import com.dlck.lnch.ui.LauncherRoot
import com.dlck.lnch.ui.LauncherViewModel
import com.dlck.lnch.ui.LocalBackupBridge
import com.dlck.lnch.ui.Screen
import com.dlck.lnch.ui.launcher.widgets.WidgetHostController
import com.dlck.lnch.ui.theme.DlckLnchTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The single activity of the launcher.
 *
 * It is registered for CATEGORY_HOME, so Android can use DLCK LNCH as the device home screen.
 * Pressing the physical/gesture Home button re-delivers the intent to this instance
 * (launchMode="singleTask"), which is handled in [onNewIntent] by returning to the home screen.
 *
 * It also owns the two things that must live on an Activity: the `AppWidgetHost` (widgets) and
 * the Storage Access Framework dialogs used by backup/restore.
 */
class MainActivity : AppCompatActivity(), BackupBridge {

    private val viewModel: LauncherViewModel by viewModels()

    private var widgetController: WidgetHostController? = null

    private val exportLauncher =
        registerForActivityResult(ActivityResultContracts.CreateDocument(BACKUP_MIME)) { uri ->
            if (uri != null) writeBackup(uri)
        }

    private val importLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) readBackup(uri)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        widgetController = runCatching { WidgetHostController(this) }.getOrNull()

        handleLaunchIntent(intent, initial = true)

        setContent {
            val settings by viewModel.settings.collectAsStateWithLifecycle()

            LaunchedEffect(settings.language) {
                applyLanguage(settings.language)
            }

            DlckLnchTheme(settings = settings) {
                CompositionLocalProvider(LocalBackupBridge provides this) {
                    LauncherRoot(viewModel = viewModel, widgetController = widgetController)
                }
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

    // ------------------------------------------------------------ backup

    override fun exportBackup() {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date())
        runCatching { exportLauncher.launch("dlck-lnch-backup-$stamp.json") }
            .onFailure { toast(R.string.backup_failed) }
    }

    override fun restoreBackup() {
        runCatching { importLauncher.launch(arrayOf(BACKUP_MIME, "text/plain", "*/*")) }
            .onFailure { toast(R.string.backup_failed) }
    }

    private fun writeBackup(uri: Uri) {
        lifecycleScope.launch {
            val ok = runCatching {
                val json = viewModel.exportBackup()
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri)?.use { stream ->
                        stream.write(json.toByteArray(Charsets.UTF_8))
                    } ?: error("no stream")
                }
                true
            }.getOrDefault(false)
            toast(if (ok) R.string.backup_exported else R.string.backup_failed)
        }
    }

    private fun readBackup(uri: Uri) {
        lifecycleScope.launch {
            val ok = runCatching {
                val text = withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.use { stream ->
                        stream.readBytes().toString(Charsets.UTF_8)
                    }
                } ?: return@runCatching false
                viewModel.importBackup(text)
            }.getOrDefault(false)
            toast(if (ok) R.string.backup_restored else R.string.backup_invalid)
        }
    }

    private fun toast(resId: Int) {
        runCatching { Toast.makeText(this, resId, Toast.LENGTH_SHORT).show() }
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

    private companion object {
        const val BACKUP_MIME = "application/json"
    }
}
