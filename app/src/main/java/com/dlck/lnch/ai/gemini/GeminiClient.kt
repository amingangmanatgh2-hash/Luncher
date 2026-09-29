package com.dlck.lnch.ai.gemini

import com.dlck.lnch.data.secure.CredentialStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Thin, dependency-light Gemini REST client.
 *
 * Security notes:
 *  * the credential is read from [CredentialStore] at call time and sent in the
 *    `x-goog-api-key` header — never in the URL, so it can never end up in a log, a crash
 *    report or an error string;
 *  * no request or response body is ever logged;
 *  * HTTPS only (cleartext is impossible because the base URL is validated below).
 */
class GeminiClient(
    private val credentials: CredentialStore,
) {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
    }

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(120, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private fun baseUrl(): String {
        val raw = credentials.baseUrl.trimEnd('/')
        return if (raw.startsWith("https://")) raw else CredentialStore.DEFAULT_BASE_URL
    }

    private fun newRequest(url: String): Request.Builder {
        val builder = Request.Builder()
            .url(url)
            .header("Content-Type", "application/json")
            .header("User-Agent", "DLCK-LNCH/1.0 (Android)")
        val key = credentials.readKey()
        if (!key.isNullOrBlank()) builder.header("x-goog-api-key", key)
        return builder
    }

    private fun requireCredential() {
        // A custom endpoint (a proxy) is allowed to hold the credential server-side, in which case
        // the device legitimately has no key at all.
        if (!credentials.hasKey() && !credentials.usesCustomEndpoint) {
            throw GeminiException(GeminiErrorKind.NO_KEY)
        }
    }

    // ------------------------------------------------------------------ test

    data class ConnectionResult(
        val ok: Boolean,
        val availableModels: List<String>,
        val error: GeminiException? = null,
    )

    /**
     * Validates the credential with the cheapest possible authenticated call (`GET /v1beta/models`).
     * Returns the list of usable model names on success.
     */
    suspend fun testConnection(): ConnectionResult = withContext(Dispatchers.IO) {
        try {
            requireCredential()
            val request = newRequest("${baseUrl()}/v1beta/models").get().build()
            val body = execute(request)
            val parsed = runCatching { json.decodeFromString<ModelsResponse>(body) }
                .getOrElse { throw GeminiException(GeminiErrorKind.PARSE) }
            val usable = parsed.models
                .filter { it.supportedGenerationMethods.contains("generateContent") }
                .map { it.shortName }
                .filter { it.startsWith("gemini") }
                .sorted()
            credentials.lastSuccessfulCheck = System.currentTimeMillis()
            ConnectionResult(ok = true, availableModels = usable)
        } catch (e: GeminiException) {
            ConnectionResult(ok = false, availableModels = emptyList(), error = e)
        } catch (e: Throwable) {
            ConnectionResult(
                ok = false,
                availableModels = emptyList(),
                error = e.toGeminiException(),
            )
        }
    }

    // -------------------------------------------------------------- generate

    /** One-shot generation. Used for intent classification (JSON mode) and non-streaming replies. */
    suspend fun generate(
        model: String,
        contents: List<GeminiContent>,
        systemInstruction: String? = null,
        config: GenerationConfig? = null,
    ): GenerateContentResponse = withContext(Dispatchers.IO) {
        requireCredential()
        val payload = GenerateContentRequest(
            contents = contents,
            systemInstruction = systemInstruction?.let {
                GeminiContent(parts = listOf(GeminiPart(it)))
            },
            generationConfig = config,
            safetySettings = defaultSafetySettings,
        )
        val request = newRequest("${baseUrl()}/v1beta/models/$model:generateContent")
            .post(json.encodeToString(GenerateContentRequest.serializer(), payload).toRequestBody(jsonMedia))
            .build()

        val raw = execute(request)
        val parsed = runCatching { json.decodeFromString<GenerateContentResponse>(raw) }
            .getOrElse { throw GeminiException(GeminiErrorKind.PARSE) }

        parsed.promptFeedback?.blockReason?.let {
            throw GeminiException(GeminiErrorKind.SAFETY, detail = it)
        }
        val finish = parsed.candidates.firstOrNull()?.finishReason
        if (finish == "SAFETY" || finish == "PROHIBITED_CONTENT" || finish == "BLOCKLIST") {
            throw GeminiException(GeminiErrorKind.SAFETY, detail = finish)
        }
        parsed
    }

    // ---------------------------------------------------------------- stream

    sealed interface StreamEvent {
        data class Chunk(val text: String) : StreamEvent
        data class Done(val usage: UsageMetadata?) : StreamEvent
    }

    /**
     * Server-sent-events streaming. Emits text deltas as they arrive so the chat can render a live
     * response with a typing indicator.
     */
    fun streamGenerate(
        model: String,
        contents: List<GeminiContent>,
        systemInstruction: String? = null,
        config: GenerationConfig? = null,
    ): Flow<StreamEvent> = flow {
        requireCredential()
        val payload = GenerateContentRequest(
            contents = contents,
            systemInstruction = systemInstruction?.let {
                GeminiContent(parts = listOf(GeminiPart(it)))
            },
            generationConfig = config,
            safetySettings = defaultSafetySettings,
        )
        val request =
            newRequest("${baseUrl()}/v1beta/models/$model:streamGenerateContent?alt=sse")
                .post(
                    json.encodeToString(GenerateContentRequest.serializer(), payload)
                        .toRequestBody(jsonMedia),
                )
                .header("Accept", "text/event-stream")
                .build()

        val response = try {
            client.newCall(request).await()
        } catch (t: Throwable) {
            throw t.toGeminiException()
        }

        response.use { resp ->
            if (!resp.isSuccessful) {
                val errorBody = runCatching { resp.body?.string().orEmpty() }.getOrDefault("")
                throw mapHttpError(resp.code, errorBody)
            }
            val source = resp.body?.source() ?: throw GeminiException(GeminiErrorKind.PARSE)
            var usage: UsageMetadata? = null
            var emittedAnything = false

            while (true) {
                currentCoroutineContext().ensureActive()
                val line = try {
                    source.readUtf8Line()
                } catch (e: SocketTimeoutException) {
                    throw GeminiException(GeminiErrorKind.TIMEOUT)
                } catch (e: IOException) {
                    throw GeminiException(GeminiErrorKind.NETWORK)
                } ?: break

                if (line.isBlank() || !line.startsWith("data:")) continue
                val data = line.removePrefix("data:").trim()
                if (data == "[DONE]") break

                val chunk = runCatching {
                    json.decodeFromString<GenerateContentResponse>(data)
                }.getOrNull() ?: continue

                chunk.promptFeedback?.blockReason?.let {
                    throw GeminiException(GeminiErrorKind.SAFETY, detail = it)
                }
                chunk.usageMetadata?.let { usage = it }
                val text = chunk.text
                if (text.isNotEmpty()) {
                    emittedAnything = true
                    emit(StreamEvent.Chunk(text))
                }
                val finish = chunk.candidates.firstOrNull()?.finishReason
                if (finish == "SAFETY" || finish == "PROHIBITED_CONTENT") {
                    throw GeminiException(GeminiErrorKind.SAFETY, detail = finish)
                }
            }

            if (!emittedAnything) throw GeminiException(GeminiErrorKind.PARSE)
            emit(StreamEvent.Done(usage))
        }
    }.flowOn(Dispatchers.IO)

    // ----------------------------------------------------------------- plumbing

    private fun execute(request: Request): String {
        val response = try {
            client.newCall(request).execute()
        } catch (t: Throwable) {
            throw t.toGeminiException()
        }
        response.use { resp ->
            val body = runCatching { resp.body?.string().orEmpty() }.getOrDefault("")
            if (!resp.isSuccessful) throw mapHttpError(resp.code, body)
            return body
        }
    }

    private fun mapHttpError(code: Int, body: String): GeminiException {
        val parsed = runCatching { json.decodeFromString<ApiErrorEnvelope>(body).error }.getOrNull()
        val message = parsed?.message.orEmpty()
        val status = parsed?.status.orEmpty()

        val kind = when {
            code == 400 && (message.contains("API key not valid", true) ||
                message.contains("API_KEY_INVALID", true) ||
                status == "INVALID_ARGUMENT" && message.contains("api key", true)) ->
                GeminiErrorKind.INVALID_KEY

            code == 401 -> GeminiErrorKind.INVALID_KEY
            code == 403 && message.contains("API key", true) -> GeminiErrorKind.INVALID_KEY
            code == 403 -> GeminiErrorKind.PERMISSION
            code == 404 && message.contains("model", true) -> GeminiErrorKind.MODEL
            code == 429 -> GeminiErrorKind.QUOTA
            code in 500..599 -> GeminiErrorKind.SERVER
            code == 400 -> GeminiErrorKind.UNKNOWN
            else -> GeminiErrorKind.UNKNOWN
        }
        // `message` comes from Google and never echoes the key back.
        return GeminiException(kind, code, message.take(300))
    }

    private fun Throwable.toGeminiException(): GeminiException = when (this) {
        is GeminiException -> this
        is SocketTimeoutException -> GeminiException(GeminiErrorKind.TIMEOUT)
        is UnknownHostException -> GeminiException(GeminiErrorKind.NETWORK)
        is SSLException -> GeminiException(GeminiErrorKind.NETWORK)
        is IOException -> GeminiException(GeminiErrorKind.NETWORK)
        else -> GeminiException(
            GeminiErrorKind.UNKNOWN,
            detail = this::class.java.simpleName,
        )
    }

    private val defaultSafetySettings = listOf(
        SafetySetting("HARM_CATEGORY_HARASSMENT", "BLOCK_ONLY_HIGH"),
        SafetySetting("HARM_CATEGORY_HATE_SPEECH", "BLOCK_ONLY_HIGH"),
        SafetySetting("HARM_CATEGORY_SEXUALLY_EXPLICIT", "BLOCK_ONLY_HIGH"),
        SafetySetting("HARM_CATEGORY_DANGEROUS_CONTENT", "BLOCK_ONLY_HIGH"),
    )

    companion object {
        val FALLBACK_MODELS = listOf(
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
        )
    }
}

/** Suspending bridge for an OkHttp call. */
private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            cont.resume(response)
        }
    })
    cont.invokeOnCancellation { runCatching { cancel() } }
}
