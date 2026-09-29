package com.dlck.lnch.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Wallpaper
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.dlck.lnch.R
import com.dlck.lnch.ai.intent.IntentExecutor
import com.dlck.lnch.data.apps.AppInfo
import com.dlck.lnch.ui.ai.AiSetupScreen
import com.dlck.lnch.ui.ai.AiSetupViewModel
import com.dlck.lnch.ui.ai.ChatScreen
import com.dlck.lnch.ui.ai.ChatViewModel
import com.dlck.lnch.ui.apps.AppActionSheet
import com.dlck.lnch.ui.apps.AppDrawerScreen
import com.dlck.lnch.ui.launcher.HomeScreen
import com.dlck.lnch.ui.search.SearchScreen
import com.dlck.lnch.ui.settings.SettingsScreen

/**
 * Root composable: owns the back stack, the shared bottom sheets and the screen transitions.
 * Animations honour the "Animations" setting so low-end devices can turn them off completely.
 */
@Composable
fun LauncherRoot(viewModel: LauncherViewModel) {
    val backStack by viewModel.backStack.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val favorites by viewModel.favoriteKeys.collectAsStateWithLifecycle()
    val pinned by viewModel.pinnedKeys.collectAsStateWithLifecycle()
    val hidden by viewModel.hiddenKeys.collectAsStateWithLifecycle()

    val chatViewModel: ChatViewModel = viewModel()
    val setupViewModel: AiSetupViewModel = viewModel()

    val current = backStack.last()
    var sheetApp by remember { mutableStateOf<AppInfo?>(null) }
    var showHomeMenu by remember { mutableStateOf(false) }
    var chatPrefill by remember { mutableStateOf<String?>(null) }

    BackHandler(enabled = backStack.size > 1) { viewModel.goBack() }

    val animated = settings.animationsEnabled

    Box(modifier = Modifier.fillMaxSize()) {
        AnimatedContent(
            targetState = current,
            transitionSpec = {
                if (!animated) {
                    EnterTransition.None togetherWith ExitTransition.None
                } else {
                    val forward = targetState !is Screen.Home
                    (
                        slideInVertically(animationSpec = tween(220)) { height ->
                            if (forward) height / 6 else -height / 6
                        } + fadeIn(animationSpec = tween(180))
                        ) togetherWith fadeOut(animationSpec = tween(140)) +
                        slideOutVertically(animationSpec = tween(220)) { height ->
                            if (forward) -height / 12 else height / 12
                        }
                }
            },
            label = "screen",
        ) { screen ->
            when (screen) {
                Screen.Home -> HomeScreen(
                    viewModel = viewModel,
                    onOpenDrawer = { viewModel.navigate(Screen.Drawer()) },
                    onOpenSearch = { viewModel.navigate(Screen.Search) },
                    onOpenChat = {
                        chatPrefill = null
                        viewModel.navigate(Screen.Chat)
                    },
                    onAppLongPress = { sheetApp = it },
                    onHomeLongPress = { showHomeMenu = true },
                )

                is Screen.Drawer -> AppDrawerScreen(
                    viewModel = viewModel,
                    initialQuery = screen.initialQuery,
                    initialCategory = screen.category,
                    onAppLongPress = { sheetApp = it },
                )

                Screen.Search -> SearchScreen(
                    viewModel = viewModel,
                    onAskAi = { query ->
                        chatPrefill = query
                        viewModel.replaceTop(Screen.Chat)
                    },
                    onWebSearch = { query -> viewModel.searchWeb(query) },
                    onAppLongPress = { sheetApp = it },
                )

                Screen.Chat -> ChatScreen(
                    viewModel = chatViewModel,
                    animationsEnabled = animated,
                    onBack = { viewModel.goBack() },
                    onOpenSetup = { viewModel.navigate(Screen.AiSetup) },
                    onNavigationRequest = { navigation ->
                        when (navigation) {
                            is IntentExecutor.Navigation.OpenDrawer -> viewModel.navigate(
                                Screen.Drawer(navigation.query, navigation.category),
                            )

                            IntentExecutor.Navigation.ShowRecent -> viewModel.goHome()
                        }
                    },
                    prefill = chatPrefill,
                )

                Screen.Settings -> SettingsScreen(
                    viewModel = viewModel,
                    onBack = { viewModel.goBack() },
                    onOpenAiSetup = { viewModel.navigate(Screen.AiSetup) },
                )

                Screen.AiSetup -> AiSetupScreen(
                    viewModel = setupViewModel,
                    onBack = { viewModel.goBack() },
                )
            }
        }
    }

    // Consume the prefill exactly once so returning to the chat does not resend it.
    LaunchedEffect(current) {
        if (current !is Screen.Chat) chatPrefill = null
    }

    LaunchedEffect(current) {
        if (current is Screen.AiSetup) setupViewModel.refresh()
        if (current is Screen.Chat) chatViewModel.refreshConfiguration()
    }

    sheetApp?.let { app ->
        AppActionSheet(
            app = app,
            cache = viewModel.iconCache,
            isFavorite = favorites.contains(app.key),
            isPinned = pinned.contains(app.key),
            isHidden = hidden.contains(app.key),
            onDismiss = { sheetApp = null },
            onOpen = {
                sheetApp = null
                viewModel.launch(app)
            },
            onToggleFavorite = {
                viewModel.toggleFavorite(app)
                sheetApp = null
            },
            onTogglePin = {
                viewModel.togglePinned(app)
                sheetApp = null
            },
            onToggleHidden = {
                viewModel.toggleHidden(app)
                sheetApp = null
            },
            onAppInfo = {
                sheetApp = null
                viewModel.openAppInfo(app)
            },
            onUninstall = {
                sheetApp = null
                viewModel.uninstall(app)
            },
        )
    }

    if (showHomeMenu) {
        ModalBottomSheet(onDismissRequest = { showHomeMenu = false }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(bottom = 16.dp),
            ) {
                HomeMenuItem(
                    text = stringResource(R.string.settings_wallpaper),
                    icon = { Icon(Icons.Filled.Wallpaper, contentDescription = null) },
                ) {
                    showHomeMenu = false
                    viewModel.openWallpaperPicker()
                }
                HomeMenuItem(
                    text = stringResource(R.string.settings_title),
                    icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                ) {
                    showHomeMenu = false
                    viewModel.navigate(Screen.Settings)
                }
                HomeMenuItem(
                    text = stringResource(R.string.settings_ai_setup),
                    icon = { Icon(Icons.Filled.AutoAwesome, contentDescription = null) },
                ) {
                    showHomeMenu = false
                    viewModel.navigate(Screen.AiSetup)
                }
            }
        }
    }
}

@Composable
private fun HomeMenuItem(
    text: String,
    icon: @Composable () -> Unit,
    onClick: () -> Unit,
) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        icon()
        Text(text = text, style = MaterialTheme.typography.bodyLarge)
    }
}
