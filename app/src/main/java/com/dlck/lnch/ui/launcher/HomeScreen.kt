package com.dlck.lnch.ui.launcher

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dlck.lnch.R
import com.dlck.lnch.data.apps.AppInfo
import com.dlck.lnch.ui.LauncherViewModel
import com.dlck.lnch.ui.components.AppTile
import com.dlck.lnch.ui.components.AuroraBackground
import com.dlck.lnch.ui.components.GlassSurface
import com.dlck.lnch.ui.components.accentGradient

/**
 * The home screen.
 *
 * Gestures (as specified):
 *  * swipe up   → app drawer
 *  * swipe down → search
 *  * long press → home menu (wallpaper / settings / AI setup)
 *  * long press on an app → app menu
 */
@Composable
fun HomeScreen(
    viewModel: LauncherViewModel,
    onOpenDrawer: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenChat: () -> Unit,
    onAppLongPress: (AppInfo) -> Unit,
    onHomeLongPress: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val favorites by viewModel.favorites.collectAsStateWithLifecycle()
    val recents by viewModel.recentApps.collectAsStateWithLifecycle()
    val suggestions by viewModel.suggestedApps.collectAsStateWithLifecycle()

    val contentColor = Color.White
    val dragTotal = remember { mutableFloatStateOf(0f) }
    val haptics = LocalHapticFeedback.current

    Box(
        modifier = modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragStart = { dragTotal.floatValue = 0f },
                    onDragEnd = {
                        when {
                            dragTotal.floatValue < -SWIPE_THRESHOLD_PX -> onOpenDrawer()
                            dragTotal.floatValue > SWIPE_THRESHOLD_PX -> onOpenSearch()
                        }
                    },
                ) { _, dragAmount -> dragTotal.floatValue += dragAmount }
            }
            .pointerInput(Unit) {
                detectTapGestures(
                    onLongPress = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onHomeLongPress()
                    },
                    // Double-tapping empty space is the fastest way into the assistant.
                    onDoubleTap = {
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        onOpenChat()
                    },
                )
            },
    ) {
        AuroraBackground(
            animated = settings.animationsEnabled,
            dim = settings.backgroundDim,
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(48.dp))

            if (settings.showClock || settings.showDate) {
                ClockWidget(
                    showClock = settings.showClock,
                    showDate = settings.showDate,
                    use24Hour = settings.use24HourClock,
                    persianDate = settings.persianDate,
                    contentColor = contentColor,
                    onClockClick = onOpenSearch,
                    onDateClick = onOpenDrawer,
                )
            }

            Spacer(Modifier.weight(1f))

            AnimatedVisibility(
                visible = settings.showSuggestions && suggestions.isNotEmpty(),
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.padding(start = 6.dp, bottom = 6.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.AutoAwesome,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(13.dp),
                        )
                        Text(
                            text = stringResource(R.string.home_suggestions),
                            style = MaterialTheme.typography.labelMedium,
                            color = contentColor.copy(alpha = 0.78f),
                        )
                    }
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        contentPadding = PaddingValues(horizontal = 2.dp),
                    ) {
                        items(suggestions, key = { "sg-" + it.key }) { app ->
                            AppTile(
                                app = app,
                                cache = viewModel.iconCache,
                                iconSize = (settings.iconSizeDp - 8).dp,
                                showLabel = false,
                                onClick = { viewModel.launch(app) },
                                onLongClick = { onAppLongPress(app) },
                                labelColor = contentColor,
                            )
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                }
            }

            AnimatedVisibility(
                visible = settings.showRecent && recents.isNotEmpty(),
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = stringResource(R.string.home_recent),
                        style = MaterialTheme.typography.labelMedium,
                        color = contentColor.copy(alpha = 0.75f),
                        modifier = Modifier.padding(start = 6.dp, bottom = 6.dp),
                    )
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        contentPadding = PaddingValues(horizontal = 2.dp),
                    ) {
                        items(recents, key = { it.key }) { app ->
                            AppTile(
                                app = app,
                                cache = viewModel.iconCache,
                                iconSize = (settings.iconSizeDp - 8).dp,
                                showLabel = false,
                                onClick = { viewModel.launch(app) },
                                onLongClick = { onAppLongPress(app) },
                                labelColor = contentColor,
                            )
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                }
            }

            if (favorites.isNotEmpty()) {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(settings.drawerColumns),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(((settings.iconSizeDp + 34) * settings.favoritesRows).dp),
                    userScrollEnabled = false,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(favorites, key = { it.key }) { app ->
                        AppTile(
                            app = app,
                            cache = viewModel.iconCache,
                            iconSize = settings.iconSizeDp.dp,
                            showLabel = settings.showLabels,
                            onClick = { viewModel.launch(app) },
                            onLongClick = { onAppLongPress(app) },
                            labelColor = contentColor,
                        )
                    }
                }
            } else {
                Text(
                    text = stringResource(R.string.home_no_favorites),
                    style = MaterialTheme.typography.bodySmall,
                    color = contentColor.copy(alpha = 0.7f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
                )
            }

            Spacer(Modifier.height(12.dp))

            if (settings.showSearchBar) {
                HomeSearchBar(
                    onSearchClick = onOpenSearch,
                    onDrawerClick = onOpenDrawer,
                    onAiClick = onOpenChat,
                )
            }

            Text(
                text = stringResource(R.string.home_hint_swipe),
                style = MaterialTheme.typography.labelSmall,
                color = contentColor.copy(alpha = 0.55f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp, bottom = 14.dp),
            )
        }
    }
}

@Composable
private fun HomeSearchBar(
    onSearchClick: () -> Unit,
    onDrawerClick: () -> Unit,
    onAiClick: () -> Unit,
) {
    GlassSurface(
        shape = RoundedCornerShape(28.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(28.dp))
            .clickable(onClick = onSearchClick),
    ) {
        Row(
            modifier = Modifier.padding(start = 18.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = stringResource(R.string.home_search_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .clickable(onClick = onDrawerClick),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Apps,
                    contentDescription = stringResource(R.string.drawer_title),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp),
                )
            }
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(accentGradient())
                    .clickable(onClick = onAiClick),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.AutoAwesome,
                    contentDescription = stringResource(R.string.ai_title),
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }
}

private const val SWIPE_THRESHOLD_PX = 90f
