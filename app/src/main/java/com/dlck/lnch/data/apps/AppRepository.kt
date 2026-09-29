package com.dlck.lnch.data.apps

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.Collator
import java.util.Locale

/**
 * Reads the list of launchable apps from [PackageManager] and keeps it fresh when packages are
 * installed / removed / updated.
 *
 * Everything here uses public, permission-free Android APIs. No shell commands are ever executed.
 */
class AppRepository(
    private val context: Context,
    private val scope: CoroutineScope,
) {

    private val packageManager: PackageManager = context.packageManager

    private val _apps = MutableStateFlow<List<AppInfo>>(emptyList())
    val apps: StateFlow<List<AppInfo>> = _apps.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val packageReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            scope.launch { refresh() }
        }
    }

    fun start() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addDataScheme("package")
        }
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(packageReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                context.registerReceiver(packageReceiver, filter)
            }
        }.onFailure { Log.w(TAG, "Could not register package receiver: ${it.javaClass.simpleName}") }

        scope.launch { refresh() }
    }

    suspend fun refresh() = withContext(Dispatchers.IO) {
        _loading.value = true
        val result = runCatching { queryLaunchableApps() }
            .onFailure { Log.e(TAG, "App query failed: ${it.javaClass.simpleName}") }
            .getOrDefault(emptyList())
        _apps.value = result
        _loading.value = false
    }

    private fun queryLaunchableApps(): List<AppInfo> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved: List<ResolveInfo> =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.queryIntentActivities(
                    intent,
                    PackageManager.ResolveInfoFlags.of(0L),
                )
            } else {
                @Suppress("DEPRECATION")
                packageManager.queryIntentActivities(intent, 0)
            }

        val selfPackage = context.packageName
        val collator = Collator.getInstance(Locale.getDefault()).apply {
            strength = Collator.PRIMARY
        }

        return resolved.asSequence()
            .mapNotNull { info ->
                val activityInfo = info.activityInfo ?: return@mapNotNull null
                val appInfo = activityInfo.applicationInfo ?: return@mapNotNull null
                if (activityInfo.packageName == selfPackage) return@mapNotNull null

                val label = runCatching { info.loadLabel(packageManager).toString() }
                    .getOrDefault(activityInfo.packageName)
                    .trim()
                    .ifEmpty { activityInfo.packageName }

                val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0 &&
                    (appInfo.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) == 0

                val installTime = runCatching {
                    packageManager.getPackageInfo(activityInfo.packageName, 0).firstInstallTime
                }.getOrDefault(0L)

                AppInfo(
                    packageName = activityInfo.packageName,
                    activityName = activityInfo.name,
                    label = label,
                    category = categoryOf(appInfo, isSystem),
                    isSystemApp = isSystem,
                    firstInstallTime = installTime,
                )
            }
            .distinctBy { it.key }
            .sortedWith { a, b -> collator.compare(a.label, b.label) }
            .toList()
    }

    private fun categoryOf(info: ApplicationInfo, isSystem: Boolean): AppCategory {
        val declared = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) info.category else -1
        return when (declared) {
            ApplicationInfo.CATEGORY_GAME -> AppCategory.GAME
            ApplicationInfo.CATEGORY_SOCIAL -> AppCategory.SOCIAL
            ApplicationInfo.CATEGORY_PRODUCTIVITY -> AppCategory.PRODUCTIVITY
            ApplicationInfo.CATEGORY_AUDIO,
            ApplicationInfo.CATEGORY_VIDEO,
            ApplicationInfo.CATEGORY_IMAGE,
            -> AppCategory.MEDIA

            ApplicationInfo.CATEGORY_NEWS -> AppCategory.NEWS
            ApplicationInfo.CATEGORY_MAPS -> AppCategory.MAPS
            else -> if (isSystem) AppCategory.SYSTEM else AppCategory.OTHER
        }
    }

    // ---------------------------------------------------------------- actions

    /** Launches an app through the standard component intent. Returns false if it could not start. */
    fun launch(app: AppInfo): Boolean = runCatching {
        val intent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setComponent(ComponentName(app.packageName, app.activityName))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        context.startActivity(intent)
        true
    }.getOrElse {
        Log.w(TAG, "launch failed for ${app.packageName}")
        launchByPackage(app.packageName)
    }

    fun launchByPackage(packageName: String): Boolean = runCatching {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
    }.getOrDefault(false)

    /** Opens the system "App info" page — the safe, standard way. */
    fun openAppInfo(packageName: String): Boolean = runCatching {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
    }.getOrDefault(false)

    /**
     * Asks Android to uninstall the package. This always goes through the platform uninstall
     * dialog — the launcher itself never removes anything.
     */
    fun requestUninstall(packageName: String): Boolean = runCatching {
        val intent = Intent(Intent.ACTION_DELETE)
            .setData(Uri.fromParts("package", packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
    }.getOrDefault(false)

    fun find(key: String): AppInfo? = _apps.value.firstOrNull { it.key == key }

    fun findByPackage(packageName: String): AppInfo? =
        _apps.value.firstOrNull { it.packageName == packageName }

    companion object {
        private const val TAG = "AppRepository"
    }
}
