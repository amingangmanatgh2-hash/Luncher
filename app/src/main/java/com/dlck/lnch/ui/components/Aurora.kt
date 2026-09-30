package com.dlck.lnch.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private const val TWO_PI = (2 * PI).toFloat()

private data class Blob(
    val color: Color,
    val x: Float,
    val y: Float,
    val radius: Float,
    val alpha: Float,
)

/**
 * A soft, slowly drifting "aurora" glow.
 *
 * The launcher window is translucent so the user's wallpaper stays visible — this only paints the
 * dim layer plus a few very soft colour blobs on top of it, which is why it never hides the
 * wallpaper. When the user turns animations off the blobs freeze at a fixed, pleasant phase instead
 * of running an infinite animation, so nothing is scheduled on the frame clock.
 */
@Composable
fun AuroraBackground(
    animated: Boolean,
    dim: Float,
    modifier: Modifier = Modifier,
    intensity: Float = 1f,
) {
    val scheme = MaterialTheme.colorScheme

    val phase: Float = if (animated) {
        val transition = rememberInfiniteTransition(label = "aurora")
        val value by transition.animateFloat(
            initialValue = 0f,
            targetValue = TWO_PI,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 26_000, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
            label = "aurora-phase",
        )
        value
    } else {
        0.8f
    }

    val primary = scheme.primary
    val tertiary = scheme.tertiary
    val secondary = scheme.secondary
    val clampedDim = dim.coerceIn(0f, 0.9f)
    val strength = intensity.coerceIn(0f, 1f)

    Canvas(modifier = modifier.fillMaxSize()) {
        if (clampedDim > 0f) {
            drawRect(color = Color.Black.copy(alpha = clampedDim))
        }

        val width = size.width
        val height = size.height
        val unit = maxOf(width, height)

        val blobs = listOf(
            Blob(primary, 0.18f + 0.10f * cos(phase), 0.15f + 0.06f * sin(phase * 0.9f), 0.60f, 0.30f),
            Blob(tertiary, 0.86f + 0.07f * sin(phase * 1.3f), 0.32f + 0.08f * cos(phase * 0.7f), 0.52f, 0.24f),
            Blob(secondary, 0.48f + 0.14f * cos(phase * 0.6f), 0.92f + 0.05f * sin(phase * 1.1f), 0.72f, 0.20f),
        )

        blobs.forEach { blob ->
            val center = Offset(blob.x * width, blob.y * height)
            val radius = blob.radius * unit
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(blob.color.copy(alpha = blob.alpha * strength), Color.Transparent),
                    center = center,
                    radius = radius,
                ),
                radius = radius,
                center = center,
            )
        }
    }
}

/**
 * Frosted-glass panel: translucent fill plus a one-pixel gradient rim, so panels read as layers of
 * glass over the wallpaper instead of flat rectangles.
 */
@Composable
fun GlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(24.dp),
    alpha: Float = 0.55f,
    content: @Composable () -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    Surface(
        modifier = modifier,
        shape = shape,
        color = scheme.surface.copy(alpha = alpha),
        border = BorderStroke(
            width = 1.dp,
            brush = Brush.linearGradient(
                colors = listOf(
                    scheme.primary.copy(alpha = 0.40f),
                    scheme.onSurface.copy(alpha = 0.06f),
                    scheme.tertiary.copy(alpha = 0.28f),
                ),
            ),
        ),
        content = content,
    )
}

/** Horizontal accent gradient used for hero text and the assistant button. */
@Composable
fun accentGradient(): Brush {
    val scheme = MaterialTheme.colorScheme
    return Brush.linearGradient(listOf(scheme.primary, scheme.tertiary))
}
