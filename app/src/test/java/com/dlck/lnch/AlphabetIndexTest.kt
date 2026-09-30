package com.dlck.lnch

import com.dlck.lnch.utils.AlphabetIndex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The drawer's fast-scroll rail must map letters to the right rows, in Persian too. */
class AlphabetIndexTest {

    @Test
    fun `sections point at the first app of each letter`() {
        val sections = AlphabetIndex.build(listOf("Camera", "Calendar", "Drive", "Maps"))
        assertEquals(listOf("C", "D", "M"), sections.map { it.letter })
        assertEquals(listOf(0, 2, 3), sections.map { it.index })
    }

    @Test
    fun `digits and symbols share the other bucket`() {
        val sections = AlphabetIndex.build(listOf("1Weather", "+Note", "Apk"))
        assertEquals(listOf("#", "A"), sections.map { it.letter })
        assertEquals(0, sections.first().index)
    }

    @Test
    fun `arabic letter variants are folded into their persian form`() {
        assertEquals("ا", AlphabetIndex.bucketOf("آپارات"))
        assertEquals("ا", AlphabetIndex.bucketOf("اینستاگرام"))
        assertEquals("ک", AlphabetIndex.bucketOf("كتابخانه"))
        assertEquals("ی", AlphabetIndex.bucketOf("يادداشت"))
    }

    @Test
    fun `a repeated letter does not create a second section`() {
        // Pinned apps float to the top, so the list is not strictly sorted.
        val sections = AlphabetIndex.build(listOf("Zoom", "Arc", "Zebra"))
        assertEquals(listOf("Z", "A"), sections.map { it.letter })
    }

    @Test
    fun `blank labels fall back to the other bucket`() {
        assertEquals("#", AlphabetIndex.bucketOf(""))
        assertEquals("#", AlphabetIndex.bucketOf("   "))
    }

    @Test
    fun `touch offsets map to clamped indices`() {
        assertEquals(0, AlphabetIndex.indexForOffset(0f, 300, 10))
        assertEquals(5, AlphabetIndex.indexForOffset(150f, 300, 10))
        assertEquals(9, AlphabetIndex.indexForOffset(299f, 300, 10))
        assertEquals(9, AlphabetIndex.indexForOffset(9000f, 300, 10))
        assertEquals(0, AlphabetIndex.indexForOffset(-40f, 300, 10))
        assertEquals(-1, AlphabetIndex.indexForOffset(10f, 300, 0))
    }

    @Test
    fun `an empty list produces no sections`() {
        assertTrue(AlphabetIndex.build(emptyList()).isEmpty())
    }
}
