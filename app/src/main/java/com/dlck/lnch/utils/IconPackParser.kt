package com.dlck.lnch.utils

/**
 * Parser for the de-facto standard `appfilter.xml` shipped inside Android icon packs.
 *
 * A pack maps a launchable component to a drawable name:
 *
 * ```xml
 * <item component="ComponentInfo{com.whatsapp/com.whatsapp.Main}" drawable="whatsapp" />
 * ```
 *
 * Every major icon pack (ADW, Nova, Go, Apex…) uses this format, which is why supporting it is
 * enough to make thousands of existing packs work. The parsing itself is deliberately pure text
 * handling: no Android class, no resource access, fully unit-testable, and immune to the malformed
 * XML that real-world packs are full of.
 */
object IconPackParser {

    private val ITEM = Regex("<\\s*item\\b([^>]*)/?\\s*>", RegexOption.IGNORE_CASE)
    private val ATTRIBUTE = Regex("([a-zA-Z_:]+)\\s*=\\s*\"([^\"]*)\"")
    private val COMPONENT = Regex("ComponentInfo\\{([^}]*)}", RegexOption.IGNORE_CASE)

    /**
     * @return map of `packageName/activityName` → drawable resource name.
     *         Malformed entries are skipped instead of aborting the whole pack.
     */
    fun parse(xml: String): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        for (match in ITEM.findAll(xml)) {
            val attributes = attributesOf(match.groupValues[1])
            val component = attributes["component"] ?: continue
            val drawable = attributes["drawable"]?.trim().orEmpty()
            if (drawable.isEmpty()) continue
            val key = componentKey(component) ?: continue
            // First definition wins: packs often list a generic fallback later in the file.
            if (!result.containsKey(key)) result[key] = drawable
        }
        return result
    }

    /**
     * `ComponentInfo{pkg/activity}` → `pkg/activity`.
     * Also accepts a bare `pkg/activity`, and expands the `pkg/.Relative` shorthand.
     */
    fun componentKey(raw: String): String? {
        val inner = COMPONENT.find(raw)?.groupValues?.get(1)?.trim() ?: raw.trim()
        if (inner.isEmpty() || !inner.contains('/')) return null
        val packageName = inner.substringBefore('/').trim()
        val activity = inner.substringAfter('/').trim()
        if (packageName.isEmpty() || activity.isEmpty()) return null
        val absolute = if (activity.startsWith('.')) packageName + activity else activity
        return "$packageName/$absolute"
    }

    /** Drawable name for a component, falling back to any entry of the same package. */
    fun lookup(mapping: Map<String, String>, packageName: String, activityName: String): String? {
        mapping["$packageName/$activityName"]?.let { return it }
        val prefix = "$packageName/"
        return mapping.entries.firstOrNull { it.key.startsWith(prefix) }?.value
    }

    private fun attributesOf(raw: String): Map<String, String> =
        ATTRIBUTE.findAll(raw).associate { match ->
            match.groupValues[1].substringAfterLast(':').lowercase() to match.groupValues[2]
        }
}
