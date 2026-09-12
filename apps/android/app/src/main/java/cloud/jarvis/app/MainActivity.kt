package cloud.jarvis.app

import android.os.Bundle
import android.os.Build
import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
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
import cloud.jarvis.app.designsystem.JarvisTheme
import cloud.jarvis.app.designsystem.JarvisOrb
import cloud.jarvis.app.features.ProductHome
import cloud.jarvis.app.features.ProductTasks
import cloud.jarvis.app.features.ProductEmpty
import cloud.jarvis.app.features.SpaceTiles
import androidx.compose.ui.res.painterResource
import cloud.jarvis.app.features.ProductApplications

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); enableEdgeToEdge(statusBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), navigationBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)); setContent {
        val preferences=remember { getSharedPreferences("jarvis-appearance",MODE_PRIVATE) }
        var light by remember { mutableStateOf(preferences.getBoolean("light",false)) }
        SideEffect {
            val style=if(light) SystemBarStyle.light(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT) else SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
            enableEdgeToEdge(statusBarStyle=style,navigationBarStyle=style)
        }
        JarvisTheme(light=light) {
            val vm: JarvisViewModel = viewModel(); JarvisApp(vm.repository,light) { light=!light;preferences.edit().putBoolean("light",light).apply() }
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
private val uiLabels = mapOf("Overview" to "概览", "Server" to "服务器", "Agents Online" to "在线智能体", "LLM Today" to "今日 AI 用量", "Public IPv6" to "公网 IPv6", "Gateway Latency" to "网关延迟", "Server Uptime" to "运行时间", "OS" to "操作系统", "Kernel" to "内核", "Uptime" to "运行时间", "Network" to "网络", "Utilization" to "使用率", "Load 1 / 5 / 15m" to "负载 1 / 5 / 15 分钟", "Temperature" to "温度", "Memory" to "内存", "Used / Total" to "已用 / 总量", "Storage" to "存储", "VRAM" to "显存", "Jarvis Services" to "Jarvis 服务", "Jarvis Server" to "Jarvis 服务端", "Version" to "版本", "Agents" to "监控智能体", "Status" to "状态", "Task" to "任务", "Runtime" to "运行时", "Provider / Model" to "供应商 / 模型", "Last Seen" to "最近上报", "Identity & Session" to "身份与会话", "Today · UTC" to "今日 · UTC", "Recent Events" to "最近事件", "Input" to "输入 Token", "Output" to "输出 Token", "Cached Input" to "缓存输入", "Reasoning" to "推理 Token", "Requests / Errors" to "请求 / 错误", "Estimated Cost" to "预估费用", "LLM Usage" to "AI 用量", "Total · UTC" to "合计 · UTC", "healthy" to "正常", "idle" to "空闲", "running" to "运行中", "offline" to "离线", "degraded" to "降级", "error" to "错误")
private fun localized(value: String) = uiLabels[value] ?: value

@Composable private fun JarvisApp(repo: JarvisRepository, light:Boolean, toggleTheme:()->Unit) {
    val paired by repo.paired.collectAsStateWithLifecycle(); val connection by repo.gateway.state.collectAsStateWithLifecycle()
    val error by repo.error.collectAsStateWithLifecycle(); val saved by repo.savedAt.collectAsStateWithLifecycle()
    var settings by remember { mutableStateOf(false) }
    if (!paired || settings || connection == ConnectionState.unauthorized) { PairScreen(error, paired, { server, code -> repo.pair(server, code); settings = false }, { settings = false }); return }
    val nav = rememberNavController(); val back by nav.currentBackStackEntryAsState(); val route = back?.destination?.route ?: "home"
    LaunchedEffect(route) { repo.selectPage(route) }
    Scaffold(topBar = { Column(Modifier.statusBarsPadding().padding(20.dp)) {
        TextButton(onClick=toggleTheme) { Text(if(light) "切换深色主题" else "切换浅色主题") }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("JARVIS", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); TextButton(onClick = { settings = true }) { Text(when(connection){ ConnectionState.online -> "已连接"; ConnectionState.connecting -> "连接中"; ConnectionState.reconnecting -> "重连中"; ConnectionState.offline -> "离线"; ConnectionState.unauthorized -> "请重新配对" }) } }
        if (connection != ConnectionState.online) Text("显示最近缓存 · ${saved?.let { Instant.ofEpochMilli(it) } ?: "尚无数据"}", style = MaterialTheme.typography.bodySmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    } }, bottomBar = { NavigationBar(containerColor=MaterialTheme.colorScheme.background) { listOf("home" to "首页", "spaces" to "空间", "jarvis" to "Jarvis", "tasks" to "任务", "apps" to "应用").forEach { (path, label) -> NavigationBarItem(selected = route == path || (path == "tasks" && route.startsWith("run/")), onClick = { nav.navigate(path) { popUpTo("home"); launchSingleTop = true } }, icon = { if(path=="jarvis") JarvisOrb(30.dp) else Icon(painterResource(when(path){"home"->R.drawable.nav_home;"spaces"->R.drawable.nav_spaces;"tasks"->R.drawable.nav_tasks;else->R.drawable.nav_apps}),contentDescription=null) }, label = { Text(label) }) } } }) { padding ->
        NavHost(nav, startDestination = "home", modifier = Modifier.padding(padding)) {
            composable("home") { ProductHome(repo) { nav.navigate(it) } }
            composable("tasks") { ProductTasks(repo) { nav.navigate("run/$it") } }
            composable("spaces") { Screen("我的空间") { SpaceTiles { nav.navigate(it) { launchSingleTop = true } } } }
            composable("apps") { val apps by repo.m2.applications.collectAsStateWithLifecycle(); LaunchedEffect(Unit) { repo.m2.refreshApplications() }; Screen("应用") { ProductApplications(apps) { repo.m2.refreshApplications() } } }
            composable("server") { ServerScreen(repo) { repo.m2.show("system_overview"); nav.navigate("workspace") } }
            composable("agents") { AgentCenter(repo.m2, { nav.navigate("run/$it") }, { nav.navigate("legacy-agents") }) }
            composable("legacy-agents") { AgentsScreen(repo) { nav.navigate("agent/$it") } }
            composable("jarvis") { ConversationScreen(repo.m2, { nav.navigate("run/$it") }, { repo.m2.loadView(it);nav.navigate("workspace") }) }
            composable("workspace") { DynamicScreen(repo.m2) { nav.navigate("run/$it") } }
            composable("run/{id}") { entry -> val id=entry.arguments?.getString("id")!!; LaunchedEffect(id){repo.m2.openRun(id)}; DynamicScreen(repo.m2) { nav.navigate("run/$it") } }
            composable("agent/{id}") { entry -> val id = entry.arguments?.getString("id")!!; DisposableEffect(id) { repo.selectAgent(id); onDispose { repo.selectAgent(null) } }; AgentScreen(repo) { nav.popBackStack() } }
            composable("ai") { UsageScreen(repo) { repo.m2.show("usage_analysis"); nav.navigate("workspace") } }
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
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { Text(localized(title), style = MaterialTheme.typography.headlineMedium); content(); Spacer(Modifier.height(12.dp)) }
}
@Composable private fun MetricCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { Text(localized(title), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleMedium); content() } }
}
@Composable private fun Metric(label: String, value: String) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) { Text(localized(label), Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant); SelectionContainer(Modifier.weight(1.3f)) { Text(localized(value)) } } }
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
@Composable private fun ServerScreen(repo: JarvisRepository, trends: () -> Unit) {
    val s by repo.system.collectAsStateWithLifecycle()
    Screen("Server") {
        TextButton(onClick=trends) { Text("查看 CPU / GPU 历史趋势") }
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
@Composable private fun UsageScreen(repo: JarvisRepository, charts: () -> Unit) {
    val usage by repo.usage.collectAsStateWithLifecycle(); val range by repo.range.collectAsStateWithLifecycle()
    Screen("LLM Usage") {
        TextButton(onClick=charts) { Text("查看用量图表") }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("today" to "今日", "7d" to "7 天", "30d" to "30 天", "month" to "本月").forEach { (value, label) -> FilterChip(selected = range == value, onClick = { repo.selectRange(value) }, label = { Text(label) }) } }
        UsageCard("Total · UTC", usage.obj("total"))
        (usage?.get("providers") as? JsonArray)?.forEach { UsageCard(it.jsonObject.value("provider"), it.jsonObject) }
    }
}
