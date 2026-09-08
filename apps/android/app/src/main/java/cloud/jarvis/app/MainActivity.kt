package cloud.jarvis.app

import android.os.Bundle
import android.os.Build
import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.*
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); setContent {
        MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFF82D8CC), background = Color(0xFF101719), surface = Color(0xFF1A2428))) {
            val vm: JarvisViewModel = viewModel(); JarvisApp(vm.repository)
        }
    } }
}
private fun JsonObject?.value(key: String): String = (this?.get(key) as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content ?: "—"
private fun JsonObject?.obj(key: String): JsonObject? = this?.get(key) as? JsonObject
private fun JsonObject?.number(key: String): Double? = (this?.get(key) as? JsonPrimitive)?.doubleOrNull
private fun amount(value: Double?): String = value?.let { when { it >= 1e9 -> "%.2fB".format(it / 1e9); it >= 1e6 -> "%.2fM".format(it / 1e6); it >= 1e3 -> "%.1fK".format(it / 1e3); else -> "%.0f".format(it) } } ?: "—"
private fun bytes(value: Double?): String = value?.let { "%.1f GiB".format(it / 1073741824) } ?: "—"
private fun percent(value: Double?): String = value?.let { "%.1f %%".format(it) } ?: "不可用"
private fun cost(value: Double?): String = value?.let { "$%.6f".format(Locale.US, it) } ?: "未配置价格"
private fun age(value: String): String = runCatching { "${(Instant.now().epochSecond - Instant.parse(value).epochSecond).coerceAtLeast(0)} 秒前" }.getOrDefault("—")

@Composable private fun JarvisApp(repo: JarvisRepository) {
    val paired by repo.paired.collectAsStateWithLifecycle(); val connection by repo.gateway.state.collectAsStateWithLifecycle()
    val error by repo.error.collectAsStateWithLifecycle(); val saved by repo.savedAt.collectAsStateWithLifecycle()
    var settings by remember { mutableStateOf(false) }
    if (!paired || settings || connection == ConnectionState.unauthorized) { PairScreen(error, paired, { server, code -> repo.pair(server, code); settings = false }, { settings = false }); return }
    val nav = rememberNavController(); val back by nav.currentBackStackEntryAsState(); val route = back?.destination?.route ?: "home"
    LaunchedEffect(route) { repo.selectPage(route) }
    Scaffold(topBar = { Column(Modifier.statusBarsPadding().padding(20.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("JARVIS", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); TextButton(onClick = { settings = true }) { Text(connection.name.uppercase()) } }
        if (connection != ConnectionState.online) Text("显示最近缓存 · ${saved?.let { Instant.ofEpochMilli(it) } ?: "尚无数据"}", style = MaterialTheme.typography.bodySmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    } }, bottomBar = { NavigationBar { listOf("home" to "Home", "server" to "Server", "agents" to "Agents", "ai" to "AI").forEach { (path, label) -> NavigationBarItem(selected = route == path, onClick = { nav.navigate(path) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true } }, icon = { Text(label.take(1)) }, label = { Text(label) }) } } }) { padding ->
        NavHost(nav, startDestination = "home", modifier = Modifier.padding(padding)) {
            composable("home") { HomeScreen(repo) }
            composable("server") { ServerScreen(repo) }
            composable("agents") { AgentsScreen(repo) { nav.navigate("agent/$it") } }
            composable("agent/{id}") { entry -> val id = entry.arguments?.getString("id")!!; DisposableEffect(id) { repo.selectAgent(id); onDispose { repo.selectAgent(null) } }; AgentScreen(repo) { nav.popBackStack() } }
            composable("ai") { UsageScreen(repo) }
        }
    }
}
@Composable private fun PairScreen(error: String?, canBack: Boolean, pair: (String, String) -> Unit, back: () -> Unit) {
    var server by remember { mutableStateOf("") }; var code by remember { mutableStateOf("") }
    Screen("连接你的私人云") {
        Text("手机与服务器加入同一个 Tailscale 网络，然后输入服务器地址和一次性配对码。")
        OutlinedTextField(server, { server = it }, label = { Text("http://100.x.x.x:8080") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(code, { code = it }, label = { Text("配对码") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = { pair(server, code) }, enabled = server.isNotBlank() && code.isNotBlank()) { Text("配对并连接") }
        if (canBack) TextButton(onClick = back) { Text("返回") }
    }
}
@Composable private fun Screen(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { Text(title, style = MaterialTheme.typography.headlineMedium); content(); Spacer(Modifier.height(12.dp)) }
}
@Composable private fun MetricCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { Text(title, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleMedium); content() } }
}
@Composable private fun Metric(label: String, value: String) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) { Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant); SelectionContainer(Modifier.weight(1.3f)) { Text(value) } } }
@Composable private fun HomeScreen(repo: JarvisRepository) {
    val s by repo.system.collectAsStateWithLifecycle(); val a by repo.agents.collectAsStateWithLifecycle(); val u by repo.today.collectAsStateWithLifecycle(); val latency by repo.gateway.latency.collectAsStateWithLifecycle()
    val background by repo.backgroundEnabled.collectAsStateWithLifecycle()
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { repo.setBackground(true) }
    Screen("私人云 · 现在") { MetricCard("Overview") {
        Metric("Server", s.obj("jarvis").value("server_status")); Metric("Agents Online", a.count { it.value("status") !in listOf("offline", "degraded") }.toString())
        val total = u.obj("total"); Metric("LLM Today", amount(total.number("input_tokens")?.plus(total.number("output_tokens") ?: 0.0)) + " tokens")
        Metric("Public IPv6", s.obj("network").value("public_ipv6")); Metric("Gateway Latency", latency?.let { "$it ms" } ?: "—")
        Metric("Server Uptime", s.obj("server").number("uptime_seconds")?.let { "%.1f 小时".format(it / 3600) } ?: "—")
    }; Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("保持后台连接（常驻通知）", Modifier.weight(1f)); Switch(checked = background, onCheckedChange = { enabled -> if (enabled && Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS) else repo.setBackground(enabled) }) }; TextButton(onClick = repo::refresh) { Text("刷新状态") } }
}
@Composable private fun ServerScreen(repo: JarvisRepository) {
    val s by repo.system.collectAsStateWithLifecycle()
    Screen("Server") {
        MetricCard(s.obj("server").value("hostname")) { Metric("OS", s.obj("server").value("os")); Metric("Kernel", s.obj("server").value("kernel")); Metric("Uptime", s.obj("server").value("uptime_seconds") + " s") }
        MetricCard("Network") { val n = s.obj("network"); listOf("public_ipv6", "public_ipv4", "tailscale_ipv4", "tailscale_ipv6", "lan_ipv4").forEach { Metric(it, n.value(it)) } }
        MetricCard("CPU") { val c = s.obj("cpu"); Text(c.value("model")); Metric("Utilization", percent(c.number("usage_percent"))); Metric("Load 1 / 5 / 15m", listOf("load_1m", "load_5m", "load_15m").joinToString(" / ") { c.value(it) }); Metric("Temperature", c.value("temperature_c") + " °C") }
        MetricCard("Memory") { val m = s.obj("memory"); Metric("Used / Total", bytes(m.number("used_bytes")) + " / " + bytes(m.number("total_bytes"))); Metric("Utilization", percent(m.number("usage_percent"))) }
        MetricCard("Storage") { (s?.get("disks") as? JsonArray)?.forEach { d -> val disk = d.jsonObject; Metric(disk.value("mount"), bytes(disk.number("used_bytes")) + " / " + bytes(disk.number("total_bytes"))); Metric("Utilization", percent(disk.number("usage_percent"))) } }
        MetricCard("GPU") { val g = s.obj("gpu"); if (g == null) Text("未检测到 GPU / 指标不可用") else { Text(g.value("model")); Metric("Utilization", percent(g.number("utilization_percent"))); Metric("VRAM", bytes(g.number("memory_used_bytes")) + " / " + bytes(g.number("memory_total_bytes"))); Metric("Temperature", g.value("temperature_c") + " °C") } }
        MetricCard("Jarvis Services") { Metric("Jarvis Server", s.obj("jarvis").value("server_status")); Metric("PostgreSQL", s.obj("jarvis").value("db_status")); Metric("Version", s.obj("jarvis").value("version")) }
    }
}
@Composable private fun AgentsScreen(repo: JarvisRepository, open: (String) -> Unit) {
    val agents by repo.agents.collectAsStateWithLifecycle()
    Screen("Agents") {
        Text("Online ${agents.count { it.value("status") !in listOf("offline", "degraded") }}   Running ${agents.count { it.value("status") == "running" }}   Idle ${agents.count { it.value("status") == "idle" }}   Error ${agents.count { it.value("status") == "error" }}")
        if (agents.isEmpty()) Text("暂无 Agent。注册后将自动出现在这里。")
        agents.forEach { a -> MetricCard(a.value("name")) { Metric("Status", a.value("status")); Metric("Task", a.value("current_task_id")); Metric("Runtime", a.value("runtime")); Metric("Provider / Model", a.value("provider") + " / " + a.value("model")); Metric("Last Seen", age(a.value("last_seen_at"))); TextButton(onClick = { open(a.value("id")) }, modifier = Modifier.testTag("agent-detail-${a.value("id")}")) { Text("查看详情 →") } } }
    }
}
@Composable private fun AgentScreen(repo: JarvisRepository, back: () -> Unit) {
    val a by repo.detail.collectAsStateWithLifecycle(); val events by repo.events.collectAsStateWithLifecycle(); val usage by repo.agentUsage.collectAsStateWithLifecycle()
    Screen(a.value("name")) {
        TextButton(onClick = back) { Text("← Agents") }
        MetricCard("Identity & Session") { listOf("id", "status", "current_task_id", "runtime", "version", "provider", "model", "session_start", "last_seen_at").forEach { Metric(it, a.value(it)) } }
        UsageCard("Today · UTC", usage.obj("total"))
        MetricCard("Recent Events") { if (events.isEmpty()) Text("暂无事件"); events.forEach { Text(it.value("event_type"), fontWeight = FontWeight.Medium); Text(it.value("created_at"), style = MaterialTheme.typography.bodySmall); Text(it["payload"].toString(), style = MaterialTheme.typography.bodySmall); HorizontalDivider() } }
    }
}
@Composable private fun UsageCard(title: String, total: JsonObject?) {
    MetricCard(title) { Metric("Input", amount(total.number("input_tokens"))); Metric("Output", amount(total.number("output_tokens"))); Metric("Cached Input", amount(total.number("cached_input_tokens"))); Metric("Reasoning", amount(total.number("reasoning_tokens"))); Metric("Requests / Errors", total.value("requests") + " / " + total.value("errors")); Metric("Estimated Cost", cost(total.number("estimated_cost_usd"))); if ((total.number("unpriced_requests") ?: 0.0) > 0) Text("${total.value("unpriced_requests")} 次请求没有价格，费用统计不完整", style = MaterialTheme.typography.bodySmall) }
}
@Composable private fun UsageScreen(repo: JarvisRepository) {
    val usage by repo.usage.collectAsStateWithLifecycle(); val range by repo.range.collectAsStateWithLifecycle()
    Screen("LLM Usage") {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("today" to "Today", "7d" to "7D", "30d" to "30D", "month" to "Month").forEach { (value, label) -> FilterChip(selected = range == value, onClick = { repo.selectRange(value) }, label = { Text(label) }) } }
        UsageCard("Total · UTC", usage.obj("total"))
        (usage?.get("providers") as? JsonArray)?.forEach { UsageCard(it.jsonObject.value("provider"), it.jsonObject) }
    }
}
