package cloud.jarvis.app.dynamicui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable fun TimelineView(title: String, data: JsonElement?, fallback: String) {
    val rows = data as? JsonArray
    fun text(value: JsonObject?, key: String) = (value?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(title,style=MaterialTheme.typography.titleMedium)
        if (rows == null || rows.any { it !is JsonObject }) Text(fallback)
        else if (rows.isEmpty()) Text("暂无执行事件")
        else {
            if (rows.size > 200) Text("显示最近 200 条事件")
            LazyColumn(Modifier.heightIn(max=420.dp).fillMaxWidth()) {
                itemsIndexed(rows.takeLast(200)) { _, row ->
                    val event=row.jsonObject
                    val payload=event["payload"] as? JsonObject
                    val status=text(payload,"status")
                    val labels=mapOf("running" to "运行中","starting" to "启动中","completed" to "已完成","failed" to "失败","cancelled" to "已取消","waiting_for_user" to "等待输入","waiting_for_approval" to "等待审批","queued" to "排队中")
                    val heading=text(payload,"title").take(500).ifBlank { labels[status] ?: "任务事件" }
                    val time=runCatching { DateTimeFormatter.ofPattern("MM/dd HH:mm:ss").withZone(ZoneId.systemDefault()).format(Instant.parse(text(event,"timestamp"))) }.getOrDefault("时间未知")
                    val description=text(payload,"description").take(4000)
                    var expanded by remember(event) { mutableStateOf(false) }
                    Column(Modifier.padding(bottom=18.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                        Text(time,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("● $heading",style=MaterialTheme.typography.bodyMedium)
                        if(description.isNotEmpty()) {
                            TextButton(onClick={expanded=!expanded}) { Text(if(expanded) "收起说明" else "查看说明") }
                            if(expanded) Text(description,style=MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    } }
}
