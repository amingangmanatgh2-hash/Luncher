package com.dlck.lnch.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dlck.lnch.data.apps.AppInfo
import com.dlck.lnch.data.apps.IconCache

/** Loads (and caches) a launcher icon off the main thread. */
@Composable
fun AppIconImage(
    app: AppInfo,
    cache: IconCache,
    size: Dp,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val sizePx = remember(size, density) { with(density) { size.roundToPx() } }
    var bitmap by remember(app.key) { mutableStateOf<ImageBitmap?>(cache.peek(app.key)) }

    LaunchedEffect(app.key, sizePx) {
        if (bitmap == null) bitmap = cache.load(app, sizePx)
    }

    val current = bitmap
    if (current != null) {
        Image(
            bitmap = current,
            contentDescription = app.label,
            contentScale = ContentScale.Fit,
            modifier = modifier.size(size),
        )
    } else {
        Box(
            modifier = modifier
                .size(size)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = app.label.take(1).uppercase(),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Grid cell: icon + optional label, with tap and long-press. */
@Composable
fun AppTile(
    app: AppInfo,
    cache: IconCache,
    iconSize: Dp,
    showLabel: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
    labelColor: androidx.compose.ui.graphics.Color = LocalContentColor.current,
) {
    val haptics = LocalHapticFeedback.current

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(18.dp))
            .combinedClickable(
                onClick = onClick,
                onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onLongClick()
                },
            )
            .padding(vertical = 8.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        AppIconImage(app = app, cache = cache, size = iconSize)
        if (showLabel) {
            Text(
                text = app.label,
                style = MaterialTheme.typography.labelMedium,
                fontSize = 11.sp,
                color = labelColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
            )
        }
    }
}
