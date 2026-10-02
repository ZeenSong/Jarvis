package cloud.jarvis.app.features

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.JarvisRepository
import kotlinx.serialization.json.*

private fun JsonObject.value(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

@Composable fun NotificationCenter(repo: JarvisRepository, open: (String) -> Unit) {
    val notifications by repo.m2.notifications.collectAsStateWithLifecycle()
    var filter by remember { mutableStateOf("全部") }
    val visible = notifications.filter { n -> when(filter) {
        "待处理" -> n.value("kind") in listOf("approval", "question", "task_question")
        "已完成" -> n.value("kind") == "task_completed"
        "系统提醒" -> n.value("kind") !in listOf("approval", "question", "task_completed", "task_failed")
        else -> true
    } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("通知", style = MaterialTheme.typography.headlineMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("全部", "待处理", "已完成", "系统提醒").forEach { item -> FilterChip(filter == item, { filter = item }, { Text(item) }) } }
        if (visible.isEmpty()) ProductEmpty("暂无通知", "任务完成或需要你处理时，会出现在这里。")
        visible.forEach { n ->
            Card(onClick = { repo.m2.markNotificationRead(n.value("id")); openNotification(n, open) }, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(n.value("title"), style = MaterialTheme.typography.titleMedium); if(n.value("read_at").isBlank()) Text("未读", color = MaterialTheme.colorScheme.primary) }
                    Text(n.value("body"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if(n.value("kind") in listOf("approval", "question", "task_question")) Text("立即处理 →", color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

private fun openNotification(n: JsonObject, open: (String) -> Unit) {
    val ref = n.value("reference_id")
    when(n.value("kind")) {
        "task_completed", "task_failed", "task_question" -> open("run/$ref")
        "question" -> open("conversation/$ref")
        "approval" -> open("notification/${n.value("id")}")
        else -> open("notification/${n.value("id")}")
    }
}

@Composable fun NotificationDetail(repo: JarvisRepository, id: String, openTask: (String) -> Unit, back: () -> Unit) {
    val notifications by repo.m2.notifications.collectAsStateWithLifecycle()
    val approvals by repo.m2.approvals.collectAsStateWithLifecycle()
    val n = notifications.firstOrNull { it.value("id") == id }
    val approval = n?.value("reference_id")?.let { ref -> approvals.firstOrNull { it.value("id") == ref } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        TextButton(onClick = back) { Text("← 返回通知") }
        if(n == null) Text("该通知不存在、已删除或你无权访问。") else {
            Text(n.value("title"), style = MaterialTheme.typography.headlineMedium); Text(n.value("body"))
            if(approval?.value("status") == "pending") {
                Text("请求能力：${approval.value("capability")}")
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(onClick = { repo.m2.resolveApproval(approval.value("id"), true) }) { Text("允许") }
                    OutlinedButton(onClick = { repo.m2.resolveApproval(approval.value("id"), false) }) { Text("拒绝") }
                }
            } else if (approval != null) Text("处理状态：${approval.value("status")}")
            val runId = approval?.value("run_id").orEmpty()
            if(runId.isNotBlank()) TextButton(onClick = { openTask(runId) }) { Text("查看关联任务 →") }
        }
    }
}

@Composable fun SpaceDetail(id: String, navigate: (String) -> Unit) {
    val names = mapOf("photos" to "照片", "files" to "文件", "knowledge" to "知识", "family" to "家庭", "media" to "媒体", "development" to "开发")
    val name = names[id]
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if(name == null) Text("该空间不存在或你无权访问。") else {
            Text(name, style = MaterialTheme.typography.headlineMedium)
            Text("最近更新", style = MaterialTheme.typography.titleLarge)
            ProductEmpty("暂无内容更新", "这里仅展示私人云中的真实内容，不会生成模拟数据。")
            when(id) {
                "photos", "family" -> Button(onClick = { navigate("apps") }) { Text("打开关联应用") }
                "knowledge" -> Button(onClick = { navigate("jarvis") }) { Text("询问 Jarvis") }
                "development" -> Button(onClick = { navigate("tasks") }) { Text("查看开发任务") }
            }
        }
    }
}
