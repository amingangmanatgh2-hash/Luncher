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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dlck.lnch.R
import com.dlck.lnch.data.prefs.AccentColor
import com.dlck.lnch.data.prefs.AppLanguage
import com.dlck.lnch.data.prefs.ThemeMode
import com.dlck.lnch.ui.LauncherViewModel
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
