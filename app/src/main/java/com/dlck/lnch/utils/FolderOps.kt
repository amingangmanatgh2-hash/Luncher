package com.dlck.lnch.utils

import com.dlck.lnch.data.prefs.FolderData

/**
 * All folder mutations in one pure place.
 *
 * Keeping the rules (no duplicates, no empty folders left behind, stable ids, names trimmed and
 * bounded) out of the repository means they can be unit-tested without Android, and the DataStore
 * layer stays a thin read-modify-write.
 */
object FolderOps {

    const val MAX_NAME_LENGTH = 32
    const val MAX_FOLDERS = 24
    const val MAX_ITEMS = 60

    /** Creates a folder with a unique id. Returns the list unchanged when the cap is reached. */
    fun create(
        folders: List<FolderData>,
        name: String,
        items: List<String> = emptyList(),
        now: Long = System.currentTimeMillis(),
    ): List<FolderData> {
        if (folders.size >= MAX_FOLDERS) return folders
        val folder = FolderData(
            id = nextId(folders, now),
            name = sanitizeName(name),
            items = items.distinct().take(MAX_ITEMS),
        )
        return folders + folder
    }

    fun rename(folders: List<FolderData>, id: String, name: String): List<FolderData> =
        folders.map { if (it.id == id) it.copy(name = sanitizeName(name)) else it }

    fun delete(folders: List<FolderData>, id: String): List<FolderData> =
        folders.filterNot { it.id == id }

    /** Adds [key] to one folder and removes it from every other one: an app lives in one folder. */
    fun addApp(folders: List<FolderData>, id: String, key: String): List<FolderData> =
        folders.map { folder ->
            when {
                folder.id == id ->
                    if (folder.items.contains(key) || folder.items.size >= MAX_ITEMS) {
                        folder
                    } else {
                        folder.copy(items = folder.items + key)
                    }

                folder.items.contains(key) -> folder.copy(items = folder.items - key)
                else -> folder
            }
        }

    fun removeApp(folders: List<FolderData>, id: String, key: String): List<FolderData> =
        folders.map { folder ->
            if (folder.id == id) folder.copy(items = folder.items - key) else folder
        }

    /** The folder currently holding [key], if any. */
    fun folderOf(folders: List<FolderData>, key: String): FolderData? =
        folders.firstOrNull { it.items.contains(key) }

    /**
     * Drops entries for apps that are no longer installed and folders that ended up empty.
     * Called whenever the app list is refreshed so uninstalls cannot leave dead icons behind.
     */
    fun prune(folders: List<FolderData>, installedKeys: Set<String>): List<FolderData> =
        folders
            .map { folder -> folder.copy(items = folder.items.filter { installedKeys.contains(it) }) }
            .filter { it.items.isNotEmpty() }

    fun sanitizeName(raw: String): String {
        val trimmed = raw.trim().replace(Regex("\\s+"), " ")
        return if (trimmed.isEmpty()) "Folder" else trimmed.take(MAX_NAME_LENGTH)
    }

    /** Monotonic-ish id that never collides with an existing one. */
    fun nextId(folders: List<FolderData>, now: Long = System.currentTimeMillis()): String {
        var candidate = "f$now"
        var suffix = 1
        val used = folders.mapTo(HashSet()) { it.id }
        while (used.contains(candidate)) {
            candidate = "f$now-$suffix"
            suffix++
        }
        return candidate
    }
}
