package com.dlck.lnch

import com.dlck.lnch.utils.IconPackParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Real icon packs ship messy XML; the parser must survive all of it. */
class IconPackParserTest {

    private val sample = """
        <resources>
            <item component="ComponentInfo{com.whatsapp/com.whatsapp.Main}" drawable="whatsapp"/>
            <item component="ComponentInfo{org.telegram.messenger/org.telegram.ui.LaunchActivity}"
                  drawable="telegram" />
            <item component="ComponentInfo{com.foo/.Main}" drawable="foo" />
            <item component="ComponentInfo{com.broken/}" drawable="broken" />
            <item component="ComponentInfo{com.nodrawable/com.nodrawable.A}" drawable="" />
            <calendar component="ComponentInfo{com.cal/com.cal.A}" prefix="cal_" />
        </resources>
    """.trimIndent()

    @Test
    fun `components are mapped to drawables`() {
        val map = IconPackParser.parse(sample)
        assertEquals("whatsapp", map["com.whatsapp/com.whatsapp.Main"])
        assertEquals(
            "telegram",
            map["org.telegram.messenger/org.telegram.ui.LaunchActivity"],
        )
    }

    @Test
    fun `the relative activity shorthand is expanded`() {
        val map = IconPackParser.parse(sample)
        assertEquals("foo", map["com.foo/com.foo.Main"])
    }

    @Test
    fun `malformed entries are skipped, not fatal`() {
        val map = IconPackParser.parse(sample)
        assertTrue(map.keys.none { it.startsWith("com.broken") })
        assertTrue(map.keys.none { it.startsWith("com.nodrawable") })
        assertEquals(3, map.size)
    }

    @Test
    fun `the first definition of a component wins`() {
        val xml = """
            <item component="ComponentInfo{a/b}" drawable="first" />
            <item component="ComponentInfo{a/b}" drawable="second" />
        """.trimIndent()
        assertEquals("first", IconPackParser.parse(xml)["a/b"])
    }

    @Test
    fun `componentKey accepts both wrapped and bare forms`() {
        assertEquals("p/a", IconPackParser.componentKey("ComponentInfo{p/a}"))
        assertEquals("p/a", IconPackParser.componentKey("p/a"))
        assertNull(IconPackParser.componentKey("nonsense"))
        assertNull(IconPackParser.componentKey("ComponentInfo{}"))
    }

    @Test
    fun `lookup falls back to any activity of the same package`() {
        val map = mapOf("com.x/com.x.Old" to "x_icon")
        assertEquals("x_icon", IconPackParser.lookup(map, "com.x", "com.x.New"))
        assertNull(IconPackParser.lookup(map, "com.y", "com.y.Main"))
    }

    @Test
    fun `an empty or junk file yields an empty mapping`() {
        assertTrue(IconPackParser.parse("").isEmpty())
        assertTrue(IconPackParser.parse("<<<>>> not xml").isEmpty())
    }
}
