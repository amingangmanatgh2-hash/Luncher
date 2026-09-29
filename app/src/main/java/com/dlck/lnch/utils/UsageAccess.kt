package com.dlck.lnch.utils

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.provider.Settings

/**
 * Optional "usage access" integration.
 *
 * DLCK LNCH never *requires* this permission: the Recently-used row falls back to the launcher's
 * own launch history. When the user grants it explicitly in system settings, the row also picks
 * up apps opened from outside the launcher.
 */
object UsageAccess {

    fun isGranted(context: Context): Boolean = runCatching {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
        }
        mode == AppOpsManager.MODE_ALLOWED
    }.getOrDefault(false)

    fun settingsIntent(): Intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Packages used in the last [windowHours], most recent first. Empty when not granted. */
    fun recentPackages(context: Context, windowHours: Int = 24, limit: Int = 20): List<String> {
        if (!isGranted(context)) return emptyList()
        return runCatching {
            val manager =
                context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val end = System.currentTimeMillis()
            val start = end - windowHours * 60L * 60L * 1000L
            manager.queryUsageStats(UsageStatsManager.INTERVAL_BEST, start, end)
                .orEmpty()
                .filter { it.totalTimeInForeground > 0 }
                .sortedByDescending { it.lastTimeUsed }
                .map { it.packageName }
                .distinct()
                .take(limit)
        }.getOrDefault(emptyList())
    }
}
