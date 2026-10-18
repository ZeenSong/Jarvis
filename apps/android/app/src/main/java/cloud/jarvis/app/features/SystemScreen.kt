package cloud.jarvis.app.features

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.DynamicBlocks
import cloud.jarvis.app.JarvisRepository
import cloud.jarvis.app.compactNumber
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.dynamicui.SemanticView
import cloud.jarvis.app.int
import cloud.jarvis.app.percentLabel
import cloud.jarvis.app.str
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Composable
fun SystemScreen(repo: JarvisRepository, openRun: (String) -> Unit) {
    val palette = jarvisColors()
    val system by repo.system.collectAsStateWithLifecycle()
    val usage by repo.usage.collectAsStateWithLifecycle()
    val range by repo.range.collectAsStateWithLifecycle()
    val semantic by repo.m2.semanticView.collectAsStateWithLifecycle()
    val legacy by repo.m2.view.collectAsStateWithLifecycle()
    val resources by repo.m2.resources.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf("system") }

    LaunchedEffect(Unit) {
        if (system != null && semantic == null && legacy == null) repo.m2.show("system_overview")
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Eyebrow("SYSTEM / INSIGHTS")
                Text(if (tab == "system") "系统概览" else "AI 用量", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
                Text("实时指标、趋势和调用成本。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
            }
            OutlineButton("刷新", icon = JarvisIcons.Refresh) { repo.refresh(); repo.m2.show("system_overview") }
        }

        Row(
            Modifier.fillMaxWidth().background(palette.surface2, RoundedCornerShape(12.dp)).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            listOf("system" to "系统", "usage" to "AI 用量").forEach { (value, text) ->
                val selected = tab == value
                Surface(
                    onClick = { tab = value },
                    shape = RoundedCornerShape(9.dp),
                    color = if (selected) palette.surface else Color.Transparent,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(
                        text,
                        Modifier.padding(vertical = 8.dp),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        style = MaterialTheme.typography.labelMedium,
                        color = if (selected) palette.textStrong else palette.muted,
                    )
                }
            }
        }

        if (tab == "system") {
            SystemOverview(system)
            if (semantic != null) {
                JarvisCard(padding = 17.dp) {
                    SemanticView(semantic!!, resources, imageLoader = repo.m2::thumbnail, followup = repo.m2::prefill) { action ->
                        if (action.str("type") == "run.open") openRun(action.str("target")) else repo.m2.action(action)
                    }
                }
            } else if (legacy != null) {
                JarvisCard(padding = 17.dp) { DynamicBlocks(legacy!!, resources, { action -> repo.m2.action(action) }) }
            } else {
                JarvisCard(padding = 18.dp) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("系统趋势", style = MaterialTheme.typography.titleMedium, color = palette.textStrong)
                        Text("生成 CPU、内存、存储与网络的历史视图。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                        OutlineButton("生成系统趋势视图", Modifier.fillMaxWidth(), icon = JarvisIcons.Wave) {
                            repo.m2.show("system_overview")
                        }
                    }
                }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("today" to "今日", "7d" to "7 天", "30d" to "30 天", "month" to "本月").forEach { (value, label) ->
                    FilterChip(
                        selected = range == value,
                        onClick = { repo.selectRange(value) },
                        label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = palette.accentSoft,
                            selectedLabelColor = palette.accent,
                        ),
                    )
                }
            }
            UsageCard("Total · UTC", usage?.get("total") as? JsonObject)
            val providers = (usage?.get("providers") as? kotlinx.serialization.json.JsonArray)
                ?.mapNotNull { it as? JsonObject }.orEmpty()
            if (providers.isEmpty()) {
                EmptyState("暂无调用记录", "配置模型并开始对话后，Token 与费用会显示在这里。")
            } else {
                ProviderUsageBars(providers)
                providers.forEach { provider ->
                    UsageCard(provider.str("provider"), provider)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlineButton("用量分析视图", Modifier.weight(1f), icon = JarvisIcons.Wave) {
                    tab = "system"
                    repo.m2.show("usage_analysis")
                }
                OutlineButton("趋势图表", Modifier.weight(1f), icon = JarvisIcons.Wave) { tab = "system"; repo.m2.show("system_overview") }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun SystemOverview(system: JsonObject?) {
    val palette = jarvisColors()
    val server = system?.get("server") as? JsonObject
    val network = system?.get("network") as? JsonObject
    val cpu = system?.get("cpu") as? JsonObject
    val memory = system?.get("memory") as? JsonObject
    val gpu = system?.get("gpu") as? JsonObject
    val jarvis = system?.get("jarvis") as? JsonObject
    val disks = (system?.get("disks") as? kotlinx.serialization.json.JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()

    JarvisCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Eyebrow("SERVER")
                    Text(server?.str("hostname")?.ifBlank { "私人云服务器" } ?: "正在读取服务器", style = MaterialTheme.typography.titleMedium, color = palette.textStrong)
                    Text(
                        listOfNotNull(
                            server?.str("os")?.ifBlank { null },
                            server?.str("kernel")?.ifBlank { null },
                        ).joinToString(" · ").ifBlank { "等待系统指标" },
                        style = MaterialTheme.typography.labelSmall,
                        color = palette.muted,
                    )
                }
                StatusBadge(jarvis?.str("server_status")?.let { cloud.jarvis.app.statusLabel(it) } ?: "—", palette.sage)
            }
            HorizontalDivider(color = palette.line)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricTile("CPU", cpu?.get("usage_percent")?.jsonPrimitive?.doubleOrNull, Modifier.weight(1f))
                MetricTile("内存", memory?.get("usage_percent")?.jsonPrimitive?.doubleOrNull, Modifier.weight(1f))
                MetricTile("存储", disks.firstOrNull()?.get("usage_percent")?.jsonPrimitive?.doubleOrNull, Modifier.weight(1f))
            }
            if (gpu != null) {
                MetricBar("GPU · ${gpu.str("model")}", gpu.get("utilization_percent")?.jsonPrimitive?.doubleOrNull)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                KeyValueRow("运行时间", server?.get("uptime_seconds")?.jsonPrimitive?.doubleOrNull?.let { "%.1f 小时".format(it / 3600) } ?: "—", Modifier.weight(1f))
                KeyValueRow("网关版本", jarvis?.str("version") ?: "—", Modifier.weight(1f))
            }
        }
    }

    JarvisCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Eyebrow("NETWORK")
            listOf(
                "public_ipv6" to "公网 IPv6",
                "public_ipv4" to "公网 IPv4",
                "tailscale_ipv4" to "Tailscale IPv4",
                "lan_ipv4" to "局域网 IPv4",
            ).forEach { (key, label) ->
                KeyValueRow(label, network?.str(key)?.ifBlank { "不可用" } ?: "—", monospace = true)
            }
        }
    }

    if (disks.isNotEmpty()) {
        JarvisCard(padding = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Eyebrow("STORAGE")
                disks.forEach { disk ->
                    MetricBar(disk.str("mount").ifBlank { "磁盘" }, disk.get("usage_percent")?.jsonPrimitive?.doubleOrNull)
                }
            }
        }
    }
}

@Composable
private fun MetricTile(label: String, value: Double?, modifier: Modifier = Modifier) {
    val palette = jarvisColors()
    Column(
        modifier.background(palette.surface2, RoundedCornerShape(12.dp)).padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = palette.muted)
        Text(value?.let { "${it.toInt()}%" } ?: "—", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
        Box(Modifier.fillMaxWidth().height(2.dp).background(palette.line, CircleShape)) {
            Box(Modifier.fillMaxWidth(((value ?: 0.0) / 100.0).toFloat().coerceIn(0.01f, 1f)).height(2.dp).background(palette.accent, CircleShape))
        }
    }
}

@Composable
private fun UsageCard(title: String, total: JsonObject?) {
    val palette = jarvisColors()
    JarvisCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = palette.textStrong)
            HorizontalDivider(color = palette.line)
            KeyValueRow("输入 Token", compactNumber(total?.get("input_tokens")?.jsonPrimitive?.doubleOrNull))
            KeyValueRow("输出 Token", compactNumber(total?.get("output_tokens")?.jsonPrimitive?.doubleOrNull))
            KeyValueRow("缓存输入", compactNumber(total?.get("cached_input_tokens")?.jsonPrimitive?.doubleOrNull))
            KeyValueRow("推理 Token", compactNumber(total?.get("reasoning_tokens")?.jsonPrimitive?.doubleOrNull))
            KeyValueRow("请求 / 错误", "${total?.get("requests")?.jsonPrimitive?.doubleOrNull?.toInt() ?: 0} / ${total?.get("errors")?.jsonPrimitive?.doubleOrNull?.toInt() ?: 0}")
            KeyValueRow(
                "预估费用",
                total?.get("estimated_cost_usd")?.jsonPrimitive?.doubleOrNull?.let { "$%.6f".format(java.util.Locale.US, it) } ?: "未配置价格",
            )
            val unpriced = total?.get("unpriced_requests")?.jsonPrimitive?.doubleOrNull ?: 0.0
            if (unpriced > 0) {
                Text("$unpriced 次请求没有价格，费用统计不完整", style = MaterialTheme.typography.labelSmall, color = palette.danger)
            }
        }
    }
}

@Composable
private fun ProviderUsageBars(providers: List<JsonObject>) {
    val palette = jarvisColors()
    val values = providers.map {
        (it.get("input_tokens")?.jsonPrimitive?.doubleOrNull ?: 0.0) +
            (it.get("output_tokens")?.jsonPrimitive?.doubleOrNull ?: 0.0)
    }
    val max = values.maxOrNull()?.coerceAtLeast(1.0) ?: 1.0
    JarvisCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Eyebrow("TOKENS BY PROVIDER")
            providers.forEachIndexed { index, provider ->
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(provider.str("provider").ifBlank { "默认供应商" }, style = MaterialTheme.typography.bodySmall, color = palette.text)
                        Text(compactNumber(values[index]), style = MaterialTheme.typography.labelMedium, color = palette.accent)
                    }
                    Box(Modifier.fillMaxWidth().height(6.dp).background(palette.text.copy(alpha = 0.06f), CircleShape)) {
                        Box(
                            Modifier.fillMaxWidth((values[index] / max).toFloat().coerceIn(0.015f, 1f)).height(6.dp)
                                .background(palette.accent.copy(alpha = 0.85f), CircleShape),
                        )
                    }
                }
            }
        }
    }
}
