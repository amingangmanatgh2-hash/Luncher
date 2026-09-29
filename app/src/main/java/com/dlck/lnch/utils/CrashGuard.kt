package com.dlck.lnch.utils

import android.app.Application
import android.content.Intent
import android.os.Process
import android.util.Log
import kotlin.system.exitProcess

/**
 * A launcher that crashes leaves the user staring at a black screen with no way back, so an
 * uncaught exception restarts the home screen instead of killing the session.
 *
 * A loop guard makes sure a permanently broken state does not restart forever.
 *
 * Nothing sensitive is logged here: only the exception class and stack trace of our own code.
 */
object CrashGuard {

    private const val TAG = "DlckLnchCrash"
    private const val MIN_RESTART_INTERVAL_MS = 15_000L

    @Volatile
    private var lastRestartAt = 0L

    fun install(application: Application) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            Log.e(TAG, "Uncaught exception on ${thread.name}: ${throwable.javaClass.name}", throwable)

            val now = System.currentTimeMillis()
            val canRestart = now - lastRestartAt > MIN_RESTART_INTERVAL_MS
            lastRestartAt = now

            if (canRestart) {
                runCatching {
                    val intent = Intent(application, Class.forName("com.dlck.lnch.MainActivity"))
                        .addFlags(
                            Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_ACTIVITY_CLEAR_TASK or
                                Intent.FLAG_ACTIVITY_NO_ANIMATION,
                        )
                    application.startActivity(intent)
                }.onFailure { Log.e(TAG, "Restart failed", it) }
                Process.killProcess(Process.myPid())
                exitProcess(1)
            } else {
                previous?.uncaughtException(thread, throwable) ?: run {
                    Process.killProcess(Process.myPid())
                    exitProcess(1)
                }
            }
        }
    }
}
