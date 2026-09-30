package com.dlck.lnch

import com.dlck.lnch.utils.Calculator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The in-search calculator must be right about maths and, just as importantly, silent about
 * anything that is really an app search.
 */
class CalculatorTest {

    private fun calc(raw: String): String? = Calculator.evaluate(raw)?.let(Calculator::format)

    @Test
    fun `basic arithmetic is evaluated`() {
        assertEquals("84", calc("12*7"))
        assertEquals("7", calc("1+2*3"))
        assertEquals("9", calc("(1+2)*3"))
        assertEquals("2.5", calc("5/2"))
        assertEquals("1", calc("10%3"))
    }

    @Test
    fun `precedence and associativity follow the usual rules`() {
        assertEquals("512", calc("2^3^2"))
        assertEquals("-1", calc("1-4/2"))
        assertEquals("0", calc("5-2-3"))
    }

    @Test
    fun `unary minus and decimals work`() {
        assertEquals("-8", calc("-3-5"))
        assertEquals("3.6", calc("1.2*3"))
        assertEquals("4", calc("-(2)+6"))
    }

    @Test
    fun `persian digits and separators are understood`() {
        assertEquals("30", calc("۱۰*۳"))
        assertEquals("3", calc("۱٫۵+۱٫۵"))
        assertEquals("6", calc("۲×۳"))
        assertEquals("4", calc("۸÷۲"))
    }

    @Test
    fun `plain app searches are not treated as maths`() {
        assertNull(calc("maps"))
        assertNull(calc("telegram"))
        assertNull(calc("42"))
        assertNull(calc(""))
        assertNull(calc("   "))
        assertNull(calc("تلگرام"))
    }

    @Test
    fun `broken expressions return null instead of a wrong answer`() {
        assertNull(calc("2+"))
        assertNull(calc("(2+3"))
        assertNull(calc("2++"))
        assertNull(calc("*5"))
        assertNull(calc("1/0"))
    }

    @Test
    fun `formatting trims noise`() {
        assertEquals("3", Calculator.format(3.0000000001))
        assertEquals("0", Calculator.format(0.0))
        assertEquals("-2.5", Calculator.format(-2.5))
    }
}
