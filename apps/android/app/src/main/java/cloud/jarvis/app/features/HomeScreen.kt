package cloud.jarvis.app.features

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.ConnectionState
import cloud.jarvis.app.JarvisRepository
import cloud.jarvis.app.R
import cloud.jarvis.app.array
import cloud.jarvis.app.bool
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.objects
import cloud.jarvis.app.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private data class SpaceDefinition(
    val id: String,
    val title: String,
    val caption: String,
    val index: String,
    val image: Int,
)

private val spaces = listOf(
    SpaceDefinition("photos", "照片", "在 Immich 中打开", "01", R.drawable.space_photos),
    SpaceDefinition("files", "文件", "尚未接入", "02", R.drawable.space_files),
    SpaceDefinition("knowledge", "知识", "尚未接入", "03", R.drawable.space_knowledge),
    SpaceDefinition("family", "家庭", "在 Home Assistant 中打开", "04", R.drawable.space_family),
    SpaceDefinition("media", "媒体", "尚未接入", "05", R.drawable.space_media),
    SpaceDefinition("development", "开发", "查看任务", "06", R.drawable.space_development),
)

@Composable
fun ProductHome(
    repo: JarvisRepository,
    navigate: (String) -> Unit,
    onVoice: () -> Unit,
    onOpenHermes: () -> Unit,
    openApp: (String) -> Unit = {},
) {
    val palette = jarvisColors()
    val system by repo.system.collectAsStateWithLifecycle()
    val hierarchy by repo.m2.hierarchy.collectAsStateWithLifecycle()
    val conversations by repo.m2.conversations.collectAsStateWithLifecycle()
    val applications by repo.m2.applications.collectAsStateWithLifecycle()
    val catalog by repo.m2.catalog.collectAsStateWithLifecycle()
    val notifications by repo.m2.notifications.collectAsStateWithLifecycle()
    val connection by repo.gateway.state.collectAsStateWithLifecycle()
    var prompt by remember { mutableStateOf("") }
    val runs = hierarchy?.objects("runs").orEmpty()
    val active = runs.filter { it.str("status") in listOf("queued", "starting", "running", "waiting_for_user", "waiting_for_approval") }
    val cpu = system?.get("cpu")?.jsonObject?.get("usage_percent")?.jsonPrimitive?.doubleOrNull
    val memory = system?.get("memory")?.jsonObject?.get("usage_percent")?.jsonPrimitive?.doubleOrNull
    val storage = (system?.get("disks") as? JsonArray)?.firstOrNull()?.jsonObject?.get("usage_percent")?.jsonPrimitive?.doubleOrNull
    val appStatus = applications?.str("status").orEmpty()
    val healthy = system?.get("jarvis")?.jsonObject?.str("server_status") == "healthy" &&
        (appStatus == "ready" || appStatus == "not_configured" || appStatus.isBlank())
    val online = when {
        connection != ConnectionState.online -> null
        system == null -> null
        else -> healthy
    }
    val unread = notifications.count { it.str("read_at").isBlank() }

    fun ask(text: String) {
        if (text.isBlank()) return
        repo.m2.newConversation()
        repo.m2.prefill(text)
        prompt = ""
        navigate("jarvis")
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 8.dp, bottom = 30.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item {
            HomeHero(
                online = online,
                running = active.size,
                prompt = prompt,
                onPromptChange = { prompt = it },
                onAsk = { ask(prompt) },
                onSuggestion = { suggestion -> ask(suggestion) },
                onVoice = onVoice,
                suggestions = listOf("看看家里的近况", "分析最近的任务", "整理工作计划"),
            )
        }
        item { StatusRow(cpu, memory, storage, active.size, onOpenTasks = { navigate("tasks") }) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading("我的空间", eyebrow = "SPACES", action = "全部空间", actionIcon = JarvisIcons.ArrowRight) { navigate("spaces") }
                SpaceTiles(navigate = navigate, openApp = openApp)
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading("我的应用", eyebrow = "CASAOS", action = "应用中心", actionIcon = JarvisIcons.ArrowRight) { navigate("apps") }
                ProductApplications(
                    value = applications,
                    refresh = { repo.m2.refreshApplications() },
                    openApp = openApp,
                    askApp = { repo.m2.askAboutApp(it); navigate("jarvis") },
                    catalog = catalog,
                    account = repo.account,
                    compact = true,
                    limit = 4,
                    onOpenFull = { navigate("apps") },
                )
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SectionHeading("当前任务", compact = true, action = "全部") { navigate("tasks") }
                    JarvisCard(padding = 14.dp) {
                        if (active.isEmpty()) {
                            EmptyState("此刻一切安静", "有想做的事，随时告诉 Jarvis。", glyph = "◇")
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                active.take(3).forEach { run ->
                                    Row(
                                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                                            .background(palette.surface2)
                                            .border(1.dp, palette.line, RoundedCornerShape(10.dp))
                                            .clickable { navigate("run/${run.str("id")}") }
                                            .padding(horizontal = 10.dp, vertical = 9.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Box(Modifier.size(6.dp).background(palette.accent, CircleShape))
                                        Spacer(Modifier.width(8.dp))
                                        Column(Modifier.weight(1f)) {
                                            Text(run.str("goal"), style = MaterialTheme.typography.bodySmall, color = palette.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                            Text(cloud.jarvis.app.statusLabel(run.str("status")), style = MaterialTheme.typography.labelSmall, color = palette.muted)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SectionHeading("最近对话", compact = true, action = "打开") { navigate("jarvis") }
                    JarvisCard(padding = 14.dp) {
                        if (conversations.isEmpty()) {
                            EmptyState("从一次对话开始", "你的对话与任务进展会汇集在这里。", glyph = "◇")
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                conversations.take(4).forEach { conversation ->
                                    Row(
                                        Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp))
                                            .background(palette.surface2)
                                            .clickable {
                                                repo.m2.selectConversation(conversation.str("id"))
                                                navigate("conversation/${conversation.str("id")}")
                                            }
                                            .padding(horizontal = 10.dp, vertical = 9.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Box(Modifier.size(5.dp).background(palette.sage, CircleShape))
                                        Spacer(Modifier.width(8.dp))
                                        Text(
                                            conversation.str("title"),
                                            Modifier.weight(1f),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = palette.text,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        item {
            VoiceInviteCard(onVoice = onVoice, unread = unread)
        }
        item {
            JarvisCard(onClick = onOpenHermes, padding = 18.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(42.dp).background(palette.accentSoft, RoundedCornerShape(13.dp)),
                        contentAlignment = Alignment.Center,
                    ) { Icon(JarvisIcons.Sparkle, null, Modifier.size(20.dp), tint = palette.accent) }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Eyebrow("HERMES AGENT")
                        Text("模型、技能与 MCP", style = MaterialTheme.typography.titleMedium, color = palette.textStrong)
                        Text("在 Hermes 官方界面管理，并继续使用当前 Jarvis 登录。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                    }
                    Icon(JarvisIcons.ArrowRight, null, Modifier.size(17.dp), tint = palette.accent)
                }
            }
        }
    }
}

@Composable
private fun HomeHero(
    online: Boolean?,
    running: Int,
    prompt: String,
    onPromptChange: (String) -> Unit,
    onAsk: () -> Unit,
    onSuggestion: (String) -> Unit,
    onVoice: () -> Unit,
    suggestions: List<String>,
) {
    val palette = jarvisColors()
    Box(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(
                Brush.linearGradient(
                    listOf(palette.hero1, palette.hero2, palette.hero3),
                ),
            )
            .border(1.dp, palette.line, RoundedCornerShape(24.dp)),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(5.dp)
                            .background(
                                if (online == false) palette.danger else palette.sage,
                                CircleShape,
                            ),
                    )
                    Spacer(Modifier.width(7.dp))
                    Eyebrow("YOUR PRIVATE CLOUD")
                }
                JarvisOrb(44.dp, mode = if (online == null) OrbMode.Thinking else OrbMode.Idle)
            }
            Text(
                "让科技，回归生活。",
                style = MaterialTheme.typography.displaySmall.copy(fontSize = 29.sp, lineHeight = 37.sp),
                color = palette.textStrong,
            )
            Text(
                when (online) {
                    null -> "正在连接你的私人云…"
                    true -> "服务器在线，应用状态已同步 · " + if (running > 0) "$running 个任务进行中" else "此刻一切安静"
                    false -> "你的私人云有状态需要关注"
                },
                style = MaterialTheme.typography.bodySmall,
                color = palette.muted,
            )
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(palette.background.copy(alpha = if (palette.light) 0.55f else 0.62f))
                    .border(1.dp, palette.accent.copy(alpha = 0.3f), RoundedCornerShape(16.dp))
                    .padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                JarvisOrb(26.dp)
                Spacer(Modifier.width(9.dp))
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (prompt.isEmpty()) {
                        Text("问 Jarvis，或描述你想做的事…", style = MaterialTheme.typography.bodyMedium, color = palette.muted2, maxLines = 1)
                    }
                    BasicTextField(
                        value = prompt,
                        onValueChange = onPromptChange,
                        textStyle = TextStyle(color = palette.text, fontSize = 14.sp, lineHeight = 20.sp),
                        singleLine = true,
                        cursorBrush = androidx.compose.ui.graphics.SolidColor(palette.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { onAsk() }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Surface(
                    onClick = onVoice,
                    shape = CircleShape,
                    color = palette.surface2,
                    modifier = Modifier.size(38.dp),
                ) { Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Mic, "语音通话", Modifier.size(18.dp), tint = palette.accent) } }
                Spacer(Modifier.width(5.dp))
                Surface(
                    onClick = onAsk,
                    shape = CircleShape,
                    color = if (prompt.isBlank()) palette.surface3 else palette.accent,
                    modifier = Modifier.size(38.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(JarvisIcons.Send, "发送给 Jarvis", Modifier.size(18.dp), tint = if (prompt.isBlank()) palette.muted2 else palette.accentInk)
                    }
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                suggestions.forEach { suggestion ->
                    Pill(suggestion, color = palette.accent, background = palette.accentSoft, onClick = { onSuggestion(suggestion) })
                }
            }
        }
    }
}

@Composable
private fun StatusRow(cpu: Double?, memory: Double?, storage: Double?, running: Int, onOpenTasks: () -> Unit) {
    val palette = jarvisColors()
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        JarvisCard(padding = 15.dp, modifier = Modifier.weight(1f).fillMaxHeight()) {
            Column(verticalArrangement = Arrangement.spacedBy(13.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(5.dp).background(palette.sage, CircleShape))
                    Spacer(Modifier.width(7.dp))
                    Eyebrow("系统状态")
                }
                MetricBar("CPU", cpu)
                MetricBar("内存", memory)
                MetricBar("存储", storage)
            }
        }
        JarvisCard(padding = 15.dp, modifier = Modifier.width(124.dp).fillMaxHeight(), onClick = onOpenTasks) {
            Column(Modifier.fillMaxHeight(), verticalArrangement = Arrangement.SpaceBetween) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Eyebrow(if (running > 0) "JARVIS 正在工作" else "队列空闲")
                    Text("$running", style = MaterialTheme.typography.displaySmall.copy(fontSize = 34.sp), color = palette.textStrong)
                    Text("个任务", style = MaterialTheme.typography.labelSmall, color = palette.muted)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Icon(JarvisIcons.ArrowRight, null, Modifier.size(17.dp), tint = palette.accent)
                }
            }
        }
    }
}

@Composable
private fun VoiceInviteCard(onVoice: () -> Unit, unread: Int) {
    val palette = jarvisColors()
    Box(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Brush.linearGradient(listOf(palette.accentSoft, palette.surface)))
            .border(1.dp, palette.accent.copy(alpha = 0.22f), RoundedCornerShape(20.dp)),
    ) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            JarvisOrb(58.dp, mode = OrbMode.Speaking, animated = false)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Eyebrow("VOICE CALL")
                Text("和 Jarvis 打个电话", style = MaterialTheme.typography.titleMedium, color = palette.textStrong)
                Text(
                    "像豆包一样自然地说，边听边回答，随时打断。",
                    style = MaterialTheme.typography.bodySmall,
                    color = palette.muted,
                )
            }
            Surface(onClick = onVoice, shape = CircleShape, color = palette.accent, modifier = Modifier.size(46.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Phone, "开始语音通话", Modifier.size(20.dp), tint = palette.accentInk) }
            }
        }
    }
}

@Composable
fun SpaceTiles(navigate: (String) -> Unit, openApp: ((String) -> Unit)? = null) {
    val palette = jarvisColors()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        spaces.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { space ->
                    Box(
                        Modifier.weight(1f)
                            .height(126.dp)
                            .clip(RoundedCornerShape(17.dp))
                            .border(1.dp, palette.line, RoundedCornerShape(17.dp))
                            .clickable {
                                when {
                                    openApp != null && (space.id == "photos" || space.id == "family") ->
                                        openApp(if (space.id == "photos") "immich" else "homeassistant")
                                    openApp != null && space.id == "development" -> navigate("tasks")
                                    else -> navigate("space/${space.id}")
                                }
                            },
                    ) {
                        Image(
                            painterResource(space.image),
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.matchParentSize(),
                        )
                        Box(
                            Modifier.matchParentSize().background(
                                Brush.verticalGradient(listOf(Color.Transparent, palette.background.copy(alpha = 0.85f))),
                            ),
                        )
                        Column(Modifier.align(Alignment.TopStart).padding(12.dp)) {
                            Text(space.index, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.55f))
                        }
                        Column(Modifier.align(Alignment.BottomStart).padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(space.title, style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(space.caption, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.62f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ProductEmpty(title: String, subtitle: String) {
    EmptyState(title, subtitle, glyph = "◇")
}


/** Backwards-compatible entry point used by the Compose ui test. */
@Composable
fun SpaceTiles(navigate: (String) -> Unit) {
    SpaceTiles(navigate = navigate, openApp = null)
}
