package com.dlck.lnch.ui.launcher.widgets

import android.app.Activity
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetHostView
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.dlck.lnch.data.widgets.WidgetRepository
import com.dlck.lnch.data.widgets.WidgetSpec
import com.dlck.lnch.graph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Real home-screen widgets, hosted by the launcher itself.
 *
 * This is the standard `AppWidgetHost` contract:
 *  1. allocate an id,
 *  2. ask the system to bind it to the chosen provider (with the user's consent dialog when the
 *     launcher is not yet allowed to bind silently),
 *  3. run the widget's own configuration activity if it has one,
 *  4. create the `AppWidgetHostView` and let the provider draw into it.
 *
 * The launcher never inflates provider code itself — the platform does, in a sandboxed
 * `RemoteViews` tree. Ids are released again on removal so they cannot leak.
 */
class WidgetHostController(
    private val activity: ComponentActivity,
) : DefaultLifecycleObserver {

    private val appWidgetManager: AppWidgetManager = AppWidgetManager.getInstance(activity)
    private val host = AppWidgetHost(activity.applicationContext, HOST_ID)
    private val repository: WidgetRepository = activity.graph.widgetRepository

    private var pendingProvider: AppWidgetProviderInfo? = null
    private var pendingId: Int = AppWidgetManager.INVALID_APPWIDGET_ID

    private val _listening = MutableStateFlow(false)

    /** True once the host is listening, i.e. safe to create views. */
    val listening: StateFlow<Boolean> = _listening

    private val bindLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val provider = pendingProvider
            val id = pendingId
            if (result.resultCode == Activity.RESULT_OK && provider != null &&
                id != AppWidgetManager.INVALID_APPWIDGET_ID
            ) {
                configureOrSave(id, provider)
            } else {
                cancelPending()
            }
        }

    // The result is irrelevant: the provider persists its own configuration, and the widget is
    // kept either way — exactly what the stock launcher does when configuration is dismissed.
    private val configureLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            finishPending()
        }

    init {
        activity.lifecycle.addObserver(this)
    }

    // ------------------------------------------------------------ lifecycle

    override fun onStart(owner: LifecycleOwner) {
        runCatching { host.startListening() }
            .onSuccess { _listening.value = true }
    }

    override fun onStop(owner: LifecycleOwner) {
        runCatching { host.stopListening() }
        _listening.value = false
    }

    // -------------------------------------------------------------- catalog

    /** Every widget provider installed on the device, grouped-friendly and sorted by label. */
    suspend fun availableWidgets(): List<WidgetCatalogEntry> = withContext(Dispatchers.IO) {
        runCatching {
            appWidgetManager.installedProviders.mapNotNull { info ->
                val label = runCatching {
                    info.loadLabel(activity.packageManager)
                }.getOrNull().orEmpty().ifBlank { info.provider.shortClassName }
                val appLabel = runCatching {
                    activity.packageManager
                        .getApplicationLabel(
                            activity.packageManager.getApplicationInfo(info.provider.packageName, 0),
                        )
                        .toString()
                }.getOrDefault(info.provider.packageName)
                WidgetCatalogEntry(info = info, label = label, appLabel = appLabel)
            }.sortedWith(compareBy({ it.appLabel.lowercase() }, { it.label.lowercase() }))
        }.getOrDefault(emptyList())
    }

    // ------------------------------------------------------------ add/remove

    /** Step 1: allocate + bind. Continues asynchronously through the activity-result callbacks. */
    fun addWidget(entry: WidgetCatalogEntry) {
        val info = entry.info
        val id = runCatching { host.allocateAppWidgetId() }
            .getOrDefault(AppWidgetManager.INVALID_APPWIDGET_ID)
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return

        pendingId = id
        pendingProvider = info

        val bound = runCatching {
            appWidgetManager.bindAppWidgetIdIfAllowed(id, info.provider)
        }.getOrDefault(false)

        if (bound) {
            configureOrSave(id, info)
            return
        }

        val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_BIND).apply {
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_PROVIDER, info.provider)
        }
        val launched = runCatching { bindLauncher.launch(intent); true }.getOrDefault(false)
        if (!launched) cancelPending()
    }

    private fun configureOrSave(id: Int, info: AppWidgetProviderInfo) {
        val configure = info.configure
        if (configure == null) {
            finishPending()
            return
        }
        val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE).apply {
            component = configure
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val launched = runCatching { configureLauncher.launch(intent); true }
            .getOrDefault(false)
        // Some providers protect their configuration activity; keeping the widget unconfigured is
        // still better than dropping it, and the provider shows its own "tap to set up" state.
        if (!launched) finishPending()
    }

    private fun finishPending() {
        val id = pendingId
        val info = pendingProvider
        pendingId = AppWidgetManager.INVALID_APPWIDGET_ID
        pendingProvider = null
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID || info == null) return

        val label = runCatching { info.loadLabel(activity.packageManager) }.getOrNull().orEmpty()
        val heightDp = suggestedHeightDp(info)
        activity.lifecycleScope.launch {
            repository.add(
                WidgetSpec(
                    appWidgetId = id,
                    provider = info.provider.flattenToString(),
                    label = label,
                    heightDp = heightDp,
                ),
            )
        }
    }

    private fun cancelPending() {
        val id = pendingId
        pendingId = AppWidgetManager.INVALID_APPWIDGET_ID
        pendingProvider = null
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
            runCatching { host.deleteAppWidgetId(id) }
        }
    }

    fun removeWidget(appWidgetId: Int) {
        runCatching { host.deleteAppWidgetId(appWidgetId) }
        activity.lifecycleScope.launch { repository.remove(appWidgetId) }
    }

    fun resizeWidget(appWidgetId: Int, heightDp: Int) {
        activity.lifecycleScope.launch { repository.resize(appWidgetId, heightDp) }
    }

    // --------------------------------------------------------------- render

    /** Builds the platform view for a stored widget, or null when the provider vanished. */
    fun createView(context: Context, spec: WidgetSpec, widthDp: Int): AppWidgetHostView? {
        val info = runCatching { appWidgetManager.getAppWidgetInfo(spec.appWidgetId) }.getOrNull()
            ?: return null
        return runCatching {
            val view = host.createView(context.applicationContext, spec.appWidgetId, info)
            view.setAppWidget(spec.appWidgetId, info)
            applySize(view, spec.appWidgetId, widthDp, spec.heightDp)
            view
        }.getOrNull()
    }

    fun applySize(view: AppWidgetHostView, appWidgetId: Int, widthDp: Int, heightDp: Int) {
        runCatching {
            val options = Bundle().apply {
                putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, widthDp)
                putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, widthDp)
                putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, heightDp)
                putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, heightDp)
            }
            appWidgetManager.updateAppWidgetOptions(appWidgetId, options)
            @Suppress("DEPRECATION")
            view.updateAppWidgetSize(Bundle.EMPTY, widthDp, heightDp, widthDp, heightDp)
        }
    }

    /** Drops stored widgets whose provider is no longer installed. */
    fun pruneMissing(specs: List<WidgetSpec>) {
        val dead = specs.filter {
            runCatching { appWidgetManager.getAppWidgetInfo(it.appWidgetId) }.getOrNull() == null
        }
        if (dead.isEmpty()) return
        activity.lifecycleScope.launch {
            dead.forEach { repository.remove(it.appWidgetId) }
        }
    }

    private fun suggestedHeightDp(info: AppWidgetProviderInfo): Int {
        val min = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            maxOf(info.minHeight, info.maxResizeHeight.takeIf { it > 0 } ?: 0)
        } else {
            info.minHeight
        }
        val density = activity.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        val dp = (min / density).toInt()
        return dp.coerceIn(WidgetSpec.MIN_HEIGHT_DP, WidgetSpec.MAX_HEIGHT_DP)
    }

    companion object {
        /** Any stable, app-private id works; it only has to stay the same across restarts. */
        const val HOST_ID = 0x4C4E4348 // "LNCH"
    }
}

/** A pickable widget: the provider plus the labels shown in the picker list. */
data class WidgetCatalogEntry(
    val info: AppWidgetProviderInfo,
    val label: String,
    val appLabel: String,
)
