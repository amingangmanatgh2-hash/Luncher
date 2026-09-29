package com.dlck.lnch.ai.gemini

import android.content.Context
import com.dlck.lnch.R

/** Classified Gemini failures. Deliberately coarse so the UI can always show a useful message. */
enum class GeminiErrorKind {
    NO_KEY,
    INVALID_KEY,
    PERMISSION,
    QUOTA,
    MODEL,
    SERVER,
    NETWORK,
    TIMEOUT,
    SAFETY,
    PARSE,
    UNKNOWN,
}

/**
 * Exception carrying a classified [kind].
 *
 * [detail] is safe to display: it only ever contains the server-supplied message, and the API key
 * is transmitted in a header (never in a URL) so it cannot leak into an error string.
 */
class GeminiException(
    val kind: GeminiErrorKind,
    val httpCode: Int = 0,
    val detail: String = "",
) : Exception("Gemini error: $kind (http=$httpCode)") {

    fun localizedMessage(context: Context): String = when (kind) {
        GeminiErrorKind.NO_KEY -> context.getString(R.string.err_no_key)
        GeminiErrorKind.INVALID_KEY -> context.getString(R.string.err_invalid_key)
        GeminiErrorKind.PERMISSION -> context.getString(R.string.err_permission)
        GeminiErrorKind.QUOTA -> context.getString(R.string.err_quota)
        GeminiErrorKind.MODEL -> context.getString(R.string.err_model)
        GeminiErrorKind.SERVER -> context.getString(R.string.err_server, httpCode)
        GeminiErrorKind.NETWORK -> context.getString(R.string.err_network)
        GeminiErrorKind.TIMEOUT -> context.getString(R.string.err_timeout)
        GeminiErrorKind.SAFETY -> context.getString(R.string.err_safety)
        GeminiErrorKind.PARSE -> context.getString(R.string.err_parse)
        GeminiErrorKind.UNKNOWN -> context.getString(
            R.string.err_unknown,
            detail.ifBlank { "unknown" },
        )
    }

    /** True when retrying the very same request has a realistic chance of succeeding. */
    val isRetryable: Boolean
        get() = kind == GeminiErrorKind.NETWORK ||
            kind == GeminiErrorKind.TIMEOUT ||
            kind == GeminiErrorKind.SERVER ||
            kind == GeminiErrorKind.QUOTA
}
