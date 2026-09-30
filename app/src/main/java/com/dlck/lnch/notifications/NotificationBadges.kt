package com.dlck.lnch.notifications

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Unread-notification dots on app icons.
 *
 * The count comes from a [NotificationListenerService], which the user must enable explicitly in
 * system settings — the launcher cannot grant it to itself, and it works fine without it. Only
 * the *number* of notifications per package is kept: no titles, no text, no sender, nothing is
 * stored on disk and nothing ever leaves the device.
 */
object NotificationBadges {

    private val _counts = MutableStateFlow<Map<String, Int>>(emptyMap())

    /** package name → number of dismissible notifications currently shown. */
    val counts: StateFlow<Map<String, Int>> = _counts

    internal fun publish(counts: Map<String, Int>) {
        _counts.value = counts
    }

    internal fun clear() {
        _counts.value = emptyMap()
    }

    /** True when the user has granted notification access to DLCK LNCH. */
    fun isEnabled(context: Context): Boolean = runCatching {
        val flat = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners",
        ).orEmpty()
        val expected = ComponentName(context, DlckNotificationListener::class.java)
        flat.split(':').any { entry ->
            val component = ComponentName.unflattenFromString(entry)
            component != null && component.packageName == expected.packageName
        }
    }.getOrDefault(false)

    /** Intent for the system screen where notification access is granted. */
    fun settingsIntent(): Intent =
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/**
 * Counts active notifications per package.
 *
 * Ongoing notifications (music players, VPN, foreground services) and group summaries are skipped
 * so the dot means "something new for you", not "this app is running".
 */
class DlckNotificationListener : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        recount()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        NotificationBadges.clear()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) = recount()

    override fun onNotificationRemoved(sbn: StatusBarNotification?) = recount()

    private fun recount() {
        val active = runCatching { activeNotifications }.getOrNull() ?: return
        val counts = HashMap<String, Int>()
        for (notification in active) {
            if (notification == null) continue
            if (notification.isOngoing) continue
            val isGroupSummary = runCatching {
                (notification.notification.flags and android.app.Notification.FLAG_GROUP_SUMMARY) != 0
            }.getOrDefault(false)
            if (isGroupSummary) continue
            val pkg = notification.packageName ?: continue
            counts[pkg] = (counts[pkg] ?: 0) + 1
        }
        NotificationBadges.publish(counts)
    }
}
