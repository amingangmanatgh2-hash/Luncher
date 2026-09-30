package com.dlck.lnch.ui.settings

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dlck.lnch.R
import com.dlck.lnch.data.apps.AppInfo
import com.dlck.lnch.data.apps.IconCache
import com.dlck.lnch.data.prefs.AccentColor
import com.dlck.lnch.data.prefs.AppLanguage
import com.dlck.lnch.data.prefs.GestureAction
import com.dlck.lnch.data.prefs.ThemeMode
import com.dlck.lnch.ui.LauncherViewModel
import com.dlck.lnch.ui.LocalBackupBridge
import com.dlck.lnch.ui.components.AppIconImage
import com.dlck.lnch.ui.components.ScreenHeader
import com.dlck.lnch.ui.components.SectionTitle

@Composable
fun SettingsScreen(
    viewModel: LauncherViewModel,
    onBack: () -> Unit,
    onOpenAiSetup: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val usageGranted by viewModel.usageAccessGranted.collectAsStateWithLifecycle()
    val hiddenApps by viewModel.hiddenApps.collectAsStateWithLifecycle()
    var showHiddenManager by remember { mutableStateOf(false) }
    var showIconPacks by remember { mutableStateOf(false) }
    var gesturePicker by remember { mutableStateOf<GestureSlot?>(null) }
    val iconPacks by viewModel.iconPacks.collectAsStateWithLifecycle()
    val backupBridge = LocalBackupBridge.current
    var notificationAccess by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.loadIconPacks()
        notificationAccess = viewModel.notificationAccessGranted()
    }
    val context = LocalContext.current
    val isDefaultHome = remember(context) { isDefaultLauncher(context) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.97f))
            .statusBarsPadding(),
    ) {
        ScreenHeader(title = stringResource(R.string.settings_title), onBack = onBack)

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .navigationBarsPadding(),
            contentPadding = PaddingValues(bottom = 32.dp),
        ) {
            // ------------------------------------------------- home app
            item {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isDefaultHome) {
                            MaterialTheme.colorScheme.secondaryContainer
                        } else {
                            MaterialTheme.colorScheme.errorContainer
                        },
                    ),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text(
                            text = stringResource(
                                if (isDefaultHome) R.string.settings_is_default
                                else R.string.settings_not_default,
                            ),
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text(
                            text = stringResource(R.string.settings_set_default_desc),
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { viewModel.openHomeSettings() }) {
                            Text(stringResource(R.string.settings_set_default))
                        }
                    }
                }
            }

            // ------------------------------------------------- AI
            item { SectionTitle(stringResource(R.string.settings_ai_section)) }
            item {
                NavRow(
                    title = stringResource(R.string.settings_ai_setup),
                    subtitle = stringResource(R.string.settings_ai_setup_desc),
                    onClick = onOpenAiSetup,
                )
            }

            // ------------------------------------------------- appearance
            item { SectionTitle(stringResource(R.string.settings_appearance)) }
            item {
                SettingRow(title = stringResource(R.string.settings_theme)) {
                    SingleChoiceSegmentedButtonRow {
                        ThemeMode.entries.forEachIndexed { index, mode ->
                            SegmentedButton(
                                selected = settings.themeMode == mode,
                                onClick = { viewModel.setThemeMode(mode) },
                                shape = SegmentedButtonDefaults.itemShape(
                                    index = index,
                                    count = ThemeMode.entries.size,
                                ),
                            ) {
                                Text(
                                    when (mode) {
                                        ThemeMode.SYSTEM -> stringResource(R.string.settings_theme_system)
                                        ThemeMode.LIGHT -> stringResource(R.string.settings_theme_light)
                                        ThemeMode.DARK -> stringResource(R.string.settings_theme_dark)
                                    },
                                )
                            }
                        }
                    }
                }
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_dynamic_color),
                    subtitle = stringResource(R.string.settings_dynamic_color_desc),
                    checked = settings.dynamicColor,
                    onCheckedChange = viewModel::setDynamicColor,
                )
            }
            item {
                SettingRow(title = stringResource(R.string.settings_accent)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        AccentColor.entries.forEach { accent ->
                            Box(
                                modifier = Modifier
                                    .size(30.dp)
                                    .clip(CircleShape)
                                    .background(accent.seed)
                                    .border(
                                        width = if (settings.accent == accent) 3.dp else 0.dp,
                                        color = MaterialTheme.colorScheme.onBackground,
                                        shape = CircleShape,
                                    )
                                    .clickable { viewModel.setAccent(accent) },
                            )
                        }
                    }
                }
            }
            item {
                SettingRow(title = stringResource(R.string.settings_language)) {
                    SingleChoiceSegmentedButtonRow {
                        AppLanguage.entries.forEachIndexed { index, language ->
                            SegmentedButton(
                                selected = settings.language == language,
                                onClick = { viewModel.setLanguage(language) },
                                shape = SegmentedButtonDefaults.itemShape(
                                    index = index,
                                    count = AppLanguage.entries.size,
                                ),
                            ) {
                                Text(
                                    when (language) {
                                        AppLanguage.SYSTEM -> stringResource(R.string.settings_language_system)
                                        AppLanguage.ENGLISH -> stringResource(R.string.settings_language_en)
                                        AppLanguage.PERSIAN -> stringResource(R.string.settings_language_fa)
                                    },
                                )
                            }
                        }
                    }
                }
            }

            // ------------------------------------------------- layout
            item { SectionTitle(stringResource(R.string.settings_layout)) }
            item {
                SliderRow(
                    title = stringResource(R.string.settings_grid_columns),
                    value = settings.gridColumns.toFloat(),
                    valueRange = 3f..6f,
                    steps = 2,
                    valueLabel = settings.gridColumns.toString(),
                    onValueChange = { viewModel.setGridColumns(it.toInt()) },
                )
            }
            item {
                SliderRow(
                    title = stringResource(R.string.settings_icon_size),
                    value = settings.iconSizeDp.toFloat(),
                    valueRange = 40f..80f,
                    steps = 7,
                    valueLabel = "${settings.iconSizeDp} dp",
                    onValueChange = { viewModel.setIconSize(it.toInt()) },
                )
            }
            item {
                SliderRow(
                    title = stringResource(R.string.settings_blur),
                    value = settings.backgroundDim,
                    valueRange = 0f..0.9f,
                    steps = 8,
                    valueLabel = "${(settings.backgroundDim * 100).toInt()}%",
                    onValueChange = { viewModel.setBackgroundDim(it) },
                )
            }
            item {
                NavRow(
                    title = stringResource(R.string.settings_icon_pack),
                    subtitle = settings.iconPack.ifBlank {
                        stringResource(R.string.settings_icon_pack_none)
                    },
                    onClick = {
                        viewModel.loadIconPacks()
                        showIconPacks = true
                    },
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_show_labels),
                    checked = settings.showLabels,
                    onCheckedChange = viewModel::setShowLabels,
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_animations),
                    subtitle = stringResource(R.string.settings_animations_desc),
                    checked = settings.animationsEnabled,
                    onCheckedChange = viewModel::setAnimations,
                )
            }

            // ------------------------------------------------- home screen
            item { SectionTitle(stringResource(R.string.settings_home)) }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_show_clock),
                    checked = settings.showClock,
                    onCheckedChange = viewModel::setShowClock,
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_show_date),
                    checked = settings.showDate,
                    onCheckedChange = viewModel::setShowDate,
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_clock_24h),
                    checked = settings.use24HourClock,
                    onCheckedChange = viewModel::setClock24,
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_persian_date),
                    checked = settings.persianDate,
                    onCheckedChange = viewModel::setPersianDate,
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_show_search),
                    checked = settings.showSearchBar,
                    onCheckedChange = viewModel::setShowSearchBar,
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_show_recent),
                    checked = settings.showRecent,
                    onCheckedChange = viewModel::setShowRecent,
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_show_suggestions),
                    subtitle = stringResource(R.string.settings_show_suggestions_desc),
                    checked = settings.showSuggestions,
                    onCheckedChange = viewModel::setShowSuggestions,
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_show_widgets),
                    subtitle = stringResource(R.string.settings_show_widgets_desc),
                    checked = settings.showWidgets,
                    onCheckedChange = viewModel::setShowWidgets,
                )
            }
            item {
                SwitchRow(
                    title = stringResource(R.string.settings_show_badges),
                    subtitle = stringResource(R.string.settings_show_badges_desc),
                    checked = settings.showBadges,
                    onCheckedChange = viewModel::setShowBadges,
                )
            }
            item {
                NavRow(
                    title = stringResource(
                        if (notificationAccess) R.string.settings_badges_granted
                        else R.string.settings_badges_denied,
                    ),
                    subtitle = stringResource(R.string.settings_badges_desc),
                    onClick = { viewModel.openNotificationAccessSettings() },
                )
            }
            item {
                NavRow(
                    title = stringResource(R.string.settings_hidden_apps),
                    subtitle = pluralStringResource(
                        R.plurals.settings_hidden_apps_count,
                        hiddenApps.size,
                        hiddenApps.size,
                    ),
                    onClick = { showHiddenManager = true },
                )
            }
            item {
                SliderRow(
                    title = stringResource(R.string.home_favorites),
                    value = settings.favoritesRows.toFloat(),
                    valueRange = 1f..3f,
                    steps = 1,
                    valueLabel = settings.favoritesRows.toString(),
                    onValueChange = { viewModel.setFavoritesRows(it.toInt()) },
                )
            }
            item {
                NavRow(
                    title = stringResource(R.string.settings_wallpaper),
                    subtitle = null,
                    onClick = { viewModel.openWallpaperPicker() },
                )
            }

            // ------------------------------------------------- gestures
            item { SectionTitle(stringResource(R.string.settings_gestures)) }
            item {
                NavRow(
                    title = stringResource(R.string.settings_gesture_swipe_up),
                    subtitle = gestureLabel(settings.swipeUpAction),
                    onClick = { gesturePicker = GestureSlot.SWIPE_UP },
                )
            }
            item {
                NavRow(
                    title = stringResource(R.string.settings_gesture_swipe_down),
                    subtitle = gestureLabel(settings.swipeDownAction),
                    onClick = { gesturePicker = GestureSlot.SWIPE_DOWN },
                )
            }
            item {
                NavRow(
                    title = stringResource(R.string.settings_gesture_double_tap),
                    subtitle = gestureLabel(settings.doubleTapAction),
                    onClick = { gesturePicker = GestureSlot.DOUBLE_TAP },
                )
            }

            // ------------------------------------------------- backup
            item { SectionTitle(stringResource(R.string.settings_backup)) }
            item {
                NavRow(
                    title = stringResource(R.string.settings_backup_export),
                    subtitle = stringResource(R.string.settings_backup_export_desc),
                    onClick = { backupBridge?.exportBackup() },
                )
            }
            item {
                NavRow(
                    title = stringResource(R.string.settings_backup_restore),
                    subtitle = stringResource(R.string.settings_backup_restore_desc),
                    onClick = { backupBridge?.restoreBackup() },
                )
            }

            // ------------------------------------------------- permissions
            item { SectionTitle(stringResource(R.string.settings_usage_access)) }
            item {
                NavRow(
                    title = stringResource(
                        if (usageGranted) R.string.settings_usage_granted
                        else R.string.settings_usage_denied,
                    ),
                    subtitle = stringResource(R.string.settings_usage_access_desc),
                    onClick = { viewModel.openUsageAccessSettings() },
                )
            }

            // ------------------------------------------------- about
            item { SectionTitle(stringResource(R.string.settings_about)) }
            item {
                Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                    Text(
                        text = "${stringResource(R.string.app_name)} · ${stringResource(R.string.app_tagline)}",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = stringResource(R.string.settings_version, appVersion(context)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(onClick = { viewModel.resetSettings() }) {
                        Text(stringResource(R.string.settings_reset))
                    }
                }
            }
        }
    }

    if (showIconPacks) {
        IconPackDialog(
            packs = iconPacks,
            selected = settings.iconPack,
            onSelect = { pack ->
                viewModel.setIconPack(pack)
                showIconPacks = false
            },
            onDismiss = { showIconPacks = false },
        )
    }

    gesturePicker?.let { slot ->
        GesturePickerDialog(
            title = stringResource(slot.titleRes),
            selected = when (slot) {
                GestureSlot.SWIPE_UP -> settings.swipeUpAction
                GestureSlot.SWIPE_DOWN -> settings.swipeDownAction
                GestureSlot.DOUBLE_TAP -> settings.doubleTapAction
            },
            onSelect = { action ->
                when (slot) {
                    GestureSlot.SWIPE_UP -> viewModel.setSwipeUpAction(action)
                    GestureSlot.SWIPE_DOWN -> viewModel.setSwipeDownAction(action)
                    GestureSlot.DOUBLE_TAP -> viewModel.setDoubleTapAction(action)
                }
                gesturePicker = null
            },
            onDismiss = { gesturePicker = null },
        )
    }

    if (showHiddenManager) {
        HiddenAppsDialog(
            apps = hiddenApps,
            cache = viewModel.iconCache,
            onUnhide = viewModel::toggleHidden,
            onDismiss = { showHiddenManager = false },
        )
    }
}

/** Which home gesture is being reassigned. */
private enum class GestureSlot(val titleRes: Int) {
    SWIPE_UP(R.string.settings_gesture_swipe_up),
    SWIPE_DOWN(R.string.settings_gesture_swipe_down),
    DOUBLE_TAP(R.string.settings_gesture_double_tap),
}

@Composable
private fun gestureLabel(action: GestureAction): String = stringResource(
    when (action) {
        GestureAction.NONE -> R.string.gesture_none
        GestureAction.APP_DRAWER -> R.string.drawer_title
        GestureAction.SEARCH -> R.string.gesture_search
        GestureAction.ASSISTANT -> R.string.ai_title
        GestureAction.SETTINGS -> R.string.settings_title
        GestureAction.WALLPAPER -> R.string.settings_wallpaper
        GestureAction.AI_SETUP -> R.string.settings_ai_setup
    },
)

@Composable
private fun GesturePickerDialog(
    title: String,
    selected: GestureAction,
    onSelect: (GestureAction) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
        text = {
            Column {
                GestureAction.entries.forEach { action ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(action) }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        RadioButton(selected = action == selected, onClick = { onSelect(action) })
                        Text(text = gestureLabel(action))
                    }
                }
            }
        },
    )
}

/** Lists the icon packs installed on the device. */
@Composable
private fun IconPackDialog(
    packs: List<com.dlck.lnch.data.apps.IconPackRepository.Pack>,
    selected: String,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_icon_pack)) },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
        text = {
            LazyColumn(modifier = Modifier.height(300.dp)) {
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect("") }
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        RadioButton(selected = selected.isBlank(), onClick = { onSelect("") })
                        Text(stringResource(R.string.settings_icon_pack_none))
                    }
                }
                if (packs.isEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.settings_icon_pack_empty),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                }
                items(packs, key = { it.packageName }) { pack ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(pack.packageName) }
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        RadioButton(
                            selected = selected == pack.packageName,
                            onClick = { onSelect(pack.packageName) },
                        )
                        Column {
                            Text(text = pack.label)
                            Text(
                                text = pack.packageName,
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

/** Lets the user bring hidden apps back — otherwise hiding would be a one-way door. */
@Composable
private fun HiddenAppsDialog(
    apps: List<AppInfo>,
    cache: IconCache,
    onUnhide: (AppInfo) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
        title = { Text(stringResource(R.string.settings_hidden_apps)) },
        text = {
            if (apps.isEmpty()) {
                Text(
                    text = stringResource(R.string.settings_hidden_apps_empty),
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                LazyColumn(modifier = Modifier.height(320.dp)) {
                    items(apps, key = { it.key }) { app ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onUnhide(app) }
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            AppIconImage(app = app, cache = cache, size = 32.dp)
                            Text(
                                text = app.label,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f),
                            )
                            Icon(
                                imageVector = Icons.Filled.Visibility,
                                contentDescription = stringResource(R.string.menu_unhide),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
        },
    )
}

@Composable
private fun SettingRow(title: String, content: @Composable () -> Unit) {
    Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp)) {
        Text(text = title, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(8.dp))
        content()
    }
}

@Composable
private fun SwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    subtitle: String? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun SliderRow(
    title: String,
    value: Float,
    valueRange: ClosedFloatingPointRange<Float>,
    steps: Int,
    valueLabel: String,
    onValueChange: (Float) -> Unit,
) {
    Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f),
            )
            Text(text = valueLabel, style = MaterialTheme.typography.labelMedium)
        }
        Slider(
            value = value,
            onValueChange = onValueChange,
            valueRange = valueRange,
            steps = steps,
        )
    }
}

@Composable
private fun NavRow(title: String, subtitle: String?, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
    }
}

private fun isDefaultLauncher(context: Context): Boolean = runCatching {
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    val resolved = context.packageManager.resolveActivity(
        intent,
        android.content.pm.PackageManager.MATCH_DEFAULT_ONLY,
    )
    resolved?.activityInfo?.packageName == context.packageName
}.getOrDefault(false)

private fun appVersion(context: Context): String = runCatching {
    context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "1.0.0"
}.getOrDefault("1.0.0")
