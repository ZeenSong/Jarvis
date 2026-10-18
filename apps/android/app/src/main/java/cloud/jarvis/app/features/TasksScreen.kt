package cloud.jarvis.app.features

import android.app.DatePickerDialog
import android.app.TimePickerDialog
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.JarvisRepository
import cloud.jarvis.app.capabilityLabel
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.fullDateTime
import cloud.jarvis.app.int
import cloud.jarvis.app.long
import cloud.jarvis.app.objects
import cloud.jarvis.app.shortDateTime
import cloud.jarvis.app.statusLabel
import cloud.jarvis.app.str
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.util.Calendar

private val waitingStatuses = setOf("waiting_for_user", "waiting_for_approval", "waiting_question")
private val activeStatuses = setOf("queued", "starting", "running")
private val finishedStatuses = setOf("completed", "failed", "cancelled")

private fun groupOf(run: JsonObject): String = when (run.str("status")) {
    in waitingStatuses -> "待处理"
    in activeStatuses -> "进行中"
    in finishedStatuses -> "已结束"
    else -> "状态待确认"
}

@Composable
fun ProductTasks(repo: JarvisRepository, open: (String) -> Unit) {
    val palette = jarvisColors()
    val hierarchy by repo.m2.hierarchy.collectAsStateWithLifecycle()
    val approvals by repo.m2.approvals.collectAsStateWithLifecycle()
    val schedules by repo.m2.schedules.collectAsStateWithLifecycle()
    val runs = hierarchy?.objects("runs").orEmpty()
    val pending = approvals.filter { it.str("status") == "pending" }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Eyebrow("TASKS")
            Text("任务", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
            Text("每一件交给 Jarvis 的事，都有迹可循。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
        }

        if (pending.isNotEmpty()) {
            JarvisCard(padding = 16.dp, color = palette.danger.copy(alpha = 0.07f)) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SectionHeading("待处理", eyebrow = "ACTION REQUIRED", subtitle = "${pending.size} 项需要你的确认")
                    pending.forEach { approval ->
                        ApprovalTask(approval) { approved ->
                            repo.m2.resolveApproval(approval.str("id"), approved)
                        }
                    }
                }
            }
        }

        TaskList(runs, open)

        SchedulePanel(
            schedules = schedules,
            onCreate = { prompt, cadence, millis ->
                repo.m2.createSchedule(prompt, cadence, Instant.ofEpochMilli(millis).toString())
            },
            onToggle = { id, enabled -> repo.m2.toggleSchedule(id, enabled) },
            onDelete = { id -> repo.m2.deleteSchedule(id) },
            onRefresh = { repo.refresh() },
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ApprovalTask(approval: JsonObject, resolve: (Boolean) -> Unit) {
    val palette = jarvisColors()
    var expanded by remember(approval.str("id")) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth()
            .background(palette.surface2, RoundedCornerShape(13.dp))
            .border(1.dp, palette.line, RoundedCornerShape(13.dp))
            .padding(13.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(capabilityLabel(approval.str("capability")), style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                Text(
                    (approval.str("run_id").take(8).takeIf { it.isNotBlank() }?.let { "任务 $it" } ?: "手动请求") +
                        " · 有效期 ${shortDateTime(approval.str("expires_at"))}",
                    style = MaterialTheme.typography.labelSmall,
                    color = palette.muted,
                )
            }
            StatusBadge("待批准", palette.danger)
        }
        if (approval["input"] != null) {
            TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(0.dp)) {
                Text(if (expanded) "收起执行参数" else "查看执行参数", style = MaterialTheme.typography.labelSmall, color = palette.accent)
            }
            if (expanded) {
                Text(
                    approval["input"].toString(),
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace),
                    color = palette.muted,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(palette.background, RoundedCornerShape(9.dp))
                        .padding(9.dp),
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton("批准", Modifier.weight(1f)) { resolve(true) }
            OutlineButton("拒绝", Modifier.weight(1f)) { resolve(false) }
        }
    }
}

@Composable
fun TaskList(runs: List<JsonObject>, open: (String) -> Unit) {
    val palette = jarvisColors()
    var filter by remember { mutableStateOf("全部") }
    var query by remember { mutableStateOf("") }
    val visible = runs.filter { (filter == "全部" || groupOf(it) == filter) && it.str("goal").contains(query.trim(), ignoreCase = true) }
    val groups = listOf("待处理", "进行中", "已结束")
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            groups.forEach { group ->
                val selected = filter == group
                val count = runs.count { groupOf(it) == group }
                Surface(
                    onClick = { filter = if (selected) "全部" else group },
                    shape = RoundedCornerShape(13.dp),
                    color = if (selected) palette.accentSoft else palette.surface,
                    border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) palette.accent.copy(alpha = 0.35f) else palette.line),
                    modifier = Modifier.weight(1f),
                ) {
                    Column(Modifier.padding(vertical = 10.dp, horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("$group · $count", style = MaterialTheme.typography.labelMedium, color = if (selected) palette.accent else palette.muted, maxLines = 1)
                        Text("$count", style = MaterialTheme.typography.headlineSmall, color = if (selected) palette.accent else palette.textStrong)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                onClick = { filter = "全部" },
                shape = CircleShape,
                color = if (filter == "全部") palette.accentSoft else palette.surface2,
                border = androidx.compose.foundation.BorderStroke(1.dp, if (filter == "全部") palette.accent.copy(alpha = 0.3f) else palette.line),
            ) {
                Text(
                    "全部 · ${runs.size}",
                    Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (filter == "全部") palette.accent else palette.muted,
                )
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("搜索任务", style = MaterialTheme.typography.bodySmall) },
                singleLine = true,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(11.dp),
                textStyle = MaterialTheme.typography.bodySmall,
            )
        }
        when {
            runs.isEmpty() -> EmptyState("还没有任务", "向 Jarvis 描述你的目标，随时查看进展。", action = null)
            visible.isEmpty() -> EmptyState("没有符合条件的任务", "试试其他关键词或筛选条件。")
            else -> groups.filter { filter == "全部" || filter == it }.forEach { group ->
                val items = runs.filter { groupOf(it) == group && it in visible }
                if (items.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Eyebrow(group)
                            Spacer(Modifier.width(8.dp))
                            Text("${items.size}", style = MaterialTheme.typography.labelSmall, color = palette.muted)
                        }
                        items.forEach { run ->
                            TaskRow(run, onClick = { open(run.str("id")) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskRow(run: JsonObject, onClick: () -> Unit) {
    val palette = jarvisColors()
    val group = groupOf(run)
    val dot = when (group) {
        "待处理" -> palette.danger
        "进行中" -> palette.accent
        "已结束" -> palette.sage
        else -> palette.muted
    }
    Row(
        Modifier.fillMaxWidth()
            .background(palette.surface, RoundedCornerShape(14.dp))
            .border(1.dp, palette.line, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(7.dp).background(dot, CircleShape))
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(run.str("goal"), style = MaterialTheme.typography.bodyMedium, color = palette.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(statusLabel(run.str("status")), style = MaterialTheme.typography.labelSmall, color = dot)
                run.str("agent_id").takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = palette.muted2, maxLines = 1)
                }
            }
        }
        Icon(JarvisIcons.ArrowRight, null, Modifier.size(16.dp), tint = palette.muted2)
    }
}

@Composable
private fun SchedulePanel(
    schedules: List<JsonObject>,
    onCreate: (String, String, Long) -> Unit,
    onToggle: (String, Boolean) -> Unit,
    onDelete: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    val palette = jarvisColors()
    val context = LocalContext.current
    var prompt by remember { mutableStateOf("") }
    var cadence by remember { mutableStateOf("once") }
    var nextRun by remember { mutableStateOf(System.currentTimeMillis() + 3_600_000L) }
    fun pickDateTime() {
        val calendar = Calendar.getInstance().apply { timeInMillis = nextRun }
        DatePickerDialog(context, { _, year, month, day ->
            val picked = Calendar.getInstance().apply {
                timeInMillis = nextRun
                set(Calendar.YEAR, year); set(Calendar.MONTH, month); set(Calendar.DAY_OF_MONTH, day)
            }
            TimePickerDialog(context, { _, hour, minute ->
                picked.set(Calendar.HOUR_OF_DAY, hour); picked.set(Calendar.MINUTE, minute); picked.set(Calendar.SECOND, 0)
                nextRun = picked.timeInMillis
            }, calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE), true).show()
        }, calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH)).show()
    }
    JarvisCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionHeading(
                "定时任务",
                eyebrow = "AUTOMATIONS",
                subtitle = "把重复性的事情交给 Jarvis。",
                action = "刷新",
                onAction = onRefresh,
            )
            OutlinedTextField(
                value = prompt,
                onValueChange = { prompt = it },
                placeholder = { Text("例如：每天早上汇总服务器状态", style = MaterialTheme.typography.bodySmall) },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(11.dp),
                textStyle = MaterialTheme.typography.bodySmall,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("once" to "一次", "daily" to "每天", "weekly" to "每周").forEach { (value, label) ->
                    FilterChip(
                        selected = cadence == value,
                        onClick = { cadence = value },
                        label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = palette.accentSoft,
                            selectedLabelColor = palette.accent,
                        ),
                    )
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlineButton(shortDateTime(Instant.ofEpochMilli(nextRun).toString()), Modifier.weight(1f)) { pickDateTime() }
                PrimaryButton("添加任务", enabled = prompt.isNotBlank()) {
                    onCreate(prompt.trim(), cadence, nextRun)
                    prompt = ""
                }
            }
            if (schedules.isEmpty()) {
                Text("还没有定时任务。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
            } else {
                schedules.forEach { schedule ->
                    Row(
                        Modifier.fillMaxWidth()
                            .background(palette.surface2, RoundedCornerShape(12.dp))
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(schedule.str("prompt"), style = MaterialTheme.typography.bodySmall, color = palette.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(
                                (if (schedule["enabled"]?.toString() == "true") "启用" else "已停用") + " · " + shortDateTime(schedule.str("next_run_at")),
                                style = MaterialTheme.typography.labelSmall,
                                color = palette.muted,
                            )
                        }
                        TextButton(onClick = { onToggle(schedule.str("id"), schedule["enabled"]?.toString() != "true") }) {
                            Text(if (schedule["enabled"]?.toString() == "true") "停用" else "启用", color = palette.accent, style = MaterialTheme.typography.labelSmall)
                        }
                        TextButton(onClick = { onDelete(schedule.str("id")) }) {
                            Text("删除", color = palette.danger, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}
