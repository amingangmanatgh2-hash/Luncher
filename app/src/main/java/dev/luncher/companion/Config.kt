package dev.luncher.companion

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Local persistence for configs and subscriptions.
 *
 * Stored as JSON in SharedPreferences rather than a database. The data set is
 * tens of rows, there are no joins and no concurrent writers, so Room would add
 * an annotation processor to the build for no benefit — and an annotation
 * processor is exactly the kind of thing that breaks a CI build in ways a log
 * cannot explain.
 */

data class Config(
    val id: String,
    val name: String,
    val link: String,
    val protocol: String,
    val createdAt: Long,
    val subId: String?,
)

data class Subscription(
    val id: String,
    val name: String,
    val url: String,
    val addedAt: Long,
    val lastFetchAt: Long,
)

/** Share-link schemes this app recognises. Unknown schemes are still accepted
 *  and handed to the OS, because new protocols appear faster than we can list
 *  them and refusing one silently is worse than trying. */
val KNOWN_PROTOCOLS = listOf("vless", "trojan", "vmess", "ss", "ssr", "tuic", "hy2", "hysteria", "hysteria2", "wireguard", "ssh")

object ConfigStore {
    private const val PREFS = "luncher"
    private const val KEY_CONFIGS = "configs"
    private const val KEY_SUBS = "subscriptions"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun protocolOf(link: String): String {
        val i = link.indexOf("://")
        if (i <= 0) return "unknown"
        return link.substring(0, i).lowercase()
    }

    /** Pull the human name out of the `#remark` fragment of a share link. */
    fun remarkOf(link: String): String? {
        val hash = link.lastIndexOf('#')
        if (hash < 0 || hash == link.length - 1) return null
        return try {
            java.net.URLDecoder.decode(link.substring(hash + 1), "UTF-8").ifBlank { null }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Extract every share link from a blob of text.
     *
     * Subscriptions arrive either as newline-separated links or as base64 of the
     * same, so both are handled here. Decoding is attempted only when the text
     * does not already look like links, to avoid mangling a plain list.
     */
    fun extractLinks(text: String): List<String> {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return emptyList()

        val direct = trimmed.split(Regex("[\\r\\n]+")).map { it.trim() }.filter { it.contains("://") }
        if (direct.isNotEmpty()) return direct

        return try {
            val decoded = String(android.util.Base64.decode(trimmed, android.util.Base64.DEFAULT), Charsets.UTF_8)
            decoded.split(Regex("[\\r\\n]+")).map { it.trim() }.filter { it.contains("://") }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun configs(context: Context): List<Config> {
        val raw = prefs(context).getString(KEY_CONFIGS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Config(
                    id = o.getString("id"),
                    name = o.optString("name"),
                    link = o.getString("link"),
                    protocol = o.optString("protocol", "unknown"),
                    createdAt = o.optLong("createdAt"),
                    subId = if (o.isNull("subId")) null else o.optString("subId"),
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun subscriptions(context: Context): List<Subscription> {
        val raw = prefs(context).getString(KEY_SUBS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Subscription(
                    id = o.getString("id"),
                    name = o.optString("name"),
                    url = o.getString("url"),
                    addedAt = o.optLong("addedAt"),
                    lastFetchAt = o.optLong("lastFetchAt"),
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** Adds links, skipping exact duplicates. Returns how many were added. */
    fun addLinks(context: Context, links: List<String>, subId: String?, fallbackName: String?): Int {
        val existing = configs(context).toMutableList()
        val seen = existing.map { it.link }.toMutableSet()
        var added = 0
        for (link in links) {
            if (link.isBlank() || seen.contains(link)) continue
            seen.add(link)
            val remark = remarkOf(link)
            existing.add(
                Config(
                    id = UUID.randomUUID().toString(),
                    name = remark ?: fallbackName ?: protocolOf(link).uppercase(),
                    link = link,
                    protocol = protocolOf(link),
                    createdAt = System.currentTimeMillis(),
                    subId = subId,
                )
            )
            added++
        }
        if (added > 0) writeConfigs(context, existing)
        return added
    }

    fun delete(context: Context, id: String) {
        writeConfigs(context, configs(context).filterNot { it.id == id })
    }

    fun deleteSubscription(context: Context, id: String) {
        writeSubs(context, subscriptions(context).filterNot { it.id == id })
        writeConfigs(context, configs(context).filterNot { it.subId == id })
    }

    fun addSubscription(context: Context, name: String, url: String): Subscription {
        val sub = Subscription(
            id = UUID.randomUUID().toString(),
            name = name.ifBlank { url },
            url = url,
            addedAt = System.currentTimeMillis(),
            lastFetchAt = 0L,
        )
        writeSubs(context, subscriptions(context) + sub)
        return sub
    }

    fun touchSubscription(context: Context, id: String) {
        writeSubs(context, subscriptions(context).map {
            if (it.id == id) it.copy(lastFetchAt = System.currentTimeMillis()) else it
        })
    }

    private fun writeConfigs(context: Context, list: List<Config>) {
        val arr = JSONArray()
        for (c in list) {
            arr.put(JSONObject().apply {
                put("id", c.id); put("name", c.name); put("link", c.link)
                put("protocol", c.protocol); put("createdAt", c.createdAt)
                put("subId", c.subId ?: JSONObject.NULL)
            })
        }
        prefs(context).edit().putString(KEY_CONFIGS, arr.toString()).apply()
    }

    private fun writeSubs(context: Context, list: List<Subscription>) {
        val arr = JSONArray()
        for (s in list) {
            arr.put(JSONObject().apply {
                put("id", s.id); put("name", s.name); put("url", s.url)
                put("addedAt", s.addedAt); put("lastFetchAt", s.lastFetchAt)
            })
        }
        prefs(context).edit().putString(KEY_SUBS, arr.toString()).apply()
    }
}
