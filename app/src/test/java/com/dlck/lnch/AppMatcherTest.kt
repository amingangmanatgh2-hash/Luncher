package com.dlck.lnch

import com.dlck.lnch.ai.intent.AppMatcher
import com.dlck.lnch.data.apps.AppCategory
import com.dlck.lnch.data.apps.AppInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppMatcherTest {

    private fun app(label: String, pkg: String) = AppInfo(
        packageName = pkg,
        activityName = "$pkg.Main",
        label = label,
        category = AppCategory.OTHER,
        isSystemApp = false,
        firstInstallTime = 0L,
    )

    private val apps = listOf(
        app("YouTube", "com.google.android.youtube"),
        app("Telegram", "org.telegram.messenger"),
        app("Chrome", "com.android.chrome"),
        app("Settings", "com.android.settings"),
        app("Calculator", "com.android.calculator2"),
    )

    @Test
    fun `exact english match wins`() {
        assertEquals("YouTube", AppMatcher.best("youtube", apps)?.label)
    }

    @Test
    fun `persian transliteration resolves to latin app name`() {
        assertEquals("YouTube", AppMatcher.best("یوتیوب", apps)?.label)
        assertEquals("Telegram", AppMatcher.best("تلگرام", apps)?.label)
    }

    @Test
    fun `typo still resolves`() {
        assertEquals("Chrome", AppMatcher.best("chrom", apps)?.label)
    }

    @Test
    fun `unknown query returns nothing`() {
        assertNull(AppMatcher.best("zzzzqqqq", apps))
    }

    @Test
    fun `normalize unifies arabic and persian letters and digits`() {
        assertEquals(AppMatcher.normalize("كيف"), AppMatcher.normalize("کیف"))
        assertEquals("123", AppMatcher.normalize("۱۲۳"))
    }

    @Test
    fun `ranking returns multiple candidates ordered`() {
        val ranked = AppMatcher.rank("c", apps)
        assertTrue(ranked.isNotEmpty())
        assertNotNull(ranked.firstOrNull())
    }
}
