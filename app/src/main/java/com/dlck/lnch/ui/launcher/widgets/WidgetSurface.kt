package com.dlck.lnch.ui.launcher.widgets

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dlck.lnch.R
import com.dlck.lnch.data.widgets.WidgetSpec

/**
 * Draws the stored widgets on the home screen.
 *
 * Each widget is a real `AppWidgetHostView` embedded with [AndroidView]; long-pressing one opens
 * the resize / remove sheet. When the host is not listening yet (activity stopped) nothing is
 * inflated, which avoids the classic "widget shows stale RemoteViews" glitch.
 */
@Composable
fun WidgetColumn(
    controller: WidgetHostController,
    widgets: List<WidgetSpec>,
    modifier: Modifier = Modifier,
) {
    if (widgets.isEmpty()) return

    val configuration = LocalConfiguration.current
    val widthDp = (configuration.screenWidthDp - 32).coerceAtLeast(120)
    var editing by remember { mutableStateOf<WidgetSpec?>(null) }

    LaunchedEffect(widgets) { controller.pruneMissing(widgets) }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        widgets.forEach { spec ->
            key(spec.appWidgetId) {
                WidgetFrame(
                    controller = controller,
                    spec = spec,
                    widthDp = widthDp,
                    onLongPress = { editing = spec },
                )
            }
        }
    }

    editing?.let { spec ->
        WidgetEditDialog(
            spec = spec,
            onDismiss = { editing = null },
            onResize = { height -> controller.resizeWidget(spec.appWidgetId, height) },
            onRemove = {
                controller.removeWidget(spec.appWidgetId)
                editing = null
            },
        )
    }
}

@Composable
private fun WidgetFrame(
    controller: WidgetHostController,
    spec: WidgetSpec,
    widthDp: Int,
    onLongPress: () -> Unit,
) {
    val listening by controller.listening.collectAsStateWithLifecycle()

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(spec.heightDp.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.25f))
            .pointerInput(spec.appWidgetId) {
                detectTapGestures(onLongPress = { onLongPress() })
            },
    ) {
        if (listening) {
            AndroidView(
                modifier = Modifier.fillMaxWidth(),
                factory = { viewContext ->
                    controller.createView(viewContext, spec, widthDp)
                        ?: android.widget.FrameLayout(viewContext)
                },
                update = { view ->
                    if (view is android.appwidget.AppWidgetHostView) {
                        controller.applySize(view, spec.appWidgetId, widthDp, spec.heightDp)
                    }
                },
            )
        }
        else {
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(
                    text = spec.label.ifBlank { stringResource(R.string.widgets_title) },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun WidgetEditDialog(
    spec: WidgetSpec,
    onDismiss: () -> Unit,
    onResize: (Int) -> Unit,
    onRemove: () -> Unit,
) {
    var height by remember(spec.appWidgetId) { mutableStateOf(spec.heightDp) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(spec.label.ifBlank { stringResource(R.string.widgets_title) }) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = stringResource(R.string.widgets_resize_hint),
                    style = MaterialTheme.typography.bodySmall,
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    IconButton(
                        onClick = {
                            height = (height - 30).coerceAtLeast(WidgetSpec.MIN_HEIGHT_DP)
                            onResize(height)
                        },
                    ) { Icon(Icons.Filled.Remove, contentDescription = "-") }
                    Text(
                        text = "$height dp",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            height = (height + 30).coerceAtMost(WidgetSpec.MAX_HEIGHT_DP)
                            onResize(height)
                        },
                    ) { Icon(Icons.Filled.Add, contentDescription = "+") }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
        dismissButton = {
            TextButton(onClick = onRemove) {
                Icon(Icons.Filled.Delete, contentDescription = null)
                Text(stringResource(R.string.widgets_remove))
            }
        },
    )
}

/** The "add widget" picker, listing every provider installed on the device. */
@Composable
fun WidgetPickerDialog(
    controller: WidgetHostController,
    onDismiss: () -> Unit,
) {
    var entries by remember { mutableStateOf<List<WidgetCatalogEntry>?>(null) }

    LaunchedEffect(Unit) { entries = controller.availableWidgets() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.widgets_add)) },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
        text = {
            val list = entries
            when {
                list == null -> Box(
                    modifier = Modifier.fillMaxWidth().height(120.dp),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }

                list.isEmpty() -> Text(stringResource(R.string.widgets_none))

                else -> LazyColumn(
                    modifier = Modifier.height(380.dp),
                    contentPadding = PaddingValues(vertical = 4.dp),
                ) {
                    items(list, key = { it.info.provider.flattenToString() }) { entry ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .pointerInput(entry.info.provider) {
                                    detectTapGestures(
                                        onTap = {
                                            controller.addWidget(entry)
                                            onDismiss()
                                        },
                                    )
                                }
                                .padding(horizontal = 4.dp, vertical = 10.dp),
                        ) {
                            Text(text = entry.label, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                text = entry.appLabel,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
    )
}
