package com.dlck.lnch.utils

import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToLong

/**
 * A tiny, dependency-free arithmetic evaluator used by the search bar.
 *
 * Typing `12*7` in search shows `84` instantly, entirely on-device — no network, no AI call, no
 * `eval`. It is a hand-written recursive-descent parser, so it cannot execute anything but numbers
 * and the five operators below.
 *
 * Supports: `+  -  *  ×  /  ÷  %  ^  ( )`, decimals, unary minus, Persian/Arabic digits and the
 * Persian decimal separator. Returns `null` for anything that is not a complete expression, so a
 * normal app search such as "maps" is never mistaken for maths.
 */
object Calculator {

    private const val PERSIAN_ZERO = '\u06F0'
    private const val ARABIC_ZERO = '\u0660'

    fun evaluate(raw: String): Double? {
        val normalized = normalize(raw)
        if (normalized.isEmpty()) return null
        // Require at least one operator, otherwise "42" would render as a "result".
        if (normalized.none { it in "+-*/%^" } ) return null
        if (normalized.any { it !in "0123456789.+-*/%^() " }) return null
        if (normalized.none { it.isDigit() }) return null

        return runCatching {
            val parser = Parser(normalized)
            val value = parser.parseExpression()
            parser.skipSpaces()
            if (!parser.atEnd()) return null
            if (value.isNaN() || value.isInfinite()) return null
            value
        }.getOrNull()
    }

    /** Human-friendly output: integers without a decimal point, everything else trimmed. */
    fun format(value: Double): String {
        if (abs(value) < 1e-10) return "0"
        val rounded = (value * 1e6).roundToLong() / 1e6
        return if (abs(rounded - rounded.roundToLong()) < 1e-9 && abs(rounded) < 1e15) {
            rounded.roundToLong().toString()
        } else {
            rounded.toString().trimEnd('0').trimEnd('.')
        }
    }

    internal fun normalize(raw: String): String = buildString {
        for (char in raw.trim()) {
            val mapped = when {
                char in '\u06F0'..'\u06F9' -> ('0' + (char - PERSIAN_ZERO))
                char in '\u0660'..'\u0669' -> ('0' + (char - ARABIC_ZERO))
                char == '×' || char == 'x' || char == 'X' -> '*'
                char == '÷' -> '/'
                char == '٫' -> '.' // Persian decimal separator; thousands marks stay invalid
                char == '−' || char == '–' -> '-'
                else -> char
            }
            append(mapped)
        }
    }

    private class Parser(private val text: String) {
        private var index = 0

        fun atEnd(): Boolean = index >= text.length

        fun skipSpaces() {
            while (index < text.length && text[index] == ' ') index++
        }

        private fun peek(): Char? {
            skipSpaces()
            return text.getOrNull(index)
        }

        /** expression := term (('+' | '-') term)* */
        fun parseExpression(): Double {
            var value = parseTerm()
            while (true) {
                when (peek()) {
                    '+' -> { index++; value += parseTerm() }
                    '-' -> { index++; value -= parseTerm() }
                    else -> return value
                }
            }
        }

        /** term := power (('*' | '/' | '%') power)* */
        private fun parseTerm(): Double {
            var value = parsePower()
            while (true) {
                when (peek()) {
                    '*' -> { index++; value *= parsePower() }
                    '/' -> {
                        index++
                        val divisor = parsePower()
                        if (divisor == 0.0) throw ArithmeticException("division by zero")
                        value /= divisor
                    }
                    '%' -> {
                        index++
                        val divisor = parsePower()
                        if (divisor == 0.0) throw ArithmeticException("modulo by zero")
                        value %= divisor
                    }
                    else -> return value
                }
            }
        }

        /** power := unary ('^' power)?  — right associative */
        private fun parsePower(): Double {
            val base = parseUnary()
            return if (peek() == '^') {
                index++
                base.pow(parsePower())
            } else {
                base
            }
        }

        private fun parseUnary(): Double = when (peek()) {
            '-' -> { index++; -parseUnary() }
            '+' -> { index++; parseUnary() }
            else -> parseAtom()
        }

        private fun parseAtom(): Double {
            skipSpaces()
            val char = text.getOrNull(index) ?: throw IllegalStateException("unexpected end")
            if (char == '(') {
                index++
                val value = parseExpression()
                skipSpaces()
                if (text.getOrNull(index) != ')') throw IllegalStateException("missing )")
                index++
                return value
            }
            val start = index
            while (index < text.length && (text[index].isDigit() || text[index] == '.')) index++
            if (start == index) throw IllegalStateException("expected number")
            return text.substring(start, index).toDouble()
        }
    }
}
