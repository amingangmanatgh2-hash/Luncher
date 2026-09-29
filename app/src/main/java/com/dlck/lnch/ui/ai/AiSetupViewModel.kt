package com.dlck.lnch.ui.ai

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dlck.lnch.ai.gemini.GeminiClient
import com.dlck.lnch.data.prefs.AiUsage
import com.dlck.lnch.data.secure.CredentialStore
import com.dlck.lnch.graph
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class ConnectionStatus { NOT_CONFIGURED, UNVERIFIED, CONNECTED, ERROR }

data class AiSetupUiState(
    val status: ConnectionStatus = ConnectionStatus.NOT_CONFIGURED,
    val testing: Boolean = false,
    val message: String? = null,
    val errorMessage: String? = null,
    val lastCheckedAt: Long = 0L,
    val availableModels: List<String> = emptyList(),
    val selectedModel: String = "gemini-2.5-flash",
    val baseUrl: String = CredentialStore.DEFAULT_BASE_URL,
    val keyStored: Boolean = false,
    val usesProxy: Boolean = false,
)

/**
 * Drives the in-app "AI Setup" page.
 *
 * The API key travels one way only: from the text field into the encrypted store. It is never
 * read back into the UI state, so it cannot be rendered, logged or screenshotted.
 */
class AiSetupViewModel(application: Application) : AndroidViewModel(application) {

    private val graph = application.graph
    private val credentials = graph.credentialStore
    private val client: GeminiClient = graph.geminiClient
    private val settingsRepository = graph.settingsRepository

    private val _uiState = MutableStateFlow(AiSetupUiState())
    val uiState: StateFlow<AiSetupUiState> = _uiState.asStateFlow()

    val usage: StateFlow<AiUsage> = graph.aiStateRepository.usage
        .stateIn(viewModelScope, SharingStarted.Eagerly, AiUsage())

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val model = settingsRepository.settings.first().geminiModel
            val hasKey = credentials.hasKey()
            val lastOk = credentials.lastSuccessfulCheck
            _uiState.value = _uiState.value.copy(
                keyStored = hasKey,
                baseUrl = credentials.baseUrl,
                usesProxy = credentials.usesCustomEndpoint,
                selectedModel = model,
                lastCheckedAt = lastOk,
                status = when {
                    !hasKey && !credentials.usesCustomEndpoint -> ConnectionStatus.NOT_CONFIGURED
                    lastOk > 0L -> ConnectionStatus.CONNECTED
                    else -> ConnectionStatus.UNVERIFIED
                },
            )
        }
    }

    fun saveKey(rawKey: String) {
        val trimmed = rawKey.trim()
        if (trimmed.isEmpty()) return
        credentials.saveKey(trimmed)
        credentials.lastSuccessfulCheck = 0L
        _uiState.value = _uiState.value.copy(
            keyStored = true,
            status = ConnectionStatus.UNVERIFIED,
            errorMessage = null,
            lastCheckedAt = 0L,
        )
    }

    fun setBaseUrl(url: String) {
        val cleaned = url.trim().ifBlank { CredentialStore.DEFAULT_BASE_URL }
        credentials.baseUrl = cleaned
        _uiState.value = _uiState.value.copy(
            baseUrl = credentials.baseUrl,
            usesProxy = credentials.usesCustomEndpoint,
        )
    }

    fun setModel(model: String) {
        viewModelScope.launch {
            settingsRepository.setGeminiModel(model)
            _uiState.value = _uiState.value.copy(selectedModel = model)
        }
    }

    fun deleteKey() {
        credentials.clearKey()
        _uiState.value = _uiState.value.copy(
            keyStored = false,
            status = ConnectionStatus.NOT_CONFIGURED,
            errorMessage = null,
            availableModels = emptyList(),
            lastCheckedAt = 0L,
        )
    }

    /** Validates the stored credential. Only the outcome is surfaced — never the key. */
    fun testConnection() {
        if (_uiState.value.testing) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(testing = true, errorMessage = null, message = null)
            val result = client.testConnection()
            _uiState.value = if (result.ok) {
                _uiState.value.copy(
                    testing = false,
                    status = ConnectionStatus.CONNECTED,
                    availableModels = result.availableModels,
                    lastCheckedAt = credentials.lastSuccessfulCheck,
                    errorMessage = null,
                )
            } else {
                _uiState.value.copy(
                    testing = false,
                    status = ConnectionStatus.ERROR,
                    errorMessage = result.error?.localizedMessage(getApplication()),
                )
            }
        }
    }

    fun dismissMessage() {
        _uiState.value = _uiState.value.copy(message = null, errorMessage = null)
    }
}
