package cloud.jarvis.app.dynamicui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable fun TaskView(title: String, data: JsonElement?, fallback: String) {
    val task = data as? JsonObject
    fun field(key: String) = (task?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content
    val goal = field("goal")
    val status = field("status")
    val labels = mapOf("queued" to "排队中", "starting" to "启动中", "running" to "运行中", "waiting_for_user" to "等待输入", "waiting_for_approval" to "等待审批", "completed" to "已完成", "failed" to "失败", "cancelled" to "已取消")
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (goal.isNullOrEmpty() || goal.length > 16000 || status.isNullOrEmpty() || status.length > 100) Text(fallback)
        else {
            Text(labels[status] ?: "未知状态：$status", color = if (status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
            Text(goal, style = MaterialTheme.typography.titleLarge)
            field("agent_id")?.takeIf { it.length <= 200 }?.let { Text("执行者 · $it", style = MaterialTheme.typography.bodyMedium) }
            listOf("started_at" to "开始时间", "finished_at" to "完成时间").forEach { (key,label) ->
                field(key)?.let { raw ->
                    val time = runCatching { DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss").withZone(ZoneId.systemDefault()).format(Instant.parse(raw)) }.getOrDefault("时间不可用")
                    Text("$label · $time", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    } }
}
