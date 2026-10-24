package dev.luncher.companion

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Net-Melli (national intranet) detection.
 *
 * THE PROBLEM THIS SOLVES
 *   When Iran switches to the national intranet it cuts the *international*
 *   links while leaving domestic ones up. Every Cloudflare-based tunnel dies at
 *   that moment, because the Cloudflare edge is not reachable — and a user
 *   staring at a dead tunnel cannot tell a broken config from a cut country.
 *   That distinction is the whole point of this probe.
 *
 * HOW IT WORKS
 *   Probe domestic and international endpoints in parallel. Domestic reachable
 *   plus international unreachable is the signature of Net Melli. No Cloudflare
 *   Worker can make this determination, because the Worker is outside the
 *   country and sees only its own view of the internet — the measurement has to
 *   happen on the device that is actually behind the filter.
 *
 * HONEST LIMITS
 *   This is a heuristic. A captive portal answering for blocked domains can look
 *   like "domestic reachable", and a slow link can look like "unreachable" if it
 *   exceeds the timeout. The UI reports the per-endpoint timings so a user can
 *   see the evidence rather than just a verdict.
 */
object NetProbe {

    data class Result(val label: String, val url: String, val reachable: Boolean, val ms: Long, val status: Int)

    data class Diagnosis(
        val state: State,
        val domestic: List<Result>,
        val international: List<Result>,
    )

    enum class State { NORMAL, NET_MELLI, OFFLINE, PARTIAL }

    // Domestic: Iranian services that only resolve/route from inside the country.
    private val DOMESTIC = listOf(
        "Aparat" to "https://www.aparat.com/",
        "Digikala" to "https://www.digikala.com/",
        "Snapp" to "https://snapp.ir/",
    )

    // International: tiny, cacheable, no-body endpoints that never rate-limit.
    // Cloudflare's own is included first, since it is the one that matters for
    // this panel: if cp.cloudflare.com answers, a Workers tunnel can work.
    private val INTERNATIONAL = listOf(
        "Cloudflare" to "https://cp.cloudflare.com/generate_204",
        "Google" to "https://www.gstatic.com/generate_204",
    )

    private const val CONNECT_TIMEOUT_MS = 5000
    private const val READ_TIMEOUT_MS = 5000

    private suspend fun probe(label: String, url: String): Result = withContext(Dispatchers.IO) {
        val started = System.currentTimeMillis()
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", "LuncherCompanion/1.0 (net-melli-probe)")
                // doInput must stay true: getResponseCode() reads from the input
                // stream, and with doInput=false it throws, which would report
                // every reachable host as unreachable — inverting the verdict.
                // We simply never consume the body.
            }
            conn.connect()
            val code = conn.responseCode
            Result(label, url, true, System.currentTimeMillis() - started, code)
        } catch (e: Exception) {
            Result(label, url, false, System.currentTimeMillis() - started, 0)
        } finally {
            try { conn?.disconnect() } catch (e: Exception) { /* ignore */ }
        }
    }

    /** Runs both probe sets concurrently so the check costs one timeout, not two. */
    suspend fun diagnose(): Diagnosis = coroutineScope {
        val dom = DOMESTIC.map { (label, url) -> async { probe(label, url) } }
        val intl = INTERNATIONAL.map { (label, url) -> async { probe(label, url) } }
        val domestic = dom.map { it.await() }
        val international = intl.map { it.await() }

        val anyDomestic = domestic.any { it.reachable }
        val anyInternational = international.any { it.reachable }
        val state = when {
            anyDomestic && anyInternational -> State.NORMAL
            anyDomestic && !anyInternational -> State.NET_MELLI
            !anyDomestic && anyInternational -> State.PARTIAL
            else -> State.OFFLINE
        }
        Diagnosis(state, domestic, international)
    }
}
