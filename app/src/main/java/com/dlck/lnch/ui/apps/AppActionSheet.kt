package com.dlck.lnch.ui.apps

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.dlck.lnch.R
import com.dlck.lnch.data.apps.AppInfo
import com.dlck.lnch.data.apps.IconCache
import com.dlck.lnch.ui.components.AppIconImage
import com.dlck.lnch.utils.AppShortcuts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Long-press menu for an app. Uninstall always goes through the Android uninstall dialog. */
@Composable
fun AppActionSheet(
    app: AppInfo,
    cache: IconCache,
    isFavorite: Boolean,
    isPinned: Boolean,
    isHidden: Boolean,
    onDismiss: () -> Unit,
    onOpen: () -> Unit,
    onToggleFavorite: () -> Unit,
    onTogglePin: () -> Unit,
    onToggleHidden: () -> Unit,
    onAppInfo: () -> Unit,
    onUninstall: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current

    // App shortcuts are only readable once DLCK LNCH is the default home app; the list just stays
    // empty otherwise, so the sheet works either way.
    var shortcuts by remember(app.packageName) {
        mutableStateOf<List<AppShortcuts.Entry>>(emptyList())
    }
    LaunchedEffect(app.packageName) {
        shortcuts = withContext(Dispatchers.IO) {
            AppShortcuts.load(context, app.packageName)
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(bottom = 12.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                AppIconImage(app = app, cache = cache, size = 48.dp)
                Column {
                    Text(text = app.label, style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = app.packageName,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            SheetItem(Icons.Filled.OpenInNew, stringResource(R.string.menu_open), onOpen)

            if (shortcuts.isNotEmpty()) {
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                )
                Text(
                    text = stringResource(R.string.menu_shortcuts),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                )
                shortcuts.forEach { entry ->
                    SheetItem(
                        icon = Icons.Filled.Bolt,
                        text = entry.label,
                        onClick = {
                            AppShortcuts.start(context, entry)
                            onDismiss()
                        },
                    )
                }
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                )
            }

            SheetItem(
                icon = if (isFavorite) Icons.Filled.Star else Icons.Filled.StarBorder,
                text = stringResource(
                    if (isFavorite) R.string.menu_remove_favorite else R.string.menu_add_favorite,
                ),
                onClick = onToggleFavorite,
            )

            SheetItem(
                icon = Icons.Filled.PushPin,
                text = stringResource(if (isPinned) R.string.menu_unpin else R.string.menu_pin),
                onClick = onTogglePin,
            )

            SheetItem(
                icon = if (isHidden) Icons.Filled.Visibility else Icons.Filled.VisibilityOff,
                text = stringResource(if (isHidden) R.string.menu_unhide else R.string.menu_hide),
                onClick = onToggleHidden,
            )

            SheetItem(Icons.Filled.Info, stringResource(R.string.menu_app_info), onAppInfo)

            if (!app.isSystemApp) {
                SheetItem(
                    icon = Icons.Filled.Delete,
                    text = stringResource(R.string.menu_uninstall),
                    onClick = onUninstall,
                    tint = MaterialTheme.colorScheme.error,
                )
            } else {
                Text(
                    text = stringResource(R.string.menu_cannot_uninstall),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun SheetItem(
    icon: ImageVector,
    text: String,
    onClick: () -> Unit,
    tint: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = tint)
        Text(text = text, style = MaterialTheme.typography.bodyLarge, color = tint)
    }
}
