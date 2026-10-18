package cloud.jarvis.app.features

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.JarvisRepository
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.objects
import cloud.jarvis.app.statusLabel
import cloud.jarvis.app.str
import kotlinx.serialization.json.JsonObject

@Composable
fun HermesCenterScreen(
    repo: JarvisRepository,
    openRun: (String) -> Unit,
    openHermes: () -> Unit,
    openAi: () -> Unit,
) {
    val palette = jarvisColors()
    val hierarchy by repo.m2.hierarchy.collectAsStateWithLifecycle()
    val agents by repo.agents.collectAsStateWithLifecycle()
    val definitions = hierarchy?.objects("definitions").orEmpty()
    val runs = hierarchy?.objects("runs").orEmpty()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(
            Modifier.fillMaxWidth()
                .background(
                    Brush.linearGradient(listOf(palette.hero1, palette.hero2, palette.hero3)),
                    RoundedCornerShape(22.dp),
                )
                .border(1.dp, palette.line, RoundedCornerShape(22.dp))
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                JarvisOrb(52.dp, mode = OrbMode.Thinking)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Eyebrow("CORE")
                    Text("◈ Jarvis", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
                    Text("对话、委派与结果汇总。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                }
            }
        }

        JarvisCard(padding = 17.dp) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Eyebrow("HERMES AGENT")
                    Text("模型、技能与 MCP", style = MaterialTheme.typography.titleMedium, color = palette.textStrong)
                    Text("使用 Hermes 官方界面管理；打开后会继续使用当前 Jarvis 登录状态。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                }
                Surface(onClick = openHermes, shape = CircleShape, color = palette.accent, modifier = Modifier.size(42.dp)) {
                    Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.ArrowRight, "打开 Hermes 控制台", Modifier.size(18.dp), tint = palette.accentInk) }
                }
            }
        }

        SectionHeading("领域智能体", eyebrow = "MANAGED AGENTS", action = "AI 用量", onAction = openAi)
        if (definitions.none { it.str("tier") == "managed" }) {
            EmptyState("暂无领域智能体", "Hermes 注册后会出现在这里。", glyph = "◇")
        } else {
            definitions.filter { it.str("tier") == "managed" }.forEach { definition ->
                JarvisCard(padding = 15.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(38.dp)
                                .background(palette.accentSoft, RoundedCornerShape(12.dp)),
                            contentAlignment = Alignment.Center,
                        ) { Text("◇", color = palette.accent, style = MaterialTheme.typography.titleMedium) }
                        Spacer(Modifier.width(11.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(definition.str("name"), style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                            Text(
                                definition.str("description").ifBlank { "按能力路由的${definition.str("role").ifBlank { "通用" }}执行器" },
                                style = MaterialTheme.typography.bodySmall,
                                color = palette.muted,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        StatusBadge(
                            if (definition["available"]?.toString() == "false") "不可用" else definition.str("runtime_type").ifBlank { "在线" },
                            if (definition["available"]?.toString() == "false") palette.danger else palette.sage,
                        )
                    }
                }
            }
        }

        SectionHeading("执行实例与任务", eyebrow = "RUNS", subtitle = "${runs.size} 个任务记录")
        if (runs.isEmpty()) {
            EmptyState("还没有执行记录", "从 Jarvis 交办一件事，任务会在这里留下轨迹。")
        } else {
            runs.take(20).forEach { run ->
                Row(
                    Modifier.fillMaxWidth()
                        .background(palette.surface, RoundedCornerShape(13.dp))
                        .border(1.dp, palette.line, RoundedCornerShape(13.dp))
                        .padding(horizontal = 13.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(6.dp).background(
                            when (run.str("status")) {
                                "completed" -> palette.sage
                                "failed", "cancelled" -> palette.danger
                                else -> palette.accent
                            },
                            CircleShape,
                        ),
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(run.str("goal"), style = MaterialTheme.typography.bodySmall, color = palette.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(statusLabel(run.str("status")), style = MaterialTheme.typography.labelSmall, color = palette.muted)
                    }
                    TextButton(onClick = { openRun(run.str("id")) }) { Text("查看", color = palette.accent, style = MaterialTheme.typography.labelMedium) }
                }
            }
        }

        if (agents.isNotEmpty()) {
            SectionHeading("监控 Agent", eyebrow = "M1 AGENTS", subtitle = "在线状态与运行时")
            agents.forEach { agent ->
                Row(
                    Modifier.fillMaxWidth()
                        .background(palette.surface2, RoundedCornerShape(11.dp))
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(agent.str("name"), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = palette.text)
                    Text(agent.str("runtime"), style = MaterialTheme.typography.labelSmall, color = palette.muted)
                    Spacer(Modifier.width(8.dp))
                    StatusBadge(statusLabel(agent.str("status")), if (agent.str("status") in listOf("offline", "degraded", "error")) palette.danger else palette.sage)
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
