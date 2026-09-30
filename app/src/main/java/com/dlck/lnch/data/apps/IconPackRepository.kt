package com.dlck.lnch.data.apps

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Resources
import android.graphics.drawable.Drawable
import com.dlck.lnch.utils.IconPackParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Third-party icon-pack support.
 *
 * Finds the icon packs installed on the device (they all advertise one of a handful of legacy
 * theme intents), reads their `appfilter.xml` and resolves per-app drawables from the pack's own
 * resources. Nothing is downloaded and no code from the pack is ever executed — only its
 * resources are read, through the normal `PackageManager` APIs.
 */
class IconPackRepository(private val context: Context) {

    data class Pack(val packageName: String, val label: String)

    private val mutex = Mutex()
    private var loadedPackage: String? = null
    private var mapping: Map<String, String> = emptyMap()
    private var packResources: Resources? = null

    /** Icon packs installed on this device, sorted by name. */
    suspend fun installedPacks(): List<Pack> = withContext(Dispatchers.IO) {
        val pm = context.packageManager
        val found = LinkedHashMap<String, Pack>()
        for (action in THEME_ACTIONS) {
            val intent = Intent(action)
            val matches = runCatching {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(intent, PackageManager.GET_META_DATA)
            }.getOrDefault(emptyList())
            for (resolve in matches) {
                val pkg = resolve.activityInfo?.packageName ?: continue
                if (found.containsKey(pkg)) continue
                val label = runCatching { resolve.loadLabel(pm).toString() }.getOrDefault(pkg)
                found[pkg] = Pack(pkg, label)
            }
        }
        found.values.sortedBy { it.label.lowercase() }
    }

    /** Loads (and caches) the mapping of the selected pack. Blank clears it. */
    suspend fun select(packageName: String) = mutex.withLock {
        if (packageName == loadedPackage) return@withLock
        if (packageName.isBlank()) {
            loadedPackage = null
            mapping = emptyMap()
            packResources = null
            return@withLock
        }
        withContext(Dispatchers.IO) {
            runCatching {
                val resources = context.packageManager.getResourcesForApplication(packageName)
                packResources = resources
                mapping = IconPackParser.parse(readAppFilter(resources, packageName))
                loadedPackage = packageName
            }.onFailure {
                loadedPackage = null
                mapping = emptyMap()
                packResources = null
            }
        }
        Unit
    }

    /** @return the themed drawable for this component, or null to fall back to the stock icon. */
    fun drawableFor(packageName: String, activityName: String): Drawable? {
        val resources = packResources ?: return null
        val pack = loadedPackage ?: return null
        val name = IconPackParser.lookup(mapping, packageName, activityName) ?: return null
        return runCatching {
            @Suppress("DiscouragedApi")
            val id = resources.getIdentifier(name, "drawable", pack)
            if (id == 0) null else androidx.core.content.res.ResourcesCompat.getDrawable(
                resources,
                id,
                null,
            )
        }.getOrNull()
    }

    /** True when a pack is currently active, used as part of the icon cache key. */
    val activePack: String? get() = loadedPackage

    private fun readAppFilter(resources: Resources, packageName: String): String {
        // Packs ship appfilter either as an XML resource or as a raw asset; try both.
        @Suppress("DiscouragedApi")
        val xmlId = resources.getIdentifier("appfilter", "xml", packageName)
        if (xmlId != 0) {
            runCatching {
                val parser = resources.getXml(xmlId)
                return xmlToText(parser)
            }
        }
        return runCatching {
            context.packageManager
                .getResourcesForApplication(packageName)
                .assets
                .open("appfilter.xml")
                .bufferedReader()
                .use { it.readText() }
        }.getOrDefault("")
    }

    /**
     * Compiled XML cannot be read as text, so it is walked once and re-serialised into the same
     * `<item component=… drawable=… />` shape [IconPackParser] understands.
     */
    private fun xmlToText(parser: android.content.res.XmlResourceParser): String = buildString {
        var event = parser.eventType
        while (event != org.xmlpull.v1.XmlPullParser.END_DOCUMENT) {
            if (event == org.xmlpull.v1.XmlPullParser.START_TAG && parser.name == "item") {
                val component = parser.getAttributeValue(null, "component")
                val drawable = parser.getAttributeValue(null, "drawable")
                if (!component.isNullOrEmpty() && !drawable.isNullOrEmpty()) {
                    append("<item component=\"")
                    append(component)
                    append("\" drawable=\"")
                    append(drawable)
                    append("\" />\n")
                }
            }
            event = parser.next()
        }
        parser.close()
    }

    private companion object {
        val THEME_ACTIONS = listOf(
            "org.adw.launcher.THEMES",
            "com.gau.go.launcherex.theme",
            "com.novalauncher.THEME",
            "com.anddoes.launcher.THEME",
            "ch.deletescape.lawnchair.ICONPACK",
        )
    }
}
