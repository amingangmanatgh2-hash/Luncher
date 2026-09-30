package com.dlck.lnch.data.apps

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.graphics.drawable.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Small bounded icon cache. Icons are decoded off the main thread and kept as [ImageBitmap]s so
 * Compose can draw them without per-frame conversions. Bounded by memory class to stay light.
 *
 * When an icon pack is active ([applyPack]) its themed drawable wins; anything the pack does not
 * define silently falls back to the app's own icon, so a partial pack still looks complete.
 */
class IconCache(
    private val context: Context,
    private val iconPacks: IconPackRepository = IconPackRepository(context),
) {

    private val pm: PackageManager = context.packageManager
    private val mutex = Mutex()

    private val cache = object : LruCache<String, ImageBitmap>(MAX_ENTRIES) {
        override fun sizeOf(key: String, value: ImageBitmap): Int = 1
    }

    /** Bumped whenever the icon set changes, so Compose knows to re-read every tile. */
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version

    private var packId: String = ""

    private fun cacheKey(key: String): String = if (packId.isEmpty()) key else "$packId|$key"

    fun peek(key: String): ImageBitmap? = cache.get(cacheKey(key))

    /** Switches (or clears, with a blank name) the active icon pack and invalidates the cache. */
    suspend fun applyPack(packageName: String) {
        if (packageName == packId) return
        iconPacks.select(packageName)
        packId = if (iconPacks.activePack == packageName) packageName else ""
        mutex.withLock { cache.evictAll() }
        _version.value = _version.value + 1
    }

    suspend fun installedPacks(): List<IconPackRepository.Pack> = iconPacks.installedPacks()

    suspend fun load(app: AppInfo, sizePx: Int): ImageBitmap? {
        val key = cacheKey(app.key)
        cache.get(key)?.let { return it }
        val decoded = withContext(Dispatchers.IO) {
            runCatching { resolveDrawable(app)?.toImageBitmap(sizePx) }.getOrNull()
        } ?: return null
        mutex.withLock { cache.put(key, decoded) }
        return decoded
    }

    private fun resolveDrawable(app: AppInfo): Drawable? = themedDrawable(app) ?: runCatching {
        val component = ComponentName(app.packageName, app.activityName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getActivityInfo(component, PackageManager.ComponentInfoFlags.of(0L))
                .loadIcon(pm)
        } else {
            @Suppress("DEPRECATION")
            pm.getActivityInfo(component, 0).loadIcon(pm)
        }
    }.recoverCatching {
        pm.getApplicationIcon(app.packageName)
    }.recoverCatching {
        pm.getLaunchIntentForPackage(app.packageName)
            ?.let { pm.resolveActivity(it, 0)?.loadIcon(pm) }
            ?: pm.defaultActivityIcon
    }.getOrNull()

    private fun themedDrawable(app: AppInfo): Drawable? =
        if (packId.isEmpty()) null else iconPacks.drawableFor(app.packageName, app.activityName)

    private fun Drawable.toImageBitmap(sizePx: Int): ImageBitmap {
        val size = sizePx.coerceIn(48, 256)
        return toBitmap(size, size, Bitmap.Config.ARGB_8888).asImageBitmap()
    }

    fun clear() {
        cache.evictAll()
        _version.value = _version.value + 1
    }

    companion object {
        private const val MAX_ENTRIES = 220
    }
}

/** Convenience: an icon for an arbitrary package (used by the AI action cards). */
fun Context.appLabelOrNull(packageName: String): String? = runCatching {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString()
}.getOrNull()

/** Standard "can this intent be handled" check used before firing any AI-requested intent. */
fun Context.canHandle(intent: Intent): Boolean = runCatching {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
    } else {
        @Suppress("DEPRECATION")
        packageManager.queryIntentActivities(intent, 0)
    }.isNotEmpty()
}.getOrDefault(false)
