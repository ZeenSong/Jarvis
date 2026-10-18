package cloud.jarvis.app.features

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.JarvisRepository
import cloud.jarvis.app.capabilityLabel
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.fullDateTime
import cloud.jarvis.app.relativeTime
import cloud.jarvis.app.str
import kotlinx.serialization.json.JsonObject

private fun notificationKind(kind: String): String = when (kind) {
    "approval" -> "待确认"
    "question", "task_question" -> "待回答"
    "task_completed" -> "已完成"
    "task_failed" -> "未完成"
    "schedule" -> "定时任务"
    else -> "系统提醒"
}

@Composable
fun NotificationCenter(repo: JarvisRepository, open: (String) -> Unit) {
    val palette = jarvisColors()
    val notifications by repo.m2.notifications.collectAsStateWithLifecycle()
    var filter by remember { mutableStateOf("全部") }
    val visible = notifications.filter { n ->
        when (filter) {
            "待处理" -> n.str("kind") in listOf("approval", "question", "task_question")
            "已完成" -> n.str("kind") == "task_completed"
            "系统提醒" -> n.str("kind") !in listOf("approval", "question", "task_question", "task_completed", "task_failed")
            else -> true
        }
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Eyebrow("NOTIFICATIONS")
            Text("通知", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
            Text("任务完成或需要你处理时，会出现在这里。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("全部", "待处理", "已完成", "系统提醒").forEach { item ->
                FilterChip(
                    selected = filter == item,
                    onClick = { filter = item },
                    label = { Text(item, style = MaterialTheme.typography.labelMedium) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = palette.accentSoft,
                        selectedLabelColor = palette.accent,
                    ),
                )
            }
        }
        if (visible.isEmpty()) {
            EmptyState("暂无通知", "任务完成或需要你处理时，会出现在这里。")
        } else {
            visible.forEach { notification ->
                val unread = notification.str("read_at").isBlank()
                JarvisCard(
                    padding = 15.dp,
                    onClick = {
                        repo.m2.markNotificationRead(notification.str("id"))
                        openNotification(notification, open)
                    },
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (unread) {
                                Box(Modifier.size(6.dp).background(palette.accent, CircleShape))
                                Spacer(Modifier.width(7.dp))
                            }
                            Text(
                                notification.str("title"),
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.titleSmall,
                                color = palette.textStrong,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Pill(
                                notificationKind(notification.str("kind")),
                                color = if (notification.str("kind") in listOf("approval", "question", "task_question")) palette.danger else palette.sage,
                                background = palette.surface2,
                            )
                        }
                        Text(notification.str("body"), style = MaterialTheme.typography.bodySmall, color = palette.muted, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(relativeTime(notification.str("created_at")), style = MaterialTheme.typography.labelSmall, color = palette.muted2)
                            if (notification.str("kind") in listOf("approval", "question", "task_question")) {
                                Text("立即处理 →", style = MaterialTheme.typography.labelMedium, color = palette.accent)
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

private fun openNotification(notification: JsonObject, open: (String) -> Unit) {
    val reference = notification.str("reference_id")
    when (notification.str("kind")) {
        "task_completed", "task_failed", "task_question" -> open("run/$reference")
        "question" -> open("conversation/$reference")
        else -> open("notification/${notification.str("id")}")
    }
}

@Composable
fun NotificationDetail(repo: JarvisRepository, id: String, openTask: (String) -> Unit, back: () -> Unit) {
    val palette = jarvisColors()
    val notifications by repo.m2.notifications.collectAsStateWithLifecycle()
    val approvals by repo.m2.approvals.collectAsStateWithLifecycle()
    val notification = notifications.firstOrNull { it.str("id") == id }
    val approval = notification?.str("reference_id")?.let { reference -> approvals.firstOrNull { it.str("id") == reference } }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        TextButton(onClick = back, contentPadding = PaddingValues(0.dp)) {
            Icon(JarvisIcons.Back, null, Modifier.size(15.dp), tint = palette.muted)
            Spacer(Modifier.width(4.dp))
            Text("返回", color = palette.muted)
        }
        if (notification == null) {
            EmptyState("该通知不存在", "它可能已删除，或你无权访问。")
        } else {
            JarvisCard(padding = 18.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Eyebrow("NOTIFICATION")
                    Text(notification.str("title"), style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
                    Text(notification.str("body"), style = MaterialTheme.typography.bodyMedium, color = palette.textDim)
                    Text(fullDateTime(notification.str("created_at")), style = MaterialTheme.typography.labelSmall, color = palette.muted)
                }
            }
            if (approval != null) {
                JarvisCard(padding = 16.dp, color = palette.danger.copy(alpha = 0.06f)) {
                    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Text("需要你的确认", style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                        Text(capabilityLabel(approval.str("capability")), style = MaterialTheme.typography.bodySmall, color = palette.muted)
                        if (approval.str("status") == "pending") {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                PrimaryButton("允许一次", Modifier.weight(1f)) { repo.m2.resolveApproval(approval.str("id"), true) }
                                OutlineButton("拒绝", Modifier.weight(1f)) { repo.m2.resolveApproval(approval.str("id"), false) }
                            }
                        } else {
                            Text("处理状态：${cloud.jarvis.app.statusLabel(approval.str("status"))}", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                        }
                        approval.str("run_id").takeIf { it.isNotBlank() }?.let { runId ->
                            TextButton(onClick = { openTask(runId) }) { Text("查看关联任务 →", color = palette.accent) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SpaceDetail(id: String, navigate: (String) -> Unit) {
    val palette = jarvisColors()
    val names = mapOf("photos" to "照片", "files" to "文件", "knowledge" to "知识", "family" to "家庭", "media" to "媒体", "development" to "开发")
    val descriptions = mapOf(
        "photos" to "可在应用中心查看 Immich 的连接与运行状态。照片时间线、相册与搜索尚未接入此空间；这里的封面是装饰图，不是你的照片。",
        "files" to "文件浏览、上传与权限控制尚未接入。此处不会展示模拟文件或执行文件操作。",
        "knowledge" to "知识库与检索尚未接入。你的对话仍可在 Jarvis 中查看。",
        "family" to "可在应用中心查看 Home Assistant 的连接与运行状态。设备、房间与控制能力尚未接入此空间。",
        "media" to "影音库尚未接入。此处不会展示模拟媒体内容。",
        "development" to "开发空间会把任务与工作区集中在一起。当前可直接查看任务。",
    )
    val name = names[id]
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (name == null) {
            EmptyState("该空间不存在", "请返回首页重新选择。")
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Eyebrow("SPACE")
                Text(name, style = MaterialTheme.typography.headlineLarge, color = palette.textStrong)
            }
            JarvisCard(padding = 18.dp) {
                Text(descriptions[id] ?: "", style = MaterialTheme.typography.bodyMedium, color = palette.textDim)
            }
            when (id) {
                "photos", "family" -> PrimaryButton("查看已安装应用", Modifier.fillMaxWidth()) { navigate("apps") }
                "knowledge" -> PrimaryButton("打开 Jarvis", Modifier.fillMaxWidth()) { navigate("jarvis") }
                "development" -> PrimaryButton("查看开发任务", Modifier.fillMaxWidth()) { navigate("tasks") }
            }
            OutlineButton("返回空间", Modifier.fillMaxWidth()) { navigate("spaces") }
        }
    }
}
