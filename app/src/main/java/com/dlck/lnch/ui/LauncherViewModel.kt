package com.dlck.lnch.ui

import android.app.Application
import android.content.Intent
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dlck.lnch.data.apps.AppCategory
import com.dlck.lnch.ai.predict.Suggester
import com.dlck.lnch.data.apps.AppInfo
import com.dlck.lnch.data.prefs.AccentColor
import com.dlck.lnch.data.prefs.AppLanguage
import com.dlck.lnch.data.prefs.AppStateRepository
import com.dlck.lnch.data.prefs.DrawerSort
import com.dlck.lnch.data.prefs.LauncherSettings
import com.dlck.lnch.data.prefs.ThemeMode
import com.dlck.lnch.graph
import com.dlck.lnch.utils.UsageAccess
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Top-level screens. The back stack lives in the ViewModel so rotation keeps its place. */
sealed interface Screen {
    data object Home : Screen
    data class Drawer(val initialQuery: String? = null, val category: AppCategory? = null) : Screen
    data object Search : Screen
    data object Chat : Screen
    data object Settings : Screen
    data object AiSetup : Screen
}

class LauncherViewModel(application: Application) : AndroidViewModel(application) {

    private val graph = application.graph
    private val settingsRepository = graph.settingsRepository
    private val appStateRepository = graph.appStateRepository
    private val appRepository = graph.appRepository

    val iconCache = graph.iconCache

    private val _backStack = MutableStateFlow<List<Screen>>(listOf(Screen.Home))
    val backStack: StateFlow<List<Screen>> = _backStack

    val currentScreen: Screen get() = _backStack.value.last()

    val settings: StateFlow<LauncherSettings> = settingsRepository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, LauncherSettings())

    val apps: StateFlow<List<AppInfo>> = appRepository.apps

    val loading: StateFlow<Boolean> = appRepository.loading

    private val appState: StateFlow<AppStateRepository.AppState> = appStateRepository.state
        .stateIn(
            viewModelScope,
            SharingStarted.Eagerly,
            AppStateRepository.AppState(),
        )

    private val _usageAccessGranted = MutableStateFlow(UsageAccess.isGranted(application))
    val usageAccessGranted: StateFlow<Boolean> = _usageAccessGranted

    /** Apps the user chose to hide are removed from every list except Settings. */
    val visibleApps: StateFlow<List<AppInfo>> = combine(apps, appState) { list, state ->
        list.filterNot { state.hidden.contains(it.key) }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val favorites: StateFlow<List<AppInfo>> = combine(apps, appState, settings) { list, state, cfg ->
        val byKey = list.associateBy { it.key }
        state.favorites.mapNotNull { byKey[it] }.take(cfg.favoritesCapacity)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val favoriteKeys: StateFlow<Set<String>> = appState
        .map { it.favorites.toSet() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    val pinnedKeys: StateFlow<Set<String>> = appState
        .map { it.pinned }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    val hiddenKeys: StateFlow<Set<String>> = appState
        .map { it.hidden }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    /** Hidden apps, for the "unhide" manager in Settings. */
    val hiddenApps: StateFlow<List<AppInfo>> = combine(apps, appState) { list, state ->
        list.filter { state.hidden.contains(it.key) }.sortedBy { it.label.lowercase() }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    /**
     * Time-aware predictions from the launcher's own history (see [Suggester]).
     * Recomputed whenever the app list, the stats or the hour changes; never leaves the device.
     */
    val suggestedApps: StateFlow<List<AppInfo>> =
        combine(visibleApps, appState, settings) { list, state, cfg ->
            if (!cfg.showSuggestions) {
                emptyList()
            } else {
                val byKey = list.associateBy { it.key }
                val hour = java.util.Calendar.getInstance()
                    .get(java.util.Calendar.HOUR_OF_DAY)
                Suggester
                    .rank(state.usage, hour, System.currentTimeMillis(), limit = 8)
                    .mapNotNull { byKey[it] }
            }
        }.flowOn(Dispatchers.Default)
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    /**
     * Recently used apps: the launcher's own history first (always available, zero permissions),
     * enriched with system usage stats when the user granted usage access.
     */
    val recentApps: StateFlow<List<AppInfo>> =
        combine(visibleApps, appState, _usageAccessGranted) { list, state, granted ->
            val byKey = list.associateBy { it.key }
            val local = state.usage.entries
                .sortedByDescending { it.value.lastLaunchedAt }
                .mapNotNull { byKey[it.key] }

            if (!granted) {
                local.take(8)
            } else {
                val systemOrder = UsageAccess.recentPackages(getApplication())
                val fromSystem = systemOrder.mapNotNull { pkg ->
                    list.firstOrNull { it.packageName == pkg }
                }
                (local + fromSystem).distinctBy { it.key }.take(8)
            }
        }.flowOn(Dispatchers.Default)
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    /**
     * Drawer content. Pinned apps always float to the top; everything below them follows the
     * user's chosen [DrawerSort]. Ties fall back to the label so the order is always stable.
     */
    fun drawerApps(
        query: String,
        category: AppCategory?,
        sort: DrawerSort = settings.value.drawerSort,
    ): List<AppInfo> {
        val pinned = pinnedKeys.value
        val usage = appState.value.usage
        val byLabel = compareBy<AppInfo> { it.label.lowercase() }

        val comparator: Comparator<AppInfo> = when (sort) {
            DrawerSort.NAME_ASC -> byLabel
            DrawerSort.NAME_DESC -> compareByDescending<AppInfo> { it.label.lowercase() }
            DrawerSort.MOST_USED ->
                compareByDescending<AppInfo> { usage[it.key]?.launchCount ?: 0 }
                    .thenByDescending { usage[it.key]?.lastLaunchedAt ?: 0L }
                    .then(byLabel)
            DrawerSort.NEWEST ->
                compareByDescending<AppInfo> { it.firstInstallTime }.then(byLabel)
        }

        return visibleApps.value
            .asSequence()
            .filter { category == null || it.category == category }
            .filter { query.isBlank() || matches(it, query) }
            .sortedWith(compareByDescending<AppInfo> { pinned.contains(it.key) }.then(comparator))
            .toList()
    }

    private fun matches(app: AppInfo, query: String): Boolean {
        val needle = com.dlck.lnch.ai.intent.AppMatcher.normalize(query)
        if (needle.isEmpty()) return true
        val label = com.dlck.lnch.ai.intent.AppMatcher.normalize(app.label)
        return label.contains(needle) || app.packageName.lowercase().contains(needle)
    }

    val availableCategories: StateFlow<List<AppCategory>> = visibleApps
        .map { list -> list.map { it.category }.distinct().sortedBy { it.ordinal } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    // ------------------------------------------------------------ navigation

    fun navigate(screen: Screen) {
        _backStack.value = _backStack.value + screen
    }

    fun replaceTop(screen: Screen) {
        _backStack.value = _backStack.value.dropLast(1) + screen
    }

    /** Returns false when already at the root (home). */
    fun goBack(): Boolean {
        val stack = _backStack.value
        if (stack.size <= 1) return false
        _backStack.value = stack.dropLast(1)
        return true
    }

    fun goHome() {
        _backStack.value = listOf(Screen.Home)
    }

    // --------------------------------------------------------------- actions

    fun launch(app: AppInfo) {
        viewModelScope.launch { appStateRepository.recordLaunch(app.key) }
        appRepository.launch(app)
    }

    fun toggleFavorite(app: AppInfo) = viewModelScope.launch {
        appStateRepository.toggleFavorite(app.key)
    }

    fun togglePinned(app: AppInfo) = viewModelScope.launch {
        appStateRepository.togglePinned(app.key)
    }

    fun toggleHidden(app: AppInfo) = viewModelScope.launch {
        appStateRepository.toggleHidden(app.key)
    }

    fun openAppInfo(app: AppInfo) = appRepository.openAppInfo(app.packageName)

    fun uninstall(app: AppInfo) = appRepository.requestUninstall(app.packageName)

    fun refreshApps() = viewModelScope.launch { appRepository.refresh() }

    /** Runs a web search through the same validated intent path the AI uses. */
    fun searchWeb(query: String) {
        if (query.isBlank()) return
        graph.intentExecutor.execute(com.dlck.lnch.ai.intent.LauncherIntent.SearchWeb(query))
    }

    fun refreshUsageAccess() {
        _usageAccessGranted.value = UsageAccess.isGranted(getApplication())
    }

    fun openWallpaperPicker(): Boolean = runCatching {
        val intent = Intent.createChooser(
            Intent(Intent.ACTION_SET_WALLPAPER),
            getApplication<Application>().getString(com.dlck.lnch.R.string.settings_wallpaper),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        getApplication<Application>().startActivity(intent)
        true
    }.getOrDefault(false)

    fun openHomeSettings(): Boolean = runCatching {
        getApplication<Application>().startActivity(
            Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        true
    }.getOrElse {
        runCatching {
            getApplication<Application>().startActivity(
                Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        }.getOrDefault(false)
    }

    fun openUsageAccessSettings(): Boolean = runCatching {
        getApplication<Application>().startActivity(UsageAccess.settingsIntent())
        true
    }.getOrDefault(false)

    // -------------------------------------------------------------- settings

    fun setThemeMode(mode: ThemeMode) = viewModelScope.launch { settingsRepository.setThemeMode(mode) }
    fun setDynamicColor(v: Boolean) = viewModelScope.launch { settingsRepository.setDynamicColor(v) }
    fun setAccent(a: AccentColor) = viewModelScope.launch { settingsRepository.setAccent(a) }
    fun setLanguage(l: AppLanguage) = viewModelScope.launch { settingsRepository.setLanguage(l) }
    fun setDrawerSort(sort: DrawerSort) = viewModelScope.launch { settingsRepository.setDrawerSort(sort) }
    fun setGridColumns(v: Int) = viewModelScope.launch { settingsRepository.setGridColumns(v) }
    fun setIconSize(v: Int) = viewModelScope.launch { settingsRepository.setIconSize(v) }
    fun setShowLabels(v: Boolean) = viewModelScope.launch { settingsRepository.setShowLabels(v) }
    fun setBackgroundDim(v: Float) = viewModelScope.launch { settingsRepository.setBackgroundDim(v) }
    fun setAnimations(v: Boolean) = viewModelScope.launch { settingsRepository.setAnimations(v) }
    fun setShowClock(v: Boolean) = viewModelScope.launch { settingsRepository.setShowClock(v) }
    fun setShowDate(v: Boolean) = viewModelScope.launch { settingsRepository.setShowDate(v) }
    fun setShowSearchBar(v: Boolean) = viewModelScope.launch { settingsRepository.setShowSearchBar(v) }
    fun setShowRecent(v: Boolean) = viewModelScope.launch { settingsRepository.setShowRecent(v) }
    fun setShowSuggestions(v: Boolean) =
        viewModelScope.launch { settingsRepository.setShowSuggestions(v) }
    fun setClock24(v: Boolean) = viewModelScope.launch { settingsRepository.setClock24(v) }
    fun setPersianDate(v: Boolean) = viewModelScope.launch { settingsRepository.setPersianDate(v) }
    fun setFavoritesRows(v: Int) = viewModelScope.launch { settingsRepository.setFavoritesRows(v) }

    fun resetSettings() = viewModelScope.launch {
        settingsRepository.resetAll()
        appStateRepository.resetAll()
    }
}
