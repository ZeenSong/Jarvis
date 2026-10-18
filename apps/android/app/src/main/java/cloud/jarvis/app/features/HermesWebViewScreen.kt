package cloud.jarvis.app.features

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import cloud.jarvis.app.GatewayClient
import cloud.jarvis.app.designsystem.*

/**
 * In-app Hermes console. The Web dashboard authenticates with the same
 * `jarvis_access` cookie as the Web client; injecting the bearer session into
 * WebView's cookie jar keeps the experience single-sign-on without exposing a
 * second login prompt. The dashboard may navigate within the configured host;
 * external links leave the app.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun HermesWebViewScreen(gateway: GatewayClient, back: () -> Unit) {
    val palette = jarvisColors()
    val context = LocalContext.current
    val session = remember { gateway.webSessionCookie() }
    var progress by remember { mutableIntStateOf(0) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    val base = session?.first
    val url = base?.trimEnd('/') + "/hermes-dashboard/"

    BackHandler {
        val view = webView
        if (view?.canGoBack() == true) view.goBack() else back()
    }

    Column(Modifier.fillMaxSize().background(palette.background)) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Surface(onClick = back, shape = CircleShape, color = palette.surface2, modifier = Modifier.size(34.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Back, "返回", Modifier.size(16.dp), tint = palette.muted) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text("Hermes 控制台", style = MaterialTheme.typography.titleMedium, color = palette.textStrong)
                Text("模型、技能与 MCP", style = MaterialTheme.typography.labelSmall, color = palette.muted)
            }
            Surface(
                onClick = { webView?.reload() },
                shape = CircleShape,
                color = palette.surface2,
                modifier = Modifier.size(34.dp),
            ) { Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Refresh, "刷新", Modifier.size(16.dp), tint = palette.muted) } }
        }
        if (progress in 1..99) {
            LinearProgressIndicator(
                progress = { progress / 100f },
                modifier = Modifier.fillMaxWidth().height(2.dp),
                color = palette.accent,
                trackColor = palette.line,
            )
        }
        if (session == null || base == null) {
            EmptyState("尚未连接 Hermes", "登录 Jarvis 后即可打开 Hermes 控制台。")
            return@Column
        }
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { viewContext ->
                WebView(viewContext).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.databaseEnabled = true
                    settings.loadsImagesAutomatically = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.mediaPlaybackRequiresUserGesture = true
                    webChromeClient = object : WebChromeClient() {
                        override fun onProgressChanged(view: WebView?, newProgress: Int) { progress = newProgress }
                    }
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView?, request: android.webkit.WebResourceRequest?): Boolean {
                            val target = request?.url ?: return false
                            if (target.host == Uri.parse(base).host) return false
                            runCatching {
                                context.startActivity(Intent(Intent.ACTION_VIEW, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            }
                            return true
                        }
                    }
                    CookieManager.getInstance().setAcceptCookie(true)
                    CookieManager.getInstance().setCookie(base, session.second)
                    CookieManager.getInstance().flush()
                    loadUrl(url)
                    webView = this
                }
            },
            update = { view ->
                if (view.url == null) {
                    CookieManager.getInstance().setCookie(base, session.second)
                    CookieManager.getInstance().flush()
                    view.loadUrl(url)
                }
            },
        )
    }
}
