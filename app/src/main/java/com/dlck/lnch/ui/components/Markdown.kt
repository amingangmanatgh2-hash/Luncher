package com.dlck.lnch.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

/**
 * Minimal Markdown renderer for assistant replies.
 *
 * Deliberately tiny — no HTML, no links, no images, no external library. Models love to answer with
 * `**bold**`, backticked identifiers and `- ` bullet lists, and showing those raw looks broken, so
 * exactly that subset is supported:
 *
 *  * `**bold**`
 *  * `*italic*` and `_italic_`
 *  * `` `inline code` ``
 *  * `- ` / `* ` bullets  → `•`
 *  * `#`, `##`, `###` headings → bold line
 *
 * Anything else is rendered literally, so a malformed marker can never swallow text.
 */
@Composable
fun MarkdownText(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
) {
    val accent = MaterialTheme.colorScheme.primary
    val codeBackground = MaterialTheme.colorScheme.surface.copy(alpha = 0.55f)
    val annotated = remember(text, accent, codeBackground) {
        buildMarkdown(text, accent, codeBackground)
    }
    Text(text = annotated, style = style, color = color, modifier = modifier)
}

internal fun buildMarkdown(
    raw: String,
    accent: Color,
    codeBackground: Color,
): AnnotatedString = buildAnnotatedString {
    val lines = raw.split('\n')
    lines.forEachIndexed { index, line ->
        val trimmed = line.trimStart()
        var heading = false
        var bullet = false
        val content: String = when {
            trimmed.startsWith("### ") -> { heading = true; trimmed.removePrefix("### ") }
            trimmed.startsWith("## ") -> { heading = true; trimmed.removePrefix("## ") }
            trimmed.startsWith("# ") -> { heading = true; trimmed.removePrefix("# ") }
            trimmed.startsWith("- ") -> { bullet = true; trimmed.removePrefix("- ") }
            trimmed.startsWith("* ") -> { bullet = true; trimmed.removePrefix("* ") }
            else -> line
        }

        if (bullet) {
            withStyle(SpanStyle(color = accent, fontWeight = FontWeight.Bold)) { append("•  ") }
        }
        if (heading) {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                appendInline(content, codeBackground)
            }
        } else {
            appendInline(content, codeBackground)
        }

        if (index != lines.lastIndex) append('\n')
    }
}

private fun AnnotatedString.Builder.appendInline(text: String, codeBackground: Color) {
    var i = 0
    while (i < text.length) {
        val char = text[i]
        when {
            text.startsWith("**", i) -> {
                val end = text.indexOf("**", i + 2)
                if (end >= 0) {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                        append(text.substring(i + 2, end))
                    }
                    i = end + 2
                } else {
                    append(char)
                    i++
                }
            }

            char == '`' -> {
                val end = text.indexOf('`', i + 1)
                if (end > i + 1) {
                    withStyle(
                        SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground),
                    ) {
                        append(text.substring(i + 1, end))
                    }
                    i = end + 1
                } else {
                    append(char)
                    i++
                }
            }

            char == '*' || char == '_' -> {
                val end = text.indexOf(char, i + 1)
                if (end > i + 1) {
                    withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                        append(text.substring(i + 1, end))
                    }
                    i = end + 1
                } else {
                    append(char)
                    i++
                }
            }

            else -> {
                append(char)
                i++
            }
        }
    }
}
