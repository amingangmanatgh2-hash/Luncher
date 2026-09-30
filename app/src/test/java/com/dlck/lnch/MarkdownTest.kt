package com.dlck.lnch

import androidx.compose.ui.graphics.Color
import com.dlck.lnch.ui.components.buildMarkdown
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The assistant's Markdown subset renderer must never eat text: markers are stripped when they
 * are balanced and kept verbatim when they are not.
 */
class MarkdownTest {

    private fun render(raw: String) = buildMarkdown(raw, Color.Cyan, Color.DarkGray)

    @Test
    fun `bold markers are stripped from the visible text`() {
        val result = render("open **Telegram** now")
        assertEquals("open Telegram now", result.text)
        assertTrue(result.spanStyles.isNotEmpty())
    }

    @Test
    fun `inline code is stripped and styled`() {
        val result = render("run `OPEN_APP` please")
        assertEquals("run OPEN_APP please", result.text)
        assertEquals(1, result.spanStyles.size)
    }

    @Test
    fun `bullets become real bullet glyphs`() {
        val result = render("- first\n- second")
        assertEquals("•  first\n•  second", result.text)
    }

    @Test
    fun `headings keep their content and drop the hashes`() {
        assertEquals("Title", render("## Title").text)
    }

    @Test
    fun `unbalanced markers are preserved verbatim`() {
        assertEquals("2 * 3 = 6", render("2 * 3 = 6").text)
        assertEquals("a **dangling", render("a **dangling").text)
        assertEquals("tick ` alone", render("tick ` alone").text)
    }

    @Test
    fun `persian text with bold survives intact`() {
        val result = render("**تلگرام** را باز کردم")
        assertEquals("تلگرام را باز کردم", result.text)
    }

    @Test
    fun `plain multiline text is unchanged`() {
        val raw = "line one\nline two\nline three"
        assertEquals(raw, render(raw).text)
    }
}
