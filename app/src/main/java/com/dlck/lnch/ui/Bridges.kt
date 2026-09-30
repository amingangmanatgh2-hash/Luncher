package com.dlck.lnch.ui

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Things only an Activity can do (Storage Access Framework dialogs), exposed to Compose without
 * dragging the Activity itself into every screen.
 */
interface BackupBridge {
    /** Opens the system "create document" dialog and writes the backup there. */
    fun exportBackup()

    /** Opens the system file picker and restores from the chosen file. */
    fun restoreBackup()
}

val LocalBackupBridge = staticCompositionLocalOf<BackupBridge?> { null }
