package com.dlck.lnch.utils

import android.content.Context
import android.content.pm.LauncherApps
import android.os.Process

/**
 * Static and dynamic app shortcuts — the "New message", "Scan QR", "Compose" entries a launcher
 * shows when you long-press an icon.
 *
 * Uses the official [LauncherApps] API only. Android intentionally restricts it to the app that is
 * currently the **default home app**: before the user picks DLCK LNCH the platform throws
 * `SecurityException`, which is caught here so the sheet simply shows nothing instead of crashing.
 *
 * No shell, no reflection, no private APIs — shortcuts are started through
 * [LauncherApps.startShortcut], which lets the *system* perform the launch.
 */
object AppShortcuts {

    /** The maximum number of shortcuts rendered in the long-press sheet. */
    const val MAX_SHOWN = 4

    data class Entry(
        val id: String,
        val packageName: String,
        val label: String,
    )

    private fun service(context: Context): LauncherApps? =
        context.getSystemService(Context.LAUNCHER_APPS_SERVICE) as? LauncherApps

    /**
     * @return the app's shortcuts, or an empty list when the launcher is not the default home app,
     *         the app publishes none, or the platform refuses the query.
     */
    fun load(context: Context, packageName: String, limit: Int = MAX_SHOWN): List<Entry> {
        val launcherApps = service(context) ?: return emptyList()
        if (!launcherApps.hasShortcutHostPermission().orFalse()) return emptyList()

        val query = LauncherApps.ShortcutQuery()
            .setPackage(packageName)
            .setQueryFlags(
                LauncherApps.ShortcutQuery.FLAG_MATCH_MANIFEST or
                    LauncherApps.ShortcutQuery.FLAG_MATCH_DYNAMIC or
                    LauncherApps.ShortcutQuery.FLAG_MATCH_PINNED,
            )

        return runCatching {
            launcherApps.getShortcuts(query, Process.myUserHandle())
                .orEmpty()
                .asSequence()
                .filter { it.isEnabled }
                .sortedBy { it.rank }
                .mapNotNull { info ->
                    val label = (info.shortLabel ?: info.longLabel)?.toString()?.trim()
                    if (label.isNullOrEmpty()) {
                        null
                    } else {
                        Entry(id = info.id, packageName = info.`package`, label = label)
                    }
                }
                .distinctBy { it.id }
                .take(limit)
                .toList()
        }.getOrDefault(emptyList())
    }

    /** Asks the system to launch the shortcut. Returns false if it is no longer available. */
    fun start(context: Context, entry: Entry): Boolean {
        val launcherApps = service(context) ?: return false
        return runCatching {
            launcherApps.startShortcut(
                entry.packageName,
                entry.id,
                null,
                null,
                Process.myUserHandle(),
            )
            true
        }.getOrDefault(false)
    }

    private fun Boolean?.orFalse(): Boolean = this == true
}
