package com.dlck.lnch.ai.intent

import com.dlck.lnch.data.apps.AppInfo

/**
 * Fuzzy app resolution that understands Persian input.
 *
 * Handles: case, Arabic/Persian letter variants (ي/ی, ك/ک), zero-width non-joiner, Persian and
 * Arabic digits, and a transliteration table so «یوتیوب» finds "YouTube".
 */
object AppMatcher {

    private val transliterations: Map<String, List<String>> = mapOf(
        "یوتیوب" to listOf("youtube"),
        "یوتوب" to listOf("youtube"),
        "تلگرام" to listOf("telegram"),
        "واتساپ" to listOf("whatsapp"),
        "واتس اپ" to listOf("whatsapp"),
        "اینستاگرام" to listOf("instagram"),
        "اینستا" to listOf("instagram"),
        "کروم" to listOf("chrome"),
        "گوگل" to listOf("google"),
        "جیمیل" to listOf("gmail"),
        "ایمیل" to listOf("gmail", "mail", "email"),
        "دوربین" to listOf("camera"),
        "گالری" to listOf("gallery", "photos"),
        "عکس" to listOf("photos", "gallery"),
        "پیام" to listOf("messages", "messaging", "sms"),
        "پیامک" to listOf("messages", "messaging", "sms"),
        "تنظیمات" to listOf("settings"),
        "ماشین حساب" to listOf("calculator"),
        "ماشین‌حساب" to listOf("calculator"),
        "موزیک" to listOf("music", "player"),
        "آهنگ" to listOf("music", "player"),
        "اسپاتیفای" to listOf("spotify"),
        "مرورگر" to listOf("browser", "chrome", "firefox"),
        "تلفن" to listOf("phone", "dialer"),
        "تماس" to listOf("phone", "dialer"),
        "مخاطبین" to listOf("contacts"),
        "ساعت" to listOf("clock"),
        "تقویم" to listOf("calendar"),
        "نقشه" to listOf("maps"),
        "فروشگاه" to listOf("play store", "market", "bazaar"),
        "بازار" to listOf("bazaar", "cafe bazaar"),
        "دیوار" to listOf("divar"),
        "اسنپ" to listOf("snapp"),
        "فایل" to listOf("files", "file manager"),
        "یادداشت" to listOf("keep", "notes"),
        "ویدیو" to listOf("video", "player"),
        "بازی" to listOf("game"),
    )

    fun normalize(input: String): String {
        val sb = StringBuilder(input.length)
        for (ch in input.lowercase().trim()) {
            val mapped = when (ch) {
                'ي' -> 'ی'
                'ك' -> 'ک'
                'ۀ' -> 'ه'
                'أ', 'إ', 'آ' -> 'ا'
                '\u200c', '\u200f', '\u200e' -> ' '
                in '۰'..'۹' -> '0' + (ch - '۰')
                in '٠'..'٩' -> '0' + (ch - '٠')
                else -> ch
            }
            if (!mapped.isWhitespace() || (sb.isNotEmpty() && sb.last() != ' ')) sb.append(mapped)
        }
        return sb.toString().trim()
    }

    private fun expand(query: String): List<String> {
        val normalized = normalize(query)
        val extra = transliterations.entries
            .filter { normalized.contains(normalize(it.key)) }
            .flatMap { it.value }
        return (listOf(normalized) + extra).distinct().filter { it.isNotBlank() }
    }

    /** Returns candidates ordered best-first. Empty when nothing plausibly matches. */
    fun rank(query: String, apps: List<AppInfo>): List<AppInfo> {
        if (query.isBlank() || apps.isEmpty()) return emptyList()
        val needles = expand(query)

        return apps.asSequence()
            .map { app -> app to score(needles, app) }
            .filter { it.second > 0 }
            .sortedWith(
                compareByDescending<Pair<AppInfo, Int>> { it.second }
                    .thenBy { it.first.label.length },
            )
            .map { it.first }
            .toList()
    }

    fun best(query: String, apps: List<AppInfo>): AppInfo? = rank(query, apps).firstOrNull()

    private fun score(needles: List<String>, app: AppInfo): Int {
        val label = normalize(app.label)
        val pkg = app.packageName.lowercase()
        var best = 0

        for (needle in needles) {
            if (needle.isBlank()) continue
            val s = when {
                label == needle -> 100
                label.startsWith(needle) -> 85
                label.split(' ', '-', '_').any { it == needle } -> 80
                label.contains(needle) -> 70
                pkg.contains(needle.replace(" ", "")) -> 60
                needle.length >= 4 && label.isNotEmpty() && similar(label, needle) -> 45
                tokensOverlap(label, needle) -> 40
                else -> 0
            }
            if (s > best) best = s
        }
        return best
    }

    private fun tokensOverlap(label: String, needle: String): Boolean {
        val labelTokens = label.split(' ', '-', '_').filter { it.length > 2 }.toSet()
        val needleTokens = needle.split(' ', '-', '_').filter { it.length > 2 }
        return needleTokens.any { token -> labelTokens.any { it.startsWith(token) } }
    }

    /** Cheap edit-distance gate for typos (distance <= 2 relative to the shorter string). */
    private fun similar(a: String, b: String): Boolean {
        if (kotlin.math.abs(a.length - b.length) > 3) return false
        val distance = levenshtein(a.take(24), b.take(24))
        return distance <= if (b.length <= 5) 1 else 2
    }

    private fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var previous = IntArray(b.length + 1) { it }
        var current = IntArray(b.length + 1)
        for (i in 1..a.length) {
            current[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                current[j] = minOf(
                    current[j - 1] + 1,
                    previous[j] + 1,
                    previous[j - 1] + cost,
                )
            }
            val swap = previous
            previous = current
            current = swap
        }
        return previous[b.length]
    }
}
