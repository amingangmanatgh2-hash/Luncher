package com.dlck.lnch.ai.gemini

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class GeminiContent(
    val role: String? = null,
    val parts: List<GeminiPart> = emptyList(),
)

@Serializable
data class GeminiPart(
    val text: String = "",
)

@Serializable
data class ThinkingConfig(
    val thinkingBudget: Int,
)

@Serializable
data class GenerationConfig(
    val temperature: Float? = null,
    val topP: Float? = null,
    val maxOutputTokens: Int? = null,
    val responseMimeType: String? = null,
    val responseSchema: JsonElement? = null,
)

@Serializable
data class SafetySetting(
    val category: String,
    val threshold: String,
)

@Serializable
data class GenerateContentRequest(
    val contents: List<GeminiContent>,
    @SerialName("system_instruction")
    val systemInstruction: GeminiContent? = null,
    val generationConfig: GenerationConfig? = null,
    val safetySettings: List<SafetySetting>? = null,
)

@Serializable
data class Candidate(
    val content: GeminiContent? = null,
    val finishReason: String? = null,
)

@Serializable
data class PromptFeedback(
    val blockReason: String? = null,
)

@Serializable
data class UsageMetadata(
    val promptTokenCount: Int = 0,
    val candidatesTokenCount: Int = 0,
    val totalTokenCount: Int = 0,
)

@Serializable
data class GenerateContentResponse(
    val candidates: List<Candidate> = emptyList(),
    val promptFeedback: PromptFeedback? = null,
    val usageMetadata: UsageMetadata? = null,
) {
    val text: String
        get() = candidates.firstOrNull()
            ?.content
            ?.parts
            ?.joinToString(separator = "") { it.text }
            .orEmpty()
}

@Serializable
data class ApiErrorBody(
    val code: Int = 0,
    val message: String = "",
    val status: String = "",
)

@Serializable
data class ApiErrorEnvelope(
    val error: ApiErrorBody? = null,
)

@Serializable
data class ModelInfo(
    val name: String = "",
    val displayName: String = "",
    val supportedGenerationMethods: List<String> = emptyList(),
) {
    /** "models/gemini-2.5-flash" -> "gemini-2.5-flash" */
    val shortName: String get() = name.substringAfter("models/")
}

@Serializable
data class ModelsResponse(
    val models: List<ModelInfo> = emptyList(),
)
