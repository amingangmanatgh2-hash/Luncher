package com.dlck.lnch.ui.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dlck.lnch.R
import com.dlck.lnch.ai.intent.IntentExecutor
import com.dlck.lnch.ui.components.AuroraBackground
import com.dlck.lnch.ui.components.EmptyState
import com.dlck.lnch.ui.components.MarkdownText
import com.dlck.lnch.ui.components.ScreenHeader
import com.dlck.lnch.ui.components.TypingIndicator
import kotlinx.coroutines.flow.collectLatest

@Composable
fun ChatScreen(
    viewModel: ChatViewModel,
    animationsEnabled: Boolean,
    onBack: () -> Unit,
    onOpenSetup: () -> Unit,
    onNavigationRequest: (IntentExecutor.Navigation) -> Unit,
    prefill: String? = null,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val clipboard = LocalClipboardManager.current
    val haptics = LocalHapticFeedback.current

    // Dictation is delegated to the system recogniser; the transcript lands in the field so the
    // user can edit it before sending. No RECORD_AUDIO permission, no audio ever leaves via us.
    val voice = rememberVoiceInput { spoken ->
        input = if (input.isBlank()) spoken else "$input $spoken"
    }

    LaunchedEffect(Unit) {
        viewModel.refreshConfiguration()
        viewModel.navigation.collectLatest(onNavigationRequest)
    }

    LaunchedEffect(prefill) {
        if (!prefill.isNullOrBlank()) viewModel.send(prefill)
    }

    LaunchedEffect(state.messages.size, state.messages.lastOrNull()?.text?.length) {
        if (state.messages.isNotEmpty()) {
            runCatching { listState.animateScrollToItem(state.messages.lastIndex) }
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
    AuroraBackground(animated = animationsEnabled, dim = 0.93f, intensity = 0.7f)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .imePadding(),
    ) {
        ScreenHeader(
            title = stringResource(R.string.ai_title),
            onBack = onBack,
            trailing = {
                if (state.messages.isNotEmpty()) {
                    IconButton(onClick = viewModel::clear) {
                        Icon(
                            Icons.Filled.DeleteSweep,
                            contentDescription = stringResource(R.string.ai_clear),
                        )
                    }
                }
            },
        )

        if (!state.configured) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                ),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = stringResource(R.string.ai_not_configured_title),
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                    Text(
                        text = stringResource(R.string.ai_not_configured_body),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                    TextButton(onClick = onOpenSetup) {
                        Text(stringResource(R.string.ai_go_to_setup))
                    }
                }
            }
        }

        Box(modifier = Modifier.weight(1f)) {
            if (state.messages.isEmpty()) {
                ChatSuggestions(onPick = { input = it })
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.messages, key = { it.id }) { message ->
                        MessageBubble(
                            message = message,
                            animationsEnabled = animationsEnabled,
                            onCopy = {
                                clipboard.setText(AnnotatedString(message.text))
                            },
                            onRetry = viewModel::retry,
                            onConfirm = { viewModel.confirmAction(message.id) },
                            onCancel = { viewModel.cancelAction(message.id) },
                        )
                    }
                    if (state.busy && state.messages.lastOrNull()?.streaming != true) {
                        item {
                            Row(
                                modifier = Modifier.padding(start = 16.dp, top = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                TypingIndicator(animated = animationsEnabled)
                                Text(
                                    text = stringResource(R.string.ai_thinking),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }

        Surface(
            tonalElevation = 3.dp,
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding(),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(stringResource(R.string.ai_input_hint)) },
                    maxLines = 4,
                    shape = RoundedCornerShape(22.dp),
                )
                if (voice.available && !state.busy) {
                    IconButton(
                        onClick = {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            voice.launch()
                        },
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(
                            Icons.Filled.Mic,
                            contentDescription = stringResource(R.string.ai_voice_input),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
                if (state.busy) {
                    IconButton(
                        onClick = viewModel::stop,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(Icons.Filled.Stop, contentDescription = stringResource(R.string.action_cancel))
                    }
                } else {
                    IconButton(
                        onClick = {
                            val text = input
                            input = ""
                            viewModel.send(text)
                        },
                        enabled = input.isNotBlank(),
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Send,
                            contentDescription = stringResource(R.string.ai_send),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
    }
}

@Composable
private fun ChatSuggestions(onPick: (String) -> Unit) {
    val examples = listOf(
        stringResource(R.string.ai_example_1),
        stringResource(R.string.ai_example_2),
        stringResource(R.string.ai_example_3),
        stringResource(R.string.ai_example_4),
        stringResource(R.string.ai_example_5),
        stringResource(R.string.ai_example_6),
    )
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        EmptyState(
            title = stringResource(R.string.ai_empty_title),
            body = stringResource(R.string.ai_empty_body),
        )
        Spacer(Modifier.height(8.dp))
        examples.forEach { example ->
            AssistChip(
                onClick = { onPick(example) },
                label = { Text(example) },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 3.dp),
            )
        }
    }
}

@Composable
private fun MessageBubble(
    message: ChatMessage,
    animationsEnabled: Boolean,
    onCopy: () -> Unit,
    onRetry: () -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    val isUser = message.role == ChatRole.USER
    val bubbleColor = when {
        isUser -> MaterialTheme.colorScheme.primaryContainer
        message.failed -> MaterialTheme.colorScheme.errorContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    val textColor = when {
        isUser -> MaterialTheme.colorScheme.onPrimaryContainer
        message.failed -> MaterialTheme.colorScheme.onErrorContainer
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        Surface(
            color = bubbleColor,
            shape = RoundedCornerShape(
                topStart = 18.dp,
                topEnd = 18.dp,
                bottomStart = if (isUser) 18.dp else 4.dp,
                bottomEnd = if (isUser) 4.dp else 18.dp,
            ),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                if (message.text.isNotEmpty()) {
                    if (isUser) {
                        Text(
                            text = message.text,
                            style = MaterialTheme.typography.bodyMedium,
                            color = textColor,
                        )
                    } else {
                        // Models answer with **bold**, `code` and "- " bullets — render them.
                        MarkdownText(text = message.text, color = textColor)
                    }
                }
                if (message.streaming) {
                    Spacer(Modifier.height(6.dp))
                    TypingIndicator(animated = animationsEnabled)
                }

                message.action?.let { card ->
                    if (card.state == ActionState.PENDING) {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = stringResource(R.string.ai_confirm_action),
                            style = MaterialTheme.typography.labelMedium,
                            color = textColor,
                        )
                        Text(
                            text = card.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = textColor,
                        )
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = onConfirm) {
                                Text(stringResource(R.string.action_confirm))
                            }
                            OutlinedButton(onClick = onCancel) {
                                Text(stringResource(R.string.action_cancel))
                            }
                        }
                    }
                }
            }
        }

        if (!isUser && !message.streaming && message.text.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onCopy, modifier = Modifier.size(36.dp)) {
                    Icon(
                        Icons.Filled.ContentCopy,
                        contentDescription = stringResource(R.string.action_copy),
                        modifier = Modifier.size(16.dp),
                    )
                }
                if (message.failed && message.retryable) {
                    IconButton(onClick = onRetry, modifier = Modifier.size(36.dp)) {
                        Icon(
                            Icons.Filled.Refresh,
                            contentDescription = stringResource(R.string.action_retry),
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }
    }
}
