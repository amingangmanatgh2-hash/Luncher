package com.dlck.lnch.ui.ai

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dlck.lnch.R
import com.dlck.lnch.ai.gemini.GeminiClient
import com.dlck.lnch.ai.gemini.GeminiContent
import com.dlck.lnch.ai.gemini.GeminiErrorKind
import com.dlck.lnch.ai.gemini.GeminiException
import com.dlck.lnch.ai.gemini.GeminiPart
import com.dlck.lnch.ai.gemini.GeminiSchemas
import com.dlck.lnch.ai.intent.AiDecision
import com.dlck.lnch.ai.intent.IntentExecutor
import com.dlck.lnch.ai.intent.IntentValidator
import com.dlck.lnch.ai.intent.LauncherIntent
import com.dlck.lnch.ai.intent.LocalIntentMatcher
import com.dlck.lnch.ai.intent.SystemPrompt
import com.dlck.lnch.data.prefs.StoredMessage
import com.dlck.lnch.graph
import com.dlck.lnch.utils.Network
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import java.util.Locale

enum class ChatRole { USER, ASSISTANT }

enum class ActionState { PENDING, EXECUTED, FAILED, CANCELLED }

data class ActionCard(
    val intent: LauncherIntent,
    val description: String,
    val state: ActionState,
)

data class ChatMessage(
    val id: Long,
    val role: ChatRole,
    val text: String,
    val streaming: Boolean = false,
    val failed: Boolean = false,
    val retryable: Boolean = false,
    val action: ActionCard? = null,
)

data class ChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    val busy: Boolean = false,
    val configured: Boolean = false,
    val loadedHistory: Boolean = false,
)

/**
 * Chat + intent orchestration.
 *
 * Flow of a user message:
 *  1. [LocalIntentMatcher] tries to resolve it offline (free, instant, works without a key);
 *  2. otherwise Gemini classifies it into the whitelisted intent contract (JSON mode);
 *  3. non-chat intents are executed through [IntentExecutor] — sensitive ones only after the
 *     user taps Confirm;
 *  4. GENERAL_CHAT answers are streamed token-by-token.
 */
class ChatViewModel(application: Application) : AndroidViewModel(application) {

    private val graph = application.graph
    private val client: GeminiClient = graph.geminiClient
    private val executor: IntentExecutor = graph.intentExecutor
    private val aiState = graph.aiStateRepository
    private val credentials = graph.credentialStore

    private val json = Json { ignoreUnknownKeys = true }

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private val _navigation = MutableSharedFlow<IntentExecutor.Navigation>(extraBufferCapacity = 4)
    val navigation: SharedFlow<IntentExecutor.Navigation> = _navigation.asSharedFlow()

    private var nextId = 1L
    private var activeJob: Job? = null
    private var lastUserMessage: String? = null

    init {
        _uiState.value = _uiState.value.copy(configured = credentials.hasKey() || credentials.usesCustomEndpoint)
        viewModelScope.launch {
            val stored = aiState.history.first()
            if (stored.isNotEmpty()) {
                val restored = stored.map { message ->
                    ChatMessage(
                        id = nextId++,
                        role = if (message.role == "user") ChatRole.USER else ChatRole.ASSISTANT,
                        text = message.text,
                    )
                }
                _uiState.value = _uiState.value.copy(messages = restored, loadedHistory = true)
            } else {
                _uiState.value = _uiState.value.copy(loadedHistory = true)
            }
        }
    }

    fun refreshConfiguration() {
        _uiState.value = _uiState.value.copy(
            configured = credentials.hasKey() || credentials.usesCustomEndpoint,
        )
    }

    // ------------------------------------------------------------------ send

    fun send(rawText: String) {
        val text = rawText.trim()
        if (text.isEmpty() || _uiState.value.busy) return

        lastUserMessage = text
        appendMessage(ChatMessage(id = nextId++, role = ChatRole.USER, text = text))
        process(text)
    }

    fun retry() {
        val text = lastUserMessage ?: return
        if (_uiState.value.busy) return
        // Drop the failed assistant bubble before retrying.
        _uiState.value = _uiState.value.copy(
            messages = _uiState.value.messages.filterNot { it.failed },
        )
        process(text)
    }

    private fun process(text: String) {
        activeJob?.cancel()
        activeJob = viewModelScope.launch {
            _uiState.value = _uiState.value.copy(busy = true)
            try {
                val apps = graph.appRepository.apps.value

                // 1) Offline fast path -------------------------------------------------
                val local = LocalIntentMatcher.match(text, apps)
                if (local != null && local !is LauncherIntent.GeneralChat) {
                    handleIntent(local, reply = null)
                    return@launch
                }

                // 2) Needs the network from here on -----------------------------------
                if (!credentials.hasKey() && !credentials.usesCustomEndpoint) {
                    appendMessage(
                        ChatMessage(
                            id = nextId++,
                            role = ChatRole.ASSISTANT,
                            text = string(R.string.err_no_key),
                            failed = true,
                            retryable = false,
                        ),
                    )
                    return@launch
                }
                if (!Network.isOnline(getApplication())) {
                    appendMessage(
                        ChatMessage(
                            id = nextId++,
                            role = ChatRole.ASSISTANT,
                            text = string(R.string.ai_offline),
                            failed = true,
                            retryable = true,
                        ),
                    )
                    return@launch
                }

                val model = graph.settingsRepository.settings.first().geminiModel
                val languageTag = Locale.getDefault().toLanguageTag()

                // 3) Ask Gemini to classify the request -------------------------------
                val decision = classify(text, model, languageTag, apps)
                val intent = IntentValidator.validate(decision)

                if (intent is LauncherIntent.GeneralChat) {
                    streamAnswer(text, model, languageTag, apps, fallbackReply = decision.reply)
                } else {
                    handleIntent(intent, reply = decision.reply.takeIf { it.isNotBlank() })
                }
            } catch (e: GeminiException) {
                aiState.recordFailure()
                appendMessage(
                    ChatMessage(
                        id = nextId++,
                        role = ChatRole.ASSISTANT,
                        text = e.localizedMessage(getApplication()),
                        failed = true,
                        retryable = e.isRetryable,
                    ),
                )
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Throwable) {
                aiState.recordFailure()
                appendMessage(
                    ChatMessage(
                        id = nextId++,
                        role = ChatRole.ASSISTANT,
                        text = string(R.string.err_unknown, e.javaClass.simpleName),
                        failed = true,
                        retryable = true,
                    ),
                )
            } finally {
                _uiState.value = _uiState.value.copy(busy = false)
                persist()
            }
        }
    }

    private suspend fun classify(
        text: String,
        model: String,
        languageTag: String,
        apps: List<com.dlck.lnch.data.apps.AppInfo>,
    ): AiDecision {
        val response = client.generate(
            model = model,
            contents = listOf(
                GeminiContent(role = "user", parts = listOf(GeminiPart(text))),
            ),
            systemInstruction = SystemPrompt.intentInstruction(apps, languageTag),
            config = GeminiSchemas.intentConfig,
        )
        response.usageMetadata?.let {
            aiState.recordRequest(it.promptTokenCount, it.candidatesTokenCount)
        } ?: aiState.recordRequest(0, 0)

        val raw = response.text.trim()
        if (raw.isEmpty()) throw GeminiException(GeminiErrorKind.PARSE)
        return runCatching { json.decodeFromString<AiDecision>(raw) }
            .getOrElse { AiDecision(intent = "GENERAL_CHAT", reply = raw) }
    }

    private suspend fun streamAnswer(
        text: String,
        model: String,
        languageTag: String,
        apps: List<com.dlck.lnch.data.apps.AppInfo>,
        fallbackReply: String,
    ) {
        val placeholderId = nextId++
        appendMessage(
            ChatMessage(
                id = placeholderId,
                role = ChatRole.ASSISTANT,
                text = "",
                streaming = true,
            ),
        )

        val history = _uiState.value.messages
            .filter { !it.failed && it.action == null && it.id != placeholderId }
            .takeLast(10)
            .map { message ->
                GeminiContent(
                    role = if (message.role == ChatRole.USER) "user" else "model",
                    parts = listOf(GeminiPart(message.text)),
                )
            }

        val builder = StringBuilder()
        try {
            client.streamGenerate(
                model = model,
                contents = history.ifEmpty {
                    listOf(GeminiContent(role = "user", parts = listOf(GeminiPart(text))))
                },
                systemInstruction = SystemPrompt.chatInstruction(apps, languageTag),
                config = GeminiSchemas.chatConfig,
            ).collect { event ->
                when (event) {
                    is GeminiClient.StreamEvent.Chunk -> {
                        builder.append(event.text)
                        updateMessage(placeholderId) { it.copy(text = builder.toString()) }
                    }

                    is GeminiClient.StreamEvent.Done -> {
                        event.usage?.let {
                            aiState.recordRequest(it.promptTokenCount, it.candidatesTokenCount)
                        }
                        updateMessage(placeholderId) { it.copy(streaming = false) }
                    }
                }
            }
        } catch (e: GeminiException) {
            if (builder.isEmpty() && fallbackReply.isNotBlank()) {
                // The classification call already produced a usable answer — use it rather than
                // showing an error for a streaming-only problem.
                updateMessage(placeholderId) {
                    it.copy(text = fallbackReply, streaming = false)
                }
            } else {
                aiState.recordFailure()
                updateMessage(placeholderId) {
                    it.copy(
                        text = if (builder.isEmpty()) {
                            e.localizedMessage(getApplication())
                        } else {
                            builder.toString()
                        },
                        streaming = false,
                        failed = builder.isEmpty(),
                        retryable = e.isRetryable,
                    )
                }
            }
        }
    }

    // ---------------------------------------------------------------- intents

    private suspend fun handleIntent(intent: LauncherIntent, reply: String?) {
        val description = executor.describe(intent)

        if (intent.requiresConfirmation) {
            appendMessage(
                ChatMessage(
                    id = nextId++,
                    role = ChatRole.ASSISTANT,
                    text = reply?.takeIf { it.isNotBlank() }
                        ?: string(R.string.ai_action_pending, description),
                    action = ActionCard(intent, description, ActionState.PENDING),
                ),
            )
            return
        }

        val outcome = executor.execute(intent)
        outcome.navigation?.let { _navigation.tryEmit(it) }
        appendMessage(
            ChatMessage(
                id = nextId++,
                role = ChatRole.ASSISTANT,
                text = buildString {
                    if (!reply.isNullOrBlank()) {
                        append(reply)
                    } else {
                        append(
                            if (outcome.success) {
                                string(R.string.ai_action_done, outcome.message)
                            } else {
                                string(R.string.ai_action_failed, outcome.message)
                            },
                        )
                    }
                    if (!outcome.success && !reply.isNullOrBlank()) {
                        append("\n")
                        append(outcome.message)
                    }
                },
                action = ActionCard(
                    intent,
                    description,
                    if (outcome.success) ActionState.EXECUTED else ActionState.FAILED,
                ),
            ),
        )
    }

    fun confirmAction(messageId: Long) {
        val message = _uiState.value.messages.firstOrNull { it.id == messageId } ?: return
        val card = message.action ?: return
        if (card.state != ActionState.PENDING) return

        val outcome = executor.execute(card.intent)
        outcome.navigation?.let { _navigation.tryEmit(it) }
        updateMessage(messageId) {
            it.copy(
                action = card.copy(
                    state = if (outcome.success) ActionState.EXECUTED else ActionState.FAILED,
                ),
                text = if (outcome.success) {
                    string(R.string.ai_action_done, outcome.message)
                } else {
                    string(R.string.ai_action_failed, outcome.message)
                },
            )
        }
        viewModelScope.launch { persist() }
    }

    fun cancelAction(messageId: Long) {
        val message = _uiState.value.messages.firstOrNull { it.id == messageId } ?: return
        val card = message.action ?: return
        updateMessage(messageId) { it.copy(action = card.copy(state = ActionState.CANCELLED)) }
    }

    // ------------------------------------------------------------------ misc

    fun clear() {
        activeJob?.cancel()
        _uiState.value = _uiState.value.copy(messages = emptyList(), busy = false)
        lastUserMessage = null
        viewModelScope.launch { aiState.clearHistory() }
    }

    fun stop() {
        activeJob?.cancel()
        _uiState.value = _uiState.value.copy(busy = false)
        _uiState.value = _uiState.value.copy(
            messages = _uiState.value.messages.map { it.copy(streaming = false) },
        )
    }

    private fun appendMessage(message: ChatMessage) {
        _uiState.value = _uiState.value.copy(messages = _uiState.value.messages + message)
    }

    private fun updateMessage(id: Long, transform: (ChatMessage) -> ChatMessage) {
        _uiState.value = _uiState.value.copy(
            messages = _uiState.value.messages.map { if (it.id == id) transform(it) else it },
        )
    }

    private suspend fun persist() {
        val stored = _uiState.value.messages
            .filterNot { it.failed || it.streaming }
            .map {
                StoredMessage(
                    role = if (it.role == ChatRole.USER) "user" else "model",
                    text = it.text,
                    timestamp = System.currentTimeMillis(),
                )
            }
        aiState.saveHistory(stored)
    }

    private fun string(resId: Int, vararg args: Any): String =
        if (args.isEmpty()) {
            getApplication<Application>().getString(resId)
        } else {
            getApplication<Application>().getString(resId, *args)
        }
}
