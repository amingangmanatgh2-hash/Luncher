package dev.luncher.companion

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import dev.luncher.companion.databinding.ActivityMainBinding
import dev.luncher.companion.databinding.DialogLinkBinding
import dev.luncher.companion.databinding.DialogSubBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Luncher Companion.
 *
 * WHAT THIS APP IS
 *   A config manager and network diagnostician. It stores share links and
 *   subscriptions, hands links to whichever tunnel client the user actually has
 *   installed, and answers the one question a user in Iran cannot otherwise
 *   answer: is my config broken, or is the country cut off?
 *
 * WHAT THIS APP IS NOT
 *   A proxy. It has no VpnService and tunnels nothing. Building a VPN client
 *   means shipping Xray core native libraries per ABI and a TUN stack, and an
 *   app that silently fails to route traffic is worse than one that honestly
 *   delegates to PattNG, v2rayNG or Hiddify — which are maintained, audited and
 *   already on the user's phone. See docs/android.md.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: ConfigAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = ConfigAdapter(
            onOpen = { openInClient(it.link) },
            onCopyLink = { copy(it) },
            onDelete = { confirmDelete(it) },
            onRefreshSub = { refreshSubscription(it) },
            onDeleteSub = { confirmDeleteSub(it) },
        )
        binding.list.layoutManager = LinearLayoutManager(this)
        binding.list.adapter = adapter

        binding.fab.setOnClickListener { showAddLinkDialog(null) }
        binding.gameFab.setOnClickListener { openGame() }

        binding.toolbar.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                R.id.action_net_check -> { runNetCheck(); true }
                R.id.action_add_link -> { showAddLinkDialog(null); true }
                R.id.action_add_sub -> { showAddSubDialog(); true }
                R.id.action_game -> { openGame(); true }
                R.id.action_about -> { showAbout(); true }
                else -> false
            }
        }

        handleIncomingIntent(intent)
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
        render()
    }

    /* ------------------------------------------------------------- intent */

    /**
     * Accept a config two ways: shared text from any app, or a `luncher://`
     * deep link from the web panel. The deep link carries the config in a query
     * parameter rather than as the opaque part, so the panel can build it with
     * plain string concatenation and still survive percent-encoding.
     */
    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return
        when (intent.action) {
            Intent.ACTION_SEND -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
                val links = ConfigStore.extractLinks(text)
                if (links.isEmpty()) {
                    showAddLinkDialog(text)
                } else {
                    val n = ConfigStore.addLinks(this, links, null, null)
                    if (n > 0) toast(getString(R.string.added_many, n))
                }
            }
            Intent.ACTION_VIEW -> {
                val data = intent.data ?: return
                val payload = data.getQueryParameter("config")
                    ?: data.getQueryParameter("sub")
                    ?: data.schemeSpecificPart
                if (payload.startsWith("http")) {
                    ConfigStore.addSubscription(this, Uri.parse(payload).host ?: payload, payload)
                    toast(getString(R.string.sub_added))
                } else {
                    val links = ConfigStore.extractLinks(payload)
                    if (links.isNotEmpty()) {
                        val n = ConfigStore.addLinks(this, links, null, null)
                        if (n > 0) toast(getString(R.string.added_many, n))
                    } else {
                        showAddLinkDialog(payload)
                    }
                }
            }
        }
    }

    /* -------------------------------------------------------------- render */

    private fun render() {
        val configs = ConfigStore.configs(this)
        val subs = ConfigStore.subscriptions(this)
        adapter.submit(configs, subs, getString(R.string.section_local), getString(R.string.section_subs))
        binding.emptyState.visibility = if (configs.isEmpty() && subs.isEmpty()) View.VISIBLE else View.GONE
        binding.list.visibility = if (configs.isEmpty() && subs.isEmpty()) View.GONE else View.VISIBLE
    }

    /* --------------------------------------------------------------- dialogs */

    private fun showAddLinkDialog(prefill: String?) {
        val d = DialogLinkBinding.inflate(layoutInflater)
        prefill?.let { d.linkText.setText(it) }
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.paste_link)
            .setView(d.root)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.save) { _, _ ->
                val text = d.linkText.text?.toString().orEmpty()
                val name = d.linkName.text?.toString()?.trim().orEmpty()
                val links = ConfigStore.extractLinks(text)
                if (links.isEmpty()) {
                    toast(getString(R.string.invalid_link))
                    return@setPositiveButton
                }
                val n = ConfigStore.addLinks(this, links, null, name.ifBlank { null })
                toast(if (n > 1) getString(R.string.added_many, n) else getString(R.string.added))
                render()
            }
            .show()
    }

    private fun showAddSubDialog() {
        val d = DialogSubBinding.inflate(layoutInflater)
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.subscription_url)
            .setView(d.root)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.save) { _, _ ->
                val url = d.subUrlInput.text?.toString()?.trim().orEmpty()
                val name = d.subNameInput.text?.toString()?.trim().orEmpty()
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    toast(getString(R.string.invalid_link))
                    return@setPositiveButton
                }
                val sub = ConfigStore.addSubscription(this, name, url)
                toast(getString(R.string.sub_added))
                render()
                refreshSubscription(sub)
            }
            .show()
    }

    private fun showAbout() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.about)
            .setMessage(R.string.about_body)
            .setPositiveButton(R.string.cancel, null)
            .show()
    }

    private fun confirmDelete(config: Config) {
        MaterialAlertDialogBuilder(this)
            .setTitle(config.name)
            .setMessage(config.link)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.delete) { _, _ ->
                ConfigStore.delete(this, config.id)
                toast(getString(R.string.deleted))
                render()
            }
            .show()
    }

    private fun confirmDeleteSub(sub: Subscription) {
        MaterialAlertDialogBuilder(this)
            .setTitle(sub.name)
            .setMessage(sub.url)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.delete) { _, _ ->
                ConfigStore.deleteSubscription(this, sub.id)
                toast(getString(R.string.deleted))
                render()
            }
            .show()
    }

    /* ---------------------------------------------------------- subscription */

    private fun refreshSubscription(sub: Subscription) {
        binding.progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            val outcome = withContext(Dispatchers.IO) { fetchSubscription(sub.url) }
            binding.progress.visibility = View.GONE
            // No `return@...` label here. Kotlin labels a lambda by the name of
            // the function it is passed to (`fold`), not by the parameter name
            // (`onSuccess`), so an early return is easy to get wrong — and getting
            // it wrong is a compile error, not a warning. Plain if/else says the
            // same thing without the ambiguity.
            outcome.fold(
                onSuccess = { body ->
                    val links = ConfigStore.extractLinks(body)
                    if (links.isEmpty()) {
                        toast(getString(R.string.sub_failed, "no links in response"))
                    } else {
                        // Re-key the subscription so its configs are replaced
                        // rather than accumulating stale entries on every refresh.
                        ConfigStore.deleteSubscription(this@MainActivity, sub.id)
                        val kept = ConfigStore.addSubscription(this@MainActivity, sub.name, sub.url)
                        val n = ConfigStore.addLinks(this@MainActivity, links, kept.id, sub.name)
                        ConfigStore.touchSubscription(this@MainActivity, kept.id)
                        toast(getString(R.string.added_many, n))
                        render()
                    }
                },
                onFailure = { e ->
                    toast(getString(R.string.sub_failed, e.message ?: e.javaClass.simpleName))
                },
            )
        }
    }

    /** Fetches a subscription body. Accepts plain links or base64; both are
     *  decoded later by ConfigStore.extractLinks. */
    private fun fetchSubscription(url: String): Result<String> = try {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 12000
            readTimeout = 15000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "LuncherCompanion/1.0 (subscription)")
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) {
                Result.failure(Exception("HTTP $code"))
            } else {
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                Result.success(text)
            }
        } finally {
            conn.disconnect()
        }
    } catch (e: Exception) {
        Result.failure(e)
    }

    /* ------------------------------------------------------------- actions */

    /**
     * Hand a link to whichever tunnel client is installed.
     *
     * Android resolves the scheme against the apps that registered it (PattNG,
     * v2rayNG, Hiddify, NekoBox all claim vless:// and trojan://). We do not
     * target a package name: hardcoding one would break the moment the user
     * picks a different client, and querying installed packages needs a
     * permission we would rather not ask for.
     */
    private fun openInClient(link: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)))
        } catch (e: ActivityNotFoundException) {
            toast(getString(R.string.no_client))
        } catch (e: Exception) {
            toast(getString(R.string.no_client))
        }
    }

    /** Open the bundled, fully offline NEON RUSH game. */
    private fun openGame() {
        startActivity(Intent(this, GameActivity::class.java))
    }

    private fun copy(text: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("Luncher config", text))
        toast(getString(R.string.copied))
    }

    /* ----------------------------------------------------------- net check */

    private fun runNetCheck() {
        binding.progress.visibility = View.VISIBLE
        toast(getString(R.string.net_check_running))
        lifecycleScope.launch {
            val d = NetProbe.diagnose()
            binding.progress.visibility = View.GONE

            val title = when (d.state) {
                NetProbe.State.NET_MELLI -> getString(R.string.net_isolated_title)
                NetProbe.State.NORMAL -> getString(R.string.net_normal_title)
                NetProbe.State.PARTIAL -> getString(R.string.net_partial_title)
                NetProbe.State.OFFLINE -> getString(R.string.net_offline_title)
            }
            val body = when (d.state) {
                NetProbe.State.NET_MELLI -> getString(R.string.net_isolated_body)
                NetProbe.State.NORMAL -> getString(R.string.net_normal_body)
                NetProbe.State.PARTIAL -> getString(R.string.net_partial_body)
                NetProbe.State.OFFLINE -> getString(R.string.net_offline_body)
            }
            // Show the per-endpoint evidence, not just the verdict: a heuristic
            // the user cannot inspect is a heuristic the user cannot distrust.
            val evidence = buildString {
                appendLine(getString(R.string.net_detail_domestic))
                for (r in d.domestic) appendLine(formatResult(r))
                appendLine()
                appendLine(getString(R.string.net_detail_international))
                for (r in d.international) appendLine(formatResult(r))
            }
            MaterialAlertDialogBuilder(this@MainActivity)
                .setTitle(title)
                .setMessage(body + "\n\n" + evidence)
                .setPositiveButton(R.string.cancel, null)
                .show()
        }
    }

    private fun formatResult(r: NetProbe.Result): String {
        val state = if (r.reachable) getString(R.string.reachable) else getString(R.string.unreachable)
        val timing = if (r.reachable) getString(R.string.ms, r.ms.toInt()) else ""
        return "  " + r.label + " — " + state + (if (timing.isEmpty()) "" else " ($timing)")
    }

    private fun toast(message: String) {
        Snackbar.make(binding.root, message, Snackbar.LENGTH_SHORT).show()
    }
}
