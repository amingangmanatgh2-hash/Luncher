package com.dlck.lnch.utils

import java.util.Calendar
import java.util.GregorianCalendar

/**
 * Minimal, dependency-free Gregorian ⇄ Jalali (Solar Hijri) converter so Persian users see a real
 * Persian date on the home screen. Algorithm: the standard 33-year cycle arithmetic conversion.
 */
object JalaliDate {

    private val monthNamesFa = arrayOf(
        "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
        "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
    )

    private val weekDaysFa = arrayOf(
        "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه",
    )

    data class Jalali(val year: Int, val month: Int, val day: Int)

    fun fromGregorian(gYear: Int, gMonth: Int, gDay: Int): Jalali {
        val gDaysInMonth = intArrayOf(31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
        val jDaysInMonth = intArrayOf(31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29)

        val gy = gYear - 1600
        val gm = gMonth - 1
        val gd = gDay - 1

        var gDayNo = 365 * gy + (gy + 3) / 4 - (gy + 99) / 100 + (gy + 399) / 400
        for (i in 0 until gm) gDayNo += gDaysInMonth[i]
        if (gm > 1 && ((gy + 1600) % 4 == 0 && (gy + 1600) % 100 != 0 || (gy + 1600) % 400 == 0)) {
            gDayNo++
        }
        gDayNo += gd

        var jDayNo = gDayNo - 79
        val jNp = jDayNo / 12053
        jDayNo %= 12053

        var jy = 979 + 33 * jNp + 4 * (jDayNo / 1461)
        jDayNo %= 1461

        if (jDayNo >= 366) {
            jy += (jDayNo - 1) / 365
            jDayNo = (jDayNo - 1) % 365
        }

        var i = 0
        while (i < 11 && jDayNo >= jDaysInMonth[i]) {
            jDayNo -= jDaysInMonth[i]
            i++
        }
        val jm = i + 1
        val jd = jDayNo + 1

        return Jalali(jy, jm, jd)
    }

    fun todayJalali(calendar: Calendar = GregorianCalendar()): Jalali = fromGregorian(
        calendar.get(Calendar.YEAR),
        calendar.get(Calendar.MONTH) + 1,
        calendar.get(Calendar.DAY_OF_MONTH),
    )

    /** e.g. «پنجشنبه ۷ مهر ۱۴۰۴» */
    fun formatPersian(calendar: Calendar = GregorianCalendar()): String {
        val j = todayJalali(calendar)
        val weekDayIndex = (calendar.get(Calendar.DAY_OF_WEEK) - 1).coerceIn(0, 6)
        val weekDay = weekDaysFa[weekDayIndex]
        val month = monthNamesFa[(j.month - 1).coerceIn(0, 11)]
        return "$weekDay ${toPersianDigits(j.day.toString())} $month ${toPersianDigits(j.year.toString())}"
    }

    fun toPersianDigits(input: String): String {
        val digits = charArrayOf('۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹')
        return buildString {
            input.forEach { ch ->
                if (ch in '0'..'9') append(digits[ch - '0']) else append(ch)
            }
        }
    }
}
