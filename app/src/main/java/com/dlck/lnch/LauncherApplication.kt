package com.dlck.lnch

import android.app.Application
import android.content.Context
import com.dlck.lnch.ai.gemini.GeminiClient
import com.dlck.lnch.ai.intent.IntentExecutor
import com.dlck.lnch.data.apps.AppRepository
import com.dlck.lnch.data.backup.BackupManager
import com.dlck.lnch.data.apps.IconCache
import com.dlck.lnch.data.prefs.AiStateRepository
import com.dlck.lnch.data.prefs.AppStateRepository
import com.dlck.lnch.data.prefs.SettingsRepository
import com.dlck.lnch.data.secure.CredentialStore
import com.dlck.lnch.data.widgets.WidgetRepository
import com.dlck.lnch.utils.CrashGuard
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Manual dependency graph.
 *
 * A launcher must start fast, so there is no annotation-processing DI here: a handful of
 * lazily-created singletons keeps cold start light and the build simple.
 */
class AppGraph(context: Context) {

    private val appContext = context.applicationContext

    val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val settingsRepository: SettingsRepository by lazy { SettingsRepository(appContext) }
    val appStateRepository: AppStateRepository by lazy { AppStateRepository(appContext) }
    val aiStateRepository: AiStateRepository by lazy { AiStateRepository(appContext) }
    val credentialStore: CredentialStore by lazy { CredentialStore(appContext) }
    val iconCache: IconCache by lazy { IconCache(appContext) }
    val widgetRepository: WidgetRepository by lazy { WidgetRepository(appContext) }
    val backupManager: BackupManager by lazy {
        BackupManager(settingsRepository, appStateRepository)
    }
    val appRepository: AppRepository by lazy { AppRepository(appContext, applicationScope) }
    val geminiClient: GeminiClient by lazy { GeminiClient(credentialStore) }
    val intentExecutor: IntentExecutor by lazy { IntentExecutor(appContext, appRepository) }
}

class LauncherApplication : Application() {

    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        CrashGuard.install(this)
        graph.appRepository.start()
    }
}

val Context.graph: AppGraph
    get() = (applicationContext as LauncherApplication).graph
