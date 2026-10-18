package cloud.jarvis.app

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale

internal fun JsonElement?.objectOrNull(): JsonObject? = this as? JsonObject
internal fun JsonElement?.arrayOrNull(): JsonArray? = this as? JsonArray
internal fun JsonObject.array(key: String): JsonArray = (get(key) as? JsonArray) ?: JsonArray(emptyList())
internal fun JsonObject.objects(key: String): List<JsonObject> = array(key).mapNotNull { it as? JsonObject }
internal fun JsonObject.str(key: String): String = (get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull ?: ""
internal fun JsonObject.long(key: String): Long? = (get(key) as? JsonPrimitive)?.longOrNull
internal fun JsonObject.int(key: String): Int? = (get(key) as? JsonPrimitive)?.intOrNull
internal fun JsonObject.bool(key: String): Boolean = (get(key) as? JsonPrimitive)?.booleanOrNull ?: false

internal val runStatusLabels = mapOf(
    "streaming" to "回复中", "queued" to "排队中", "starting" to "启动中", "running" to "运行中",
    "waiting_for_user" to "等待输入", "waiting_for_approval" to "等待审批", "waiting_question" to "等待选择",
    "completed" to "已完成", "failed" to "未完成", "cancelled" to "已停止", "idle" to "空闲",
    "offline" to "离线", "degraded" to "降级", "error" to "错误", "healthy" to "正常",
    "active" to "进行中", "pending" to "待处理", "approved" to "已批准", "rejected" to "已拒绝",
    "success" to "成功", "stopped" to "已停止", "unknown" to "状态未知",
)

internal fun statusLabel(value: String): String = runStatusLabels[value] ?: value.ifBlank { "状态未知" }

internal val capabilityLabels: Map<String, String> = mapOf(
    "mcp.homeassistant.read" to "Home Assistant 读取",
    "mcp.homeassistant.write" to "Home Assistant 控制",
    "mcp.immich.read" to "Immich 读取",
    "mcp.immich.write" to "Immich 修改",
    "schedule.write" to "定时任务",
    "system.status.read" to "读取服务器状态",
    "system.metrics.read" to "读取服务器指标",
    "ui.view.show" to "打开动态界面",
    "conversation.question.create" to "向你提问",
    "task.create" to "创建任务",
    "run.cancel" to "取消任务",
    "run.input" to "补充任务输入",
    "run.resume" to "恢复任务",
    "approval.response" to "处理审批",
    "app.resolve" to "打开应用",
)

internal fun capabilityLabel(value: String): String = capabilityLabels[value] ?: when {
    value.startsWith("mcp_jarvis_") || value.startsWith("mcp__jarvis__") -> "Jarvis 服务调用"
    value.startsWith("mcp.") -> value.removePrefix("mcp.").replace('.', ' ')
    else -> value.ifBlank { "能力调用" }
}

internal fun activityKindLabel(kind: String): String = when (kind) {
    "reasoning" -> "思考"
    "skill" -> "技能"
    "tool" -> "服务调用"
    "processing" -> "整理"
    "approval" -> "确认"
    "question" -> "等待选择"
    "render" -> "生成界面"
    "answer" -> "回答"
    "result" -> "结果"
    else -> "执行阶段"
}

internal fun activityTitle(capability: String, input: JsonObject?): String {
    val provider = input?.str("provider").orEmpty().lowercase()
    val tool = (input?.str("tool_name").orEmpty() + input?.str("tool").orEmpty() + capability).lowercase()
    if (provider.contains("immich") || capability.lowercase().contains("immich")) {
        return "Immich · " + when {
            Regex("search|find|query|album").containsMatchIn(tool) -> "搜索照片"
            Regex("asset|photo|image").containsMatchIn(tool) -> "查看照片"
            else -> "整理相册"
        }
    }
    if (provider.replace("_", "").contains("homeassistant") || capability.lowercase().contains("homeassistant")) {
        return "Home Assistant · " + when {
            Regex("snapshot|image|camera").containsMatchIn(tool) -> "查看监控画面"
            Regex("call|service|control|setstate|turn").containsMatchIn(tool) -> "控制设备"
            Regex("search|find|list").containsMatchIn(tool) -> "查找设备"
            else -> "读取设备状态"
        }
    }
    return when (capability) {
        "system.status.read", "system_status_read" -> "读取服务器状态"
        "system.metrics.read", "system_metrics_read" -> "读取服务器指标"
        "ui.view.show", "ui_view_show" -> "打开工作区"
        "task.create", "task_create" -> "创建任务"
        "conversation.question.create", "conversation_question_create" -> "等待你的选择"
        else -> "执行操作"
    }
}

internal fun formatClock(totalSeconds: Long): String {
    val seconds = totalSeconds.coerceAtLeast(0)
    return "%02d:%02d".format(seconds / 60, seconds % 60)
}

internal fun relativeTime(value: String?): String {
    if (value.isNullOrBlank()) return "—"
    return runCatching {
        val seconds = (Instant.now().epochSecond - Instant.parse(value).epochSecond).coerceAtLeast(0)
        when {
            seconds < 60 -> "${seconds} 秒前"
            seconds < 3600 -> "${seconds / 60} 分钟前"
            seconds < 86400 -> "${seconds / 3600} 小时前"
            seconds < 86400 * 30 -> "${seconds / 86400} 天前"
            else -> DateTimeFormatter.ofPattern("yyyy/MM/dd").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
        }
    }.getOrDefault("—")
}

internal fun shortDateTime(value: String?): String {
    if (value.isNullOrBlank()) return "—"
    return runCatching {
        DateTimeFormatter.ofPattern("MM/dd HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
    }.getOrDefault(value)
}

internal fun fullDateTime(value: String?): String {
    if (value.isNullOrBlank()) return "—"
    return runCatching {
        DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
    }.getOrDefault(value)
}

internal fun dateOnly(value: String?): String {
    if (value.isNullOrBlank()) return "—"
    return runCatching {
        DateTimeFormatter.ofPattern("yyyy/MM/dd").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
    }.getOrDefault(value)
}

internal fun localDateTimeInput(millis: Long): String = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(Date(millis))

internal fun parseLocalDateTimeInput(value: String): Long? = runCatching {
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).parse(value)?.time
}.getOrNull()

internal fun displayValue(value: JsonElement?): String = when {
    value == null || value is JsonNull -> "暂无数据"
    value is JsonPrimitive -> runStatusLabels[value.content] ?: value.content
    else -> value.toString()
}

internal fun compactNumber(value: Double?): String = when {
    value == null -> "—"
    value >= 1e9 -> "%.2fB".format(value / 1e9)
    value >= 1e6 -> "%.2fM".format(value / 1e6)
    value >= 1e3 -> "%.1fK".format(value / 1e3)
    else -> "%.0f".format(value)
}

internal fun bytesLabel(value: Double?): String = value?.let { "%.1f GiB".format(it / 1073741824) } ?: "—"
internal fun percentLabel(value: Double?): String = value?.let { "%.1f%%".format(it) } ?: "—"
