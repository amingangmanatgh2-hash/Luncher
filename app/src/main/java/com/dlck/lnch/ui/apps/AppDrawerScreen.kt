package com.dlck.lnch.ui.apps

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SortByAlpha
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dlck.lnch.R
import com.dlck.lnch.data.apps.AppCategory
import com.dlck.lnch.data.apps.AppInfo
import com.dlck.lnch.data.prefs.DrawerSort
import com.dlck.lnch.ui.LauncherViewModel
import com.dlck.lnch.ui.components.AppTile
import com.dlck.lnch.ui.components.AuroraBackground
import com.dlck.lnch.ui.components.EmptyState
import com.dlck.lnch.utils.AlphabetIndex
import kotlinx.coroutines.launch

@Composable
fun AppDrawerScreen(
    viewModel: LauncherViewModel,
    initialQuery: String?,
    initialCategory: AppCategory?,
    onAppLongPress: (AppInfo) -> Unit,
    modifier: Modifier = Modifier,
) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val allApps by viewModel.visibleApps.collectAsStateWithLifecycle()
    val categories by viewModel.availableCategories.collectAsStateWithLifecycle()
    val pinned by viewModel.pinnedKeys.collectAsStateWithLifecycle()

    var query by rememberSaveable { mutableStateOf(initialQuery.orEmpty()) }
    val gridState = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    var category by remember { mutableStateOf(initialCategory) }
    val keyboard = LocalSoftwareKeyboardController.current

    val apps = remember(allApps, query, category, pinned, settings.drawerSort) {
        viewModel.drawerApps(query, category, settings.drawerSort)
    }

    Box(modifier = modifier.fillMaxSize()) {
    AuroraBackground(
        animated = settings.animationsEnabled,
        dim = 0.93f,
        intensity = 0.6f,
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding(),
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            placeholder = { Text(stringResource(R.string.drawer_search_hint)) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = { query = "" }) {
                        Icon(Icons.Filled.Clear, contentDescription = stringResource(R.string.action_close))
                    }
                }
            },
            singleLine = true,
            shape = RoundedCornerShape(24.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(
                onSearch = {
                    keyboard?.hide()
                    apps.firstOrNull()?.let { viewModel.launch(it) }
                },
            ),
        )

        if (categories.size > 1) {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item {
                    FilterChip(
                        selected = category == null,
                        onClick = { category = null },
                        label = { Text(stringResource(R.string.category_all)) },
                        colors = FilterChipDefaults.filterChipColors(),
                    )
                }
                items(categories, key = { it.name }) { item ->
                    FilterChip(
                        selected = category == item,
                        onClick = { category = if (category == item) null else item },
                        label = { Text(categoryLabel(item)) },
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.drawer_title),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = stringResource(R.string.drawer_app_count, apps.size),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            var sortMenuOpen by remember { mutableStateOf(false) }
            Box {
                IconButton(onClick = { sortMenuOpen = true }) {
                    Icon(
                        imageVector = Icons.Filled.SortByAlpha,
                        contentDescription = stringResource(R.string.drawer_sort_title),
                    )
                }
                DropdownMenu(expanded = sortMenuOpen, onDismissRequest = { sortMenuOpen = false }) {
                    DrawerSort.entries.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(drawerSortLabel(option)) },
                            onClick = {
                                viewModel.setDrawerSort(option)
                                sortMenuOpen = false
                            },
                            leadingIcon = {
                                if (option == settings.drawerSort) {
                                    Icon(Icons.Filled.Check, contentDescription = null)
                                }
                            },
                        )
                    }
                }
            }
        }

        if (apps.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                EmptyState(
                    title = stringResource(R.string.drawer_empty),
                    body = stringResource(R.string.home_hint_swipe),
                )
            }
        } else {
            // The A-Z rail only makes sense while the grid is alphabetical and unfiltered.
            val sections = remember(apps, settings.drawerSort) {
                if (settings.drawerSort == DrawerSort.NAME_ASC ||
                    settings.drawerSort == DrawerSort.NAME_DESC
                ) {
                    AlphabetIndex.build(apps.map { it.label })
                } else {
                    emptyList()
                }
            }
            val showRail = sections.size >= 4

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .navigationBarsPadding(),
            ) {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(settings.drawerColumns),
                    state = gridState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = 12.dp,
                        end = if (showRail) 30.dp else 12.dp,
                        top = 8.dp,
                        bottom = 8.dp,
                    ),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(apps, key = { it.key }) { app ->
                        AppTile(
                            app = app,
                            cache = viewModel.iconCache,
                            iconSize = settings.iconSizeDp.dp,
                            showLabel = settings.showLabels,
                            onClick = {
                                keyboard?.hide()
                                viewModel.launch(app)
                            },
                            onLongClick = { onAppLongPress(app) },
                            labelColor = MaterialTheme.colorScheme.onBackground,
                        )
                    }
                }

                if (showRail) {
                    FastScrollRail(
                        sections = sections,
                        modifier = Modifier.align(Alignment.CenterEnd),
                        onPick = { section ->
                            keyboard?.hide()
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            scope.launch { gridState.scrollToItem(section.index) }
                        },
                    )
                }
            }
        }
    }
    }
}

/**
 * Vertical A-Z rail on the drawer edge: tap or drag a letter to jump the grid to it.
 * Letters are laid out proportionally, so the touch position maps straight to a section.
 */
@Composable
private fun FastScrollRail(
    sections: List<AlphabetIndex.Section>,
    onPick: (AlphabetIndex.Section) -> Unit,
    modifier: Modifier = Modifier,
) {
    var active by remember { mutableStateOf(-1) }

    fun pick(y: Float, heightPx: Int) {
        val index = AlphabetIndex.indexForOffset(y, heightPx, sections.size)
        if (index >= 0 && index != active) {
            active = index
            onPick(sections[index])
        }
    }

    Column(
        modifier = modifier
            .fillMaxHeight()
            .width(28.dp)
            .padding(vertical = 12.dp)
            .background(
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.35f),
                shape = RoundedCornerShape(14.dp),
            )
            .pointerInput(sections) {
                detectTapGestures(
                    onPress = { offset -> pick(offset.y, size.height) },
                )
            }
            .pointerInput(sections) {
                detectVerticalDragGestures(
                    onDragEnd = { active = -1 },
                    onDragCancel = { active = -1 },
                ) { change, _ -> pick(change.position.y, size.height) }
            },
        verticalArrangement = Arrangement.SpaceEvenly,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        sections.forEachIndexed { index, section ->
            val selected = index == active
            Box(
                modifier = Modifier.size(width = 22.dp, height = 14.dp)
                    .background(
                        color = if (selected) {
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.22f)
                        } else {
                            Color.Transparent
                        },
                        shape = CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = section.letter,
                    style = MaterialTheme.typography.labelSmall,
                    textAlign = TextAlign.Center,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    color = if (selected) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
    }
}

@Composable
fun drawerSortLabel(sort: DrawerSort): String = stringResource(
    when (sort) {
        DrawerSort.NAME_ASC -> R.string.drawer_sort_name_asc
        DrawerSort.NAME_DESC -> R.string.drawer_sort_name_desc
        DrawerSort.MOST_USED -> R.string.drawer_sort_most_used
        DrawerSort.NEWEST -> R.string.drawer_sort_newest
    },
)

@Composable
fun categoryLabel(category: AppCategory): String = stringResource(
    when (category) {
        AppCategory.GAME -> R.string.category_game
        AppCategory.SOCIAL -> R.string.category_social
        AppCategory.PRODUCTIVITY -> R.string.category_productivity
        AppCategory.MEDIA -> R.string.category_media
        AppCategory.NEWS -> R.string.category_news
        AppCategory.MAPS -> R.string.category_maps
        AppCategory.SYSTEM -> R.string.category_system
        AppCategory.OTHER -> R.string.category_other
    },
)
