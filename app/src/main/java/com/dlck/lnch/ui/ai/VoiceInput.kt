package com.dlck.lnch.ui.ai

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import java.util.Locale

/**
 * Speech-to-text handle backed by the *system* recogniser.
 *
 * Security note: this deliberately uses [RecognizerIntent.ACTION_RECOGNIZE_SPEECH], which hands the
 * job to whatever recogniser the user already trusts (Google, Samsung, …). DLCK LNCH therefore
 * needs **no `RECORD_AUDIO` permission**, never touches the microphone itself, and never records or
 * uploads audio. Only the final transcript comes back, and it lands in the text field so the user
 * can edit it before sending.
 *
 * [available] is false when no recogniser is installed; the caller hides the button in that case.
 */
@Immutable
class VoiceInput internal constructor(
    val available: Boolean,
    private val start: () -> Unit,
) {
    fun launch() {
        if (available) start()
    }
}

@Composable
fun rememberVoiceInput(onResult: (String) -> Unit): VoiceInput {
    val context = LocalContext.current

    val intent = remember {
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
    }

    val available = remember(intent) {
        runCatching {
            context.packageManager.queryIntentActivities(intent, 0).isNotEmpty()
        }.getOrDefault(false)
    }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val spoken = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.trim()
            if (!spoken.isNullOrBlank()) onResult(spoken)
        }
    }

    return remember(available, launcher, intent) {
        VoiceInput(available) {
            runCatching { launcher.launch(intent) }
        }
    }
}
