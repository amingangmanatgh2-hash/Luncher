package dev.luncher.companion

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import dev.luncher.companion.databinding.ActivityGameBinding

/**
 * NEON RUSH.
 *
 * The game itself is a self-contained WebGL application bundled in
 * `assets/game`. Keeping the game code in HTML/CSS/JavaScript means the
 * exact same build can be played in a desktop/mobile browser during
 * development and inside this APK without maintaining two renderers.
 *
 * This Activity deliberately exposes no JavaScript bridge and only allows
 * navigation below `file:///android_asset/`: the game is fully offline,
 * has no need to call into Android APIs, and should never become a generic
 * in-app browser by accident.
 */
class GameActivity : AppCompatActivity() {

    private lateinit var binding: ActivityGameBinding

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityGameBinding.inflate(layoutInflater)
        setContentView(binding.root)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()

        binding.gameWebView.apply {
            setBackgroundColor(Color.BLACK)
            isHorizontalScrollBarEnabled = false
            isVerticalScrollBarEnabled = false
            overScrollMode = android.view.View.OVER_SCROLL_NEVER

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                allowContentAccess = false
                cacheMode = WebSettings.LOAD_DEFAULT
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                useWideViewPort = true
                loadWithOverviewMode = true
            }

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?,
                ): Boolean {
                    val url = request?.url?.toString().orEmpty()
                    return !url.startsWith(GAME_ASSET_ROOT)
                }
            }
            webChromeClient = WebChromeClient()
            loadUrl(GAME_URL)
        }
    }

    override fun onResume() {
        super.onResume()
        binding.gameWebView.onResume()
        hideSystemBars()
    }

    override fun onPause() {
        binding.gameWebView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        binding.gameWebView.apply {
            stopLoading()
            loadUrl("about:blank")
            clearHistory()
            (parent as? ViewGroup)?.removeView(this)
            destroy()
        }
        super.onDestroy()
    }

    @Deprecated("Use the system back gesture to leave the game")
    override fun onBackPressed() {
        finish()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, binding.root).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private companion object {
        const val GAME_ASSET_ROOT = "file:///android_asset/"
        const val GAME_URL = "file:///android_asset/game/index.html"
    }
}
