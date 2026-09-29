package com.dlck.lnch.data.apps

import androidx.compose.runtime.Immutable

/**
 * A launchable activity discovered on the device.
 *
 * [key] uniquely identifies the entry (a package can expose more than one launcher activity).
 */
@Immutable
data class AppInfo(
    val packageName: String,
    val activityName: String,
    val label: String,
    val category: AppCategory,
    val isSystemApp: Boolean,
    val firstInstallTime: Long,
) {
    val key: String get() = "$packageName/$activityName"

    /** Lower-cased haystack used by the fuzzy matcher. */
    val searchIndex: String = buildString {
        append(label.lowercase())
        append(' ')
        append(packageName.lowercase())
    }
}

enum class AppCategory {
    GAME,
    SOCIAL,
    PRODUCTIVITY,
    MEDIA,
    NEWS,
    MAPS,
    SYSTEM,
    OTHER,
}
