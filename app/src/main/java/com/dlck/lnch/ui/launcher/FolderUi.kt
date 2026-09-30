package com.dlck.lnch.ui.launcher

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dlck.lnch.R
import com.dlck.lnch.data.apps.AppInfo
import com.dlck.lnch.data.apps.IconCache
import com.dlck.lnch.data.prefs.FolderData
import com.dlck.lnch.ui.FolderContent
import com.dlck.lnch.ui.components.AppIconImage
import com.dlck.lnch.ui.components.AppTile
import com.dlck.lnch.utils.FolderOps

/**
 * Home-screen folder tile: a 2×2 preview of the first four apps inside, plus the folder name.
 * Tapping opens the folder, long-pressing opens rename/delete.
 */
@Composable
fun FolderTile(
    content: FolderContent,
    cache: IconCache,
    iconSize: androidx.compose.ui.unit.Dp,
    showLabel: Boolean,
    labelColor: Color,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val preview = content.apps.take(4)
    val miniSize = iconSize / 2.4f

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
        Box(
            modifier = Modifier
                .size(iconSize)
                .clip(RoundedCornerShape(iconSize / 4))
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.45f))
                .padding(4.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                preview.chunked(2).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        row.forEach { app ->
                            AppIconImage(app = app, cache = cache, size = miniSize)
                        }
                    }
                }
            }
        }
        if (showLabel) {
            Text(
                text = content.folder.name,
                style = MaterialTheme.typography.labelMedium,
                fontSize = 11.sp,
                color = labelColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** The opened folder: a grid of its apps. */
@Composable
fun FolderDialog(
    content: FolderContent,
    cache: IconCache,
    columns: Int,
    iconSize: androidx.compose.ui.unit.Dp,
    onOpenApp: (AppInfo) -> Unit,
    onAppLongPress: (AppInfo) -> Unit,
    onRename: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(content.folder.name) },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
        dismissButton = {
            TextButton(onClick = onRename) { Text(stringResource(R.string.folder_rename)) }
        },
        text = {
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns.coerceIn(3, 6)),
                modifier = Modifier.height(260.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(content.apps, key = { it.key }) { app ->
                    AppTile(
                        app = app,
                        cache = cache,
                        iconSize = iconSize,
                        showLabel = true,
                        onClick = { onOpenApp(app) },
                        onLongClick = { onAppLongPress(app) },
                        labelColor = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        },
    )
}

/** Create or rename a folder. */
@Composable
fun FolderNameDialog(
    initialName: String,
    onConfirm: (String) -> Unit,
    onDelete: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(initialName) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                stringResource(
                    if (initialName.isEmpty()) R.string.folder_new else R.string.folder_rename,
                ),
            )
        },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { if (it.length <= FolderOps.MAX_NAME_LENGTH) name = it },
                singleLine = true,
                label = { Text(stringResource(R.string.folder_name)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(name) },
                enabled = name.isNotBlank(),
            ) { Text(stringResource(R.string.action_save)) }
        },
        dismissButton = {
            if (onDelete != null) {
                TextButton(onClick = onDelete) {
                    Icon(Icons.Filled.Delete, contentDescription = null)
                    Text(stringResource(R.string.folder_delete))
                }
            } else {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
            }
        },
    )
}

/** "Move to folder" picker shown from the app long-press sheet. */
@Composable
fun FolderPickerDialog(
    folders: List<FolderData>,
    currentFolderId: String?,
    onPick: (FolderData) -> Unit,
    onCreate: () -> Unit,
    onClear: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.folder_move)) },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
        text = {
            LazyColumn(modifier = Modifier.height(280.dp)) {
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .combinedClickable(onClick = onCreate)
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.CreateNewFolder,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Text(stringResource(R.string.folder_new))
                    }
                }
                items(folders, key = { it.id }) { folder ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .combinedClickable(onClick = { onPick(folder) })
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(text = folder.name, modifier = Modifier.weight(1f))
                        Text(
                            text = folder.items.size.toString(),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (currentFolderId != null) {
                    item {
                        TextButton(onClick = onClear) {
                            Text(stringResource(R.string.folder_remove_from))
                        }
                    }
                }
            }
        },
    )
}
