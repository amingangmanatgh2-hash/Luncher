package com.dlck.lnch.ui.ai

import android.content.Intent
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dlck.lnch.R
import com.dlck.lnch.ai.gemini.GeminiClient
import com.dlck.lnch.ui.components.ScreenHeader
import java.text.DateFormat
import java.util.Date

/**
 * In-app "AI Setup" page required by the spec:
 * connection status, API configuration, test, change/delete credential, security info,
 * usage info and a step-by-step tutorial.
 *
 * The stored key is never rendered — the field is write-only and masked while typing.
 */
@Composable
fun AiSetupScreen(
    viewModel: AiSetupViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val usage by viewModel.usage.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var keyInput by remember { mutableStateOf("") }
    var endpointInput by remember { mutableStateOf(state.baseUrl) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var savedNotice by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.baseUrl) { endpointInput = state.baseUrl }

    fun open(url: String) {
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, url.toUri())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.97f))
            .statusBarsPadding()
            .imePadding(),
    ) {
        ScreenHeader(title = stringResource(R.string.setup_title), onBack = onBack)

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .navigationBarsPadding(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ------------------------------------------------ status
            item {
                SetupCard(title = stringResource(R.string.setup_status)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val (label, color) = when (state.status) {
                            ConnectionStatus.CONNECTED ->
                                stringResource(R.string.setup_status_connected) to Color(0xFF22C55E)

                            ConnectionStatus.UNVERIFIED ->
                                stringResource(R.string.setup_status_unverified) to Color(0xFFF59E0B)

                            ConnectionStatus.ERROR ->
                                stringResource(R.string.setup_status_error) to MaterialTheme.colorScheme.error

                            ConnectionStatus.NOT_CONFIGURED ->
                                stringResource(R.string.setup_status_not_configured) to
                                    MaterialTheme.colorScheme.outline
                        }
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .background(color, CircleShape),
                        )
                        Spacer(Modifier.size(10.dp))
                        Text(text = label, style = MaterialTheme.typography.titleSmall)
                    }

                    Text(
                        text = stringResource(
                            R.string.setup_last_checked,
                            if (state.lastCheckedAt > 0L) {
                                DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                                    .format(Date(state.lastCheckedAt))
                            } else {
                                stringResource(R.string.setup_never)
                            },
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Text(
                        text = stringResource(
                            if (state.keyStored) R.string.setup_key_stored else R.string.setup_key_none,
                        ),
                        style = MaterialTheme.typography.bodySmall,
                    )

                    state.errorMessage?.let { error ->
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = error,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }

                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = viewModel::testConnection,
                            enabled = !state.testing && (state.keyStored || state.usesProxy),
                        ) {
                            if (state.testing) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                )
                                Spacer(Modifier.size(8.dp))
                                Text(stringResource(R.string.setup_testing))
                            } else {
                                Text(stringResource(R.string.setup_test))
                            }
                        }
                        if (state.keyStored) {
                            OutlinedButton(onClick = { showDeleteDialog = true }) {
                                Text(stringResource(R.string.setup_delete))
                            }
                        }
                    }
                }
            }

            // ------------------------------------------------ configuration
            item {
                SetupCard(title = stringResource(R.string.setup_config)) {
                    OutlinedTextField(
                        value = keyInput,
                        onValueChange = { keyInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.setup_key_label)) },
                        placeholder = { Text(stringResource(R.string.setup_key_hint)) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        shape = RoundedCornerShape(14.dp),
                    )
                    Text(
                        text = stringResource(R.string.setup_key_never_shown),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(
                        onClick = {
                            if (keyInput.isBlank()) {
                                savedNotice = context.getString(R.string.setup_empty_key_error)
                            } else {
                                val warn = !keyInput.trim().startsWith("AIza")
                                viewModel.saveKey(keyInput)
                                keyInput = ""
                                savedNotice = context.getString(
                                    if (warn) R.string.setup_key_format_warning else R.string.setup_saved,
                                )
                            }
                        },
                        enabled = keyInput.isNotBlank(),
                    ) {
                        Text(stringResource(R.string.setup_save_key))
                    }

                    savedNotice?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }

                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = stringResource(R.string.setup_model),
                        style = MaterialTheme.typography.labelLarge,
                    )
                    val models = remember(state.availableModels) {
                        (state.availableModels.ifEmpty { GeminiClient.FALLBACK_MODELS } +
                            state.selectedModel).distinct()
                    }
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(models, key = { it }) { model ->
                            FilterChip(
                                selected = model == state.selectedModel,
                                onClick = { viewModel.setModel(model) },
                                label = { Text(model) },
                            )
                        }
                    }

                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = endpointInput,
                        onValueChange = { endpointInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.setup_base_url)) },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                    )
                    Text(
                        text = stringResource(R.string.setup_base_url_desc),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedButton(onClick = { viewModel.setBaseUrl(endpointInput) }) {
                        Text(stringResource(R.string.action_save))
                    }
                }
            }

            // ------------------------------------------------ tutorial
            item {
                SetupCard(title = stringResource(R.string.setup_tutorial)) {
                    listOf(
                        R.string.setup_tutorial_step1,
                        R.string.setup_tutorial_step2,
                        R.string.setup_tutorial_step3,
                        R.string.setup_tutorial_step4,
                        R.string.setup_tutorial_step5,
                        R.string.setup_tutorial_step6,
                    ).forEach { res ->
                        Text(
                            text = stringResource(res),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(vertical = 3.dp),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    LinkButton(stringResource(R.string.setup_open_ai_studio)) {
                        open("https://aistudio.google.com/app/apikey")
                    }
                    LinkButton(stringResource(R.string.setup_open_docs)) {
                        open("https://ai.google.dev/gemini-api/docs/api-key")
                    }
                    LinkButton(stringResource(R.string.setup_open_usage)) {
                        open("https://ai.google.dev/gemini-api/docs/rate-limits")
                    }
                }
            }

            // ------------------------------------------------ security
            item {
                SetupCard(title = stringResource(R.string.setup_security)) {
                    Text(
                        text = stringResource(R.string.setup_security_body),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            // ------------------------------------------------ usage
            item {
                SetupCard(title = stringResource(R.string.setup_usage)) {
                    Text(
                        text = stringResource(R.string.setup_usage_body),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(Modifier.height(8.dp))
                    UsageRow("Requests (this device)", usage.totalRequests.toString())
                    UsageRow("Failed requests", usage.failedRequests.toString())
                    UsageRow("Prompt tokens", usage.totalPromptTokens.toString())
                    UsageRow("Response tokens", usage.totalResponseTokens.toString())
                    UsageRow(
                        "Last request",
                        if (usage.lastRequestAt > 0L) {
                            DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                                .format(Date(usage.lastRequestAt))
                        } else {
                            stringResource(R.string.setup_never)
                        },
                    )
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text(stringResource(R.string.setup_delete)) },
            text = { Text(stringResource(R.string.setup_delete_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.deleteKey()
                        showDeleteDialog = false
                        savedNotice = context.getString(R.string.setup_deleted)
                    },
                ) { Text(stringResource(R.string.action_delete)) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
}

@Composable
private fun SetupCard(title: String, content: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(text = title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun LinkButton(text: String, onClick: () -> Unit) {
    TextButton(onClick = onClick) {
        Icon(Icons.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
        Spacer(Modifier.size(8.dp))
        Text(text)
    }
}

@Composable
private fun UsageRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(text = value, style = MaterialTheme.typography.bodySmall)
    }
}
