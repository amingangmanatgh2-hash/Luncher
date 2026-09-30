package com.dlck.lnch.ai.predict

import com.dlck.lnch.data.prefs.UsageStat

/**
 * On-device app prediction.
 *
 * Ranks apps by *when* you normally use them, not just how often. Everything happens locally from
 * the launcher's own launch history — no network call, no Gemini request, no data leaves the
 * device, and it works with zero permissions.
 *
 * The score blends three signals:
 *
 *  * **context (50%)** – launches recorded in this hour, plus the neighbouring hours at half
 *    weight, so an app used "around 8am" still surfaces at 7:40.
 *  * **recency (30%)** – a decay curve, halving roughly every six hours.
 *  * **frequency (20%)** – overall launch count, as a tiebreaker for new time slots.
 *
 * Pure Kotlin on purpose: it is fully unit-tested without an emulator.
 */
object Suggester {

    private const val CONTEXT_WEIGHT = 0.5
    private const val RECENCY_WEIGHT = 0.3
    private const val FREQUENCY_WEIGHT = 0.2
    private const val NEIGHBOUR_WEIGHT = 0.5
    private const val RECENCY_HALF_LIFE_HOURS = 6.0

    data class Scored(val key: String, val score: Double)

    /**
     * @param usage launch statistics keyed by [com.dlck.lnch.data.apps.AppInfo.key]
     * @param hour  current hour of day, 0..23
     * @param now   current wall-clock time in millis
     */
    fun score(usage: Map<String, UsageStat>, hour: Int, now: Long): List<Scored> {
        if (usage.isEmpty()) return emptyList()
        val safeHour = ((hour % 24) + 24) % 24

        val contextRaw = usage.mapValues { (_, stat) -> contextCount(stat, safeHour) }
        val maxContext = contextRaw.values.maxOrNull() ?: 0.0
        val maxCount = usage.values.maxOfOrNull { it.launchCount } ?: 0

        return usage.map { (key, stat) ->
            val context = if (maxContext > 0.0) (contextRaw[key] ?: 0.0) / maxContext else 0.0
            val frequency = if (maxCount > 0) stat.launchCount.toDouble() / maxCount else 0.0
            val recency = recencyScore(stat.lastLaunchedAt, now)
            Scored(
                key = key,
                score = CONTEXT_WEIGHT * context +
                    RECENCY_WEIGHT * recency +
                    FREQUENCY_WEIGHT * frequency,
            )
        }.sortedWith(compareByDescending<Scored> { it.score }.thenBy { it.key })
    }

    /** Convenience wrapper returning just the keys of the best [limit] candidates. */
    fun rank(usage: Map<String, UsageStat>, hour: Int, now: Long, limit: Int = 8): List<String> =
        score(usage, hour, now)
            .filter { it.score > 0.0 }
            .take(limit)
            .map { it.key }

    private fun contextCount(stat: UsageStat, hour: Int): Double {
        if (stat.hours.size != 24) return 0.0
        val previous = stat.hours[(hour + 23) % 24]
        val next = stat.hours[(hour + 1) % 24]
        return stat.hours[hour] + NEIGHBOUR_WEIGHT * (previous + next)
    }

    private fun recencyScore(lastLaunchedAt: Long, now: Long): Double {
        if (lastLaunchedAt <= 0L) return 0.0
        val ageHours = (now - lastLaunchedAt).coerceAtLeast(0L) / 3_600_000.0
        return 1.0 / (1.0 + ageHours / RECENCY_HALF_LIFE_HOURS)
    }
}
