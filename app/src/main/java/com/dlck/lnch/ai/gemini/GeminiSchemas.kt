package com.dlck.lnch.ai.gemini

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Structured-output schema forcing the model to answer with exactly the launcher's intent
 * contract. Combined with server-side validation in `IntentValidator`, this is what keeps the
 * model inside the whitelist.
 */
object GeminiSchemas {

    private val intentNames = listOf(
        "OPEN_APP",
        "SEARCH_APP",
        "OPEN_SETTINGS",
        "SHOW_APPS",
        "CREATE_TIMER",
        "SEARCH_WEB",
        "GENERAL_CHAT",
    )

    private val settingsIds = listOf(
        "wifi", "bluetooth", "display", "sound", "battery", "apps", "location",
        "storage", "security", "network", "date", "language", "accessibility",
        "home", "notifications", "main",
    )

    private val categories = listOf(
        "GAME", "SOCIAL", "PRODUCTIVITY", "MEDIA", "NEWS", "MAPS", "SYSTEM", "OTHER",
    )

    val intentSchema: JsonElement = buildJsonObject {
        put("type", "OBJECT")
        putJsonObject("properties") {
            putJsonObject("intent") {
                put("type", "STRING")
                putJsonArray("enum") { intentNames.forEach { add(it) } }
            }
            putJsonObject("app") {
                put("type", "STRING")
                put("description", "Name of the app to open, as the user said it.")
            }
            putJsonObject("query") {
                put("type", "STRING")
                put("description", "Free-text query for SEARCH_APP / SEARCH_WEB, or timer label.")
            }
            putJsonObject("settings") {
                put("type", "STRING")
                putJsonArray("enum") { settingsIds.forEach { add(it) } }
            }
            putJsonObject("category") {
                put("type", "STRING")
                putJsonArray("enum") { categories.forEach { add(it) } }
            }
            putJsonObject("seconds") {
                put("type", "INTEGER")
                put("description", "Timer length in seconds (1..86400).")
            }
            putJsonObject("recent") {
                put("type", "BOOLEAN")
                put("description", "True when the user asks for recently used apps.")
            }
            putJsonObject("reply") {
                put("type", "STRING")
                put(
                    "description",
                    "Short natural-language answer in the SAME language the user wrote in.",
                )
            }
        }
        putJsonArray("required") {
            add("intent")
            add("reply")
        }
    }

    val intentConfig = GenerationConfig(
        temperature = 0.1f,
        maxOutputTokens = 512,
        responseMimeType = "application/json",
        responseSchema = intentSchema,
    )

    val chatConfig = GenerationConfig(
        temperature = 0.7f,
        topP = 0.95f,
        maxOutputTokens = 1024,
    )
}
