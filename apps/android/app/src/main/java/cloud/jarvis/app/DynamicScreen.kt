package cloud.jarvis.app

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
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
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.dynamicui.SemanticView
import kotlinx.serialization.json.*
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.roundToInt

internal fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull ?: ""
private val labelMap = mapOf(
    "queued" to "排队中", "starting" to "启动中", "running" to "运行中", "completed" to "已完成",
    "failed" to "失败", "cancelled" to "已取消", "waiting_for_user" to "等待输入",
    "waiting_for_approval" to "等待审批", "input_tokens" to "输入 Token", "output_tokens" to "输出 Token",
    "estimated_cost_usd" to "预估费用（美元）", "healthy" to "正常", "requests" to "请求数",
    "errors" to "错误请求", "cached_input_tokens" to "缓存 Token", "reasoning_tokens" to "推理 Token",
    "p95_latency_ms" to "延迟 P95", "tokens" to "Token 总量", "share_percent" to "日用量占比",
    "server_status" to "服务状态", "db_status" to "数据库", "version" to "版本",
)

internal fun display(value: JsonElement?): String = when {
    value == null || value is JsonNull -> "暂无数据"
    value is JsonPrimitive -> labelMap[value.content] ?: value.content
    else -> value.toString()
}

private fun path(data: JsonElement?, path: String?): JsonElement? =
    if (path.isNullOrBlank()) data else path.split('.').fold(data) { value, key -> (value as? JsonObject)?.get(key) }

@Composable
fun DynamicScreen(repo: M2Repository, openRun: (String) -> Unit) {
    val palette = jarvisColors()
    val semantic by repo.semanticView.collectAsStateWithLifecycle()
    val view by repo.view.collectAsStateWithLifecycle()
    val resources by repo.resources.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Eyebrow("TASK / RESULT")
                Text("任务详情", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
                Text("执行过程、结果与可执行操作。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
            }
            Surface(onClick = { scope.launch { runCatching { repo.refresh() } } }, shape = CircleShape, color = palette.surface2, modifier = Modifier.size(34.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Refresh, "刷新", Modifier.size(16.dp), tint = palette.muted) }
            }
        }
        when {
            semantic != null -> SemanticView(semantic!!, resources, imageLoader = repo::thumbnail, followup = repo::prefill) { action ->
                if (action.text("type") == "run.open") openRun(action.text("target")) else repo.action(action)
            }
            view != null -> DynamicBlocks(view!!, resources, action = { action ->
                if (action.text("type") == "run.open") openRun(action.text("target")) else repo.action(action)
            })
            else -> {
                JarvisCard(padding = 18.dp) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = palette.accent)
                        Text("正在加载任务详情…", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
fun DynamicBlocks(view: JsonObject, resources: Map<String, JsonObject>, action: (JsonObject) -> Unit, compact: Boolean = false) {
    val palette = jarvisColors()
    if ((view["version"] as? JsonPrimitive)?.intOrNull != 1) {
        Text("请更新客户端以显示此视图", color = palette.muted)
        return
    }
    if (view.text("title").isNotBlank() && !compact) {
        Text(view.text("title"), style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
    }
    (view["blocks"] as? JsonArray)?.forEach { item ->
        val block = item as? JsonObject
        if (block == null) {
            Text("此面板数据格式不兼容", color = palette.danger)
            return@forEach
        }
        val data = path(resources[block.text("resource")]?.get("data"), block.text("path")) ?: block["text"]
        JarvisCard(
            padding = 16.dp,
            color = if (compact) palette.surface else palette.surface,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(block.text("title"), style = MaterialTheme.typography.titleSmall, color = palette.muted, modifier = Modifier.weight(1f))
                    Text(block.text("type"), style = MaterialTheme.typography.labelSmall, color = palette.muted2)
                }
                if (block.text("type") in listOf("timeline", "run_graph") && data != null && data !is JsonNull &&
                    (data !is JsonArray || data.any { it !is JsonObject })) {
                    Text("此面板数据格式不兼容", color = palette.danger, style = MaterialTheme.typography.bodySmall)
                    return@Column
                }
                when (block.text("type")) {
                    "metric" -> Text(display(data), style = MaterialTheme.typography.displaySmall, color = palette.textStrong)
                    "metric_group", "status_grid" -> (data as? JsonObject)?.entries?.filterNot { it.key in listOf("input_json", "runtime_config") }?.forEach { (key, value) ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text(labelMap[key] ?: key, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = palette.muted)
                            Text(display(value), Modifier.weight(1.3f), style = MaterialTheme.typography.bodySmall, color = palette.text)
                        }
                    } ?: Text("暂无数据", color = palette.muted, style = MaterialTheme.typography.bodySmall)
                    "sparkline", "line_chart", "bar_chart", "donut", "gauge" -> DataChart(block.text("type"), data)
                    "progress" -> {
                        val value = (data as? JsonPrimitive)?.floatOrNull
                        LinearProgressIndicator(
                            progress = { ((value ?: 0f) / 100f).coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth().height(6.dp),
                            color = palette.accent,
                            trackColor = palette.text.copy(alpha = 0.08f),
                        )
                        Text(display(data), style = MaterialTheme.typography.labelMedium, color = palette.muted)
                    }
                    "timeline" -> (data as? JsonArray)?.takeLast(120)?.forEach { element ->
                        val event = element as? JsonObject ?: return@forEach
                        val payload = event["payload"] as? JsonObject
                        val heading = payload?.text("title")?.ifBlank { null } ?: display(payload?.get("status"))
                        Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                            Box(Modifier.padding(top = 6.dp).size(5.dp).background(palette.accent, CircleShape))
                            Spacer(Modifier.width(9.dp))
                            Column(Modifier.weight(1f)) {
                                Text(heading, style = MaterialTheme.typography.bodySmall, color = palette.text)
                                Text(shortDateTime(event.text("timestamp")), style = MaterialTheme.typography.labelSmall, color = palette.muted2)
                            }
                        }
                    } ?: Text("暂无数据", color = palette.muted, style = MaterialTheme.typography.bodySmall)
                    "table" -> {
                        val rows = (data as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
                        if (rows.isEmpty()) Text("暂无记录", color = palette.muted, style = MaterialTheme.typography.bodySmall)
                        else Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                            val keys = rows.first().keys.filter { it != "content" }
                            Row(Modifier.background(palette.surface2, RoundedCornerShape(8.dp)).padding(8.dp)) {
                                keys.forEach { key -> Text(labelMap[key] ?: key, Modifier.widthIn(min = 100.dp), style = MaterialTheme.typography.labelSmall, color = palette.muted) }
                            }
                            rows.forEach { row ->
                                Row(Modifier.padding(horizontal = 8.dp, vertical = 7.dp)) {
                                    keys.forEach { key -> Text(display(row[key]), Modifier.widthIn(min = 100.dp), style = MaterialTheme.typography.bodySmall, color = palette.text) }
                                }
                                HorizontalDivider(color = palette.line)
                            }
                        }
                    }
                    "run_graph" -> {
                        val rows = (data as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
                        rows.filter { row -> rows.none { it["id"] == row["parent_run_id"] } }.forEach { RunNode(it, rows, 0, action) }
                    }
                    "action" -> (block["action"] as? JsonObject)?.let { value ->
                        if (value.text("type") == "run.input") {
                            var text by remember(value.text("target")) { mutableStateOf("") }
                            OutlinedTextField(
                                value = text,
                                onValueChange = { if (it.length <= 16000) text = it },
                                label = { Text("补充任务输入") },
                                shape = RoundedCornerShape(11.dp),
                                modifier = Modifier.fillMaxWidth(),
                                textStyle = MaterialTheme.typography.bodySmall,
                            )
                            PrimaryButton("发送输入", Modifier.fillMaxWidth(), enabled = text.isNotBlank()) {
                                action(JsonObject(value + ("text" to JsonPrimitive(text.trim()))))
                            }
                        } else {
                            PrimaryButton(block.text("title"), Modifier.fillMaxWidth()) { action(value) }
                        }
                    }
                    "approval" -> {
                        Text("审批不能扩大 Worker 权限", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                        (block["action"] as? JsonObject)?.let { value ->
                            OutlineButton("拒绝操作", Modifier.fillMaxWidth()) {
                                action(JsonObject(value + ("approved" to JsonPrimitive(false))))
                            }
                        }
                    }
                    "code_diff" -> SelectionContainerText(display(data))
                    "markdown", "card", "alert" -> Text(display(data), style = MaterialTheme.typography.bodyMedium, color = palette.text)
                    else -> Text("此组件需要更新客户端才能显示", color = palette.muted, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun SelectionContainerText(value: String) {
    val palette = jarvisColors()
    androidx.compose.foundation.text.selection.SelectionContainer {
        Column(Modifier.fillMaxWidth().background(palette.background, RoundedCornerShape(9.dp)).padding(10.dp)) {
            value.lines().forEach { line ->
                Text(
                    line,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace),
                    color = when {
                        line.startsWith("+") -> palette.sage
                        line.startsWith("-") -> palette.danger
                        else -> palette.muted
                    },
                )
            }
        }
    }
}

@Composable
private fun RunNode(row: JsonObject, rows: List<JsonObject>, depth: Int, action: (JsonObject) -> Unit) {
    if (depth > 4) return
    val palette = jarvisColors()
    Column(Modifier.padding(start = (depth * 12).dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Surface(
            onClick = { action(buildJsonObject { put("type", "run.open"); put("target", row.text("id")) }) },
            shape = RoundedCornerShape(9.dp),
            color = palette.surface2,
        ) {
            Row(Modifier.padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (depth > 0) "└ " else "◇ ", color = palette.accent, style = MaterialTheme.typography.bodySmall)
                Text(row.text("agent_id"), style = MaterialTheme.typography.bodySmall, color = palette.text)
                Spacer(Modifier.width(8.dp))
                Text(display(row["status"]), style = MaterialTheme.typography.labelSmall, color = palette.muted)
            }
        }
        if (row["agent_instance_id"] != null && row["agent_instance_id"] != JsonNull) {
            Text("◇ Worker", style = MaterialTheme.typography.labelSmall, color = palette.muted2, modifier = Modifier.padding(start = 12.dp))
        }
        rows.filter { it["parent_run_id"] == row["id"] }.forEach { RunNode(it, rows, depth + 1, action) }
    }
}

@Composable
private fun DataChart(type: String, data: JsonElement?) {
    val palette = jarvisColors()
    val rows = (data as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
    val samples = rows.map { row ->
        val direct = (row["value"] as? JsonPrimitive)?.floatOrNull
        val cpu = ((row["data"] as? JsonObject)?.get("cpu") as? JsonObject)?.get("usage_percent")?.jsonPrimitive?.floatOrNull
        val hasTokens = row["input_tokens"] is JsonPrimitive || row["output_tokens"] is JsonPrimitive
        val tokens = if (hasTokens) {
            ((row["input_tokens"] as? JsonPrimitive)?.floatOrNull ?: 0f) + ((row["output_tokens"] as? JsonPrimitive)?.floatOrNull ?: 0f)
        } else null
        (direct ?: cpu ?: tokens)?.takeIf { it.isFinite() }
    }
    val gpuSamples = rows.map { row ->
        (((row["data"] as? JsonObject)?.get("gpu") as? JsonObject)?.get("utilization_percent") as? JsonPrimitive)?.floatOrNull?.takeIf { it.isFinite() }
    }
    val history = rows.any { it["data"] is JsonObject }
    val gauge = (data as? JsonPrimitive)?.floatOrNull?.takeIf { it.isFinite() }
    if ((type == "gauge" && gauge == null) || (type != "gauge" && samples.none { it != null } && gpuSamples.none { it != null })) {
        Text("暂无数据 · 未采集时段保留缺口", color = palette.muted, style = MaterialTheme.typography.bodySmall)
        return
    }
    val accent = palette.accent
    val sage = palette.sage
    Canvas(Modifier.fillMaxWidth().height(190.dp)) {
        val textPaint = Paint().apply {
            color = palette.muted.toArgb()
            textSize = 9.sp.toPx()
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
        }
        // Baseline grid.
        repeat(5) { index ->
            val y = size.height * index / 4f
            drawLine(palette.line.copy(alpha = 0.6f), Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
        }
        val padding = 8.dp.toPx()
        val chartHeight = size.height - padding * 2
        val max = if (history) 100f else (samples.filterNotNull().maxOrNull() ?: 100f).coerceAtLeast(1f)
        if (type == "gauge") {
            val arcSize = androidx.compose.ui.geometry.Size(size.width * 0.52f, size.width * 0.52f)
            val topLeft = Offset((size.width - arcSize.width) / 2f, 10.dp.toPx())
            drawArc(palette.surface3, 140f, 260f, false, topLeft = topLeft, size = arcSize, style = Stroke(13.dp.toPx(), cap = StrokeCap.Round))
            drawArc(accent, 140f, 260f * ((gauge ?: 0f) / 100f).coerceIn(0f, 1f), false, topLeft = topLeft, size = arcSize, style = Stroke(13.dp.toPx(), cap = StrokeCap.Round))
            drawContext.canvas.nativeCanvas.drawText(
                "${(gauge ?: 0f).roundToInt()}%",
                size.width / 2f,
                topLeft.y + arcSize.height * 0.86f,
                textPaint.apply { textSize = 26.sp.toPx(); color = palette.textStrong.toArgb(); textAlign = Paint.Align.CENTER },
            )
            return@Canvas
        }
        if (type == "donut") {
            val sum = samples.filterNotNull().sum().coerceAtLeast(1f)
            val radius = size.minDimension * 0.34f
            val center = Offset(size.width / 2f, size.height / 2f)
            var angle = -90f
            val colors = listOf(accent, palette.info, sage, palette.danger)
            samples.forEachIndexed { index, value ->
                val sweep = (value ?: 0f) / sum * 360f
                drawArc(colors[index % colors.size], angle, sweep, false, topLeft = Offset(center.x - radius, center.y - radius), size = Size(radius * 2, radius * 2), style = Stroke(24.dp.toPx()))
                angle += sweep
            }
            drawContext.canvas.nativeCanvas.drawText(
                compactNumber(sum.toDouble()),
                center.x,
                center.y + 5.dp.toPx(),
                textPaint.apply { textSize = 14.sp.toPx(); color = palette.textStrong.toArgb(); textAlign = Paint.Align.CENTER },
            )
            return@Canvas
        }
        val top = padding
        val bottom = size.height - padding
        fun yFor(value: Float) = bottom - (value / max) * (bottom - top)
        if (type == "bar_chart") {
            val slot = size.width / samples.size.coerceAtLeast(1)
            samples.forEachIndexed { index, value ->
                if (value != null) {
                    val barHeight = (value / max) * (bottom - top)
                    drawRoundRect(
                        brush = Brush.verticalGradient(listOf(accent, accent.copy(alpha = 0.25f))),
                        topLeft = Offset(index * slot + slot * 0.22f, bottom - barHeight),
                        size = Size(slot * 0.56f, barHeight),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()),
                    )
                }
            }
        } else {
            val step = size.width / (samples.size.coerceAtLeast(2) - 1)
            val points = samples.mapIndexedNotNull { index, value -> value?.let { Offset(index * step, yFor(it)) } }
            if (points.size >= 2) {
                val area = androidx.compose.ui.graphics.Path().apply {
                    moveTo(points.first().x, bottom)
                    points.forEach { lineTo(it.x, it.y) }
                    lineTo(points.last().x, bottom)
                    close()
                }
                drawPath(area, Brush.verticalGradient(listOf(accent.copy(alpha = 0.18f), Color.Transparent)))
                points.zipWithNext().forEach { (a, b) -> drawLine(accent, a, b, strokeWidth = 2.2f, cap = StrokeCap.Round) }
                points.forEach { drawCircle(accent, 2.4f, it) }
            }
            if (history) {
                val gpuPoints = gpuSamples.mapIndexedNotNull { index, value -> value?.let { Offset(index * step, yFor(it)) } }
                gpuPoints.zipWithNext().forEach { (a, b) -> drawLine(sage, a, b, strokeWidth = 2f, cap = StrokeCap.Round) }
                gpuPoints.forEach { drawCircle(sage, 2.2f, it) }
            }
        }
        // Lightweight Y-axis labels.
        listOf(0f, max / 2f, max).forEach { value ->
            drawContext.canvas.nativeCanvas.drawText(
                "%.0f".format(value),
                2.dp.toPx(),
                (yFor(value) + 3.dp.toPx()).coerceIn(10.dp.toPx(), size.height - 2.dp.toPx()),
                textPaint,
            )
        }
    }
    if (history) {
        Text("CPU · 金色    GPU · 绿色    纵轴 0–100%", style = MaterialTheme.typography.labelSmall, color = palette.muted2)
        Text("断线处表示指标缺失", style = MaterialTheme.typography.labelSmall, color = palette.muted2)
    }
    if (type == "gauge") {
        Text("${gauge} %", style = MaterialTheme.typography.labelMedium, color = palette.muted)
    } else {
        Text(
            (rows.firstOrNull()?.let { it.text("label").ifBlank { it.text("sampled_at") } } ?: "") + " → " +
                (rows.lastOrNull()?.let { it.text("label").ifBlank { it.text("sampled_at") } } ?: ""),
            style = MaterialTheme.typography.labelSmall,
            color = palette.muted2,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
