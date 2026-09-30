package com.dlck.lnch

import com.dlck.lnch.ai.predict.Suggester
import com.dlck.lnch.data.prefs.UsageStat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** On-device predictions must be deterministic, time-aware and safe on empty data. */
class SuggesterTest {

    private val now = 1_700_000_000_000L
    private val hour = 3_600_000L

    private fun stat(count: Int, ageHours: Long, vararg activeHours: Int): UsageStat {
        val histogram = MutableList(24) { 0 }
        activeHours.forEach { histogram[it] = count }
        return UsageStat(
            launchCount = count,
            lastLaunchedAt = now - ageHours * hour,
            hours = histogram,
        )
    }

    @Test
    fun `empty usage yields no suggestions`() {
        assertTrue(Suggester.rank(emptyMap(), 9, now).isEmpty())
    }

    @Test
    fun `the app used at this hour wins over a globally more popular one`() {
        val usage = mapOf(
            "morning" to stat(10, 24, 8),
            "evening" to stat(40, 24, 21),
        )
        assertEquals("morning", Suggester.rank(usage, 8, now).first())
        assertEquals("evening", Suggester.rank(usage, 21, now).first())
    }

    @Test
    fun `neighbouring hours still count, at half weight`() {
        val usage = mapOf(
            "eight" to stat(10, 24, 8),
            "noon" to stat(10, 24, 12),
        )
        // 09:00 is adjacent to the 8am app and far from the noon one.
        assertEquals("eight", Suggester.rank(usage, 9, now).first())
    }

    @Test
    fun `recency breaks ties between equally used apps`() {
        val usage = mapOf(
            "fresh" to stat(5, 1, 10),
            "stale" to stat(5, 200, 10),
        )
        assertEquals(listOf("fresh", "stale"), Suggester.rank(usage, 10, now))
    }

    @Test
    fun `hour wraps around midnight`() {
        val usage = mapOf("night" to stat(6, 2, 23))
        assertEquals("night", Suggester.rank(usage, 24, now).first())
        assertEquals("night", Suggester.rank(usage, -1, now).first())
    }

    @Test
    fun `legacy stats without an histogram still rank by recency and frequency`() {
        val usage = mapOf(
            "old" to UsageStat(launchCount = 3, lastLaunchedAt = now - 2 * hour),
            "older" to UsageStat(launchCount = 1, lastLaunchedAt = now - 100 * hour),
        )
        assertEquals(listOf("old", "older"), Suggester.rank(usage, 12, now))
    }

    @Test
    fun `the limit is respected and scores are ordered`() {
        val usage = (1..10).associate { "app$it" to stat(it, it.toLong(), 7) }
        val ranked = Suggester.rank(usage, 7, now, limit = 3)
        assertEquals(3, ranked.size)
        val scores = Suggester.score(usage, 7, now).map { it.score }
        assertEquals(scores.sortedDescending(), scores)
    }

    @Test
    fun `recording a launch fills the right hour bucket`() {
        val first = UsageStat().withLaunchAt(8)
        assertEquals(24, first.hours.size)
        assertEquals(1, first.hours[8])
        assertEquals(0, first.hours[9])

        val second = first.withLaunchAt(8).withLaunchAt(23)
        assertEquals(2, second.hours[8])
        assertEquals(1, second.hours[23])

        // Out-of-range hours wrap instead of crashing.
        assertEquals(1, UsageStat().withLaunchAt(25).hours[1])
    }

    @Test
    fun `an app that was never launched scores zero and is dropped`() {
        val usage = mapOf(
            "used" to stat(2, 1, 5),
            "never" to UsageStat(),
        )
        assertEquals(listOf("used"), Suggester.rank(usage, 5, now))
    }
}
