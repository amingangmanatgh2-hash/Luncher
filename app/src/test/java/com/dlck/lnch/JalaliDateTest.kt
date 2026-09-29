package com.dlck.lnch

import com.dlck.lnch.utils.JalaliDate
import org.junit.Assert.assertEquals
import org.junit.Test

class JalaliDateTest {

    @Test
    fun `nowruz 2024 maps to 1 farvardin 1403`() {
        val jalali = JalaliDate.fromGregorian(2024, 3, 20)
        assertEquals(1403, jalali.year)
        assertEquals(1, jalali.month)
        assertEquals(1, jalali.day)
    }

    @Test
    fun `end of esfand 1402`() {
        val jalali = JalaliDate.fromGregorian(2024, 3, 19)
        assertEquals(1402, jalali.year)
        assertEquals(12, jalali.month)
        assertEquals(29, jalali.day)
    }

    @Test
    fun `september 2025 maps to shahrivar 1404`() {
        val jalali = JalaliDate.fromGregorian(2025, 9, 22)
        assertEquals(1404, jalali.year)
        assertEquals(6, jalali.month)
        assertEquals(31, jalali.day)
    }

    @Test
    fun `persian digits conversion`() {
        assertEquals("۱۴۰۴", JalaliDate.toPersianDigits("1404"))
    }
}
