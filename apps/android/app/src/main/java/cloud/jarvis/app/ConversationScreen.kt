package cloud.jarvis.app

import android.graphics.BitmapFactory
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.dynamicui.SemanticView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.time.Duration
import java.time.Instant

// ---------------------------------------------------------------------------
// Markdown: deliberately small and safe. It never renders HTML, never executes
// links and keeps code blocks selectable.
// ---------------------------------------------------------------------------

private sealed interface MarkdownBlock {
    data class Text(val value: String, val level: Int = 0) : MarkdownBlock
    data class Code(val value: String, val language: String = "") : MarkdownBlock
    data class Quote(val value: String) : MarkdownBlock
    data class ListItems(val ordered: Boolean, val values: List<String>) : MarkdownBlock
    data class Table(val rows: List<List<String>>) : MarkdownBlock
    data object Rule : MarkdownBlock
    data object Break : MarkdownBlock
}

private fun parseMarkdown(value: String): List<MarkdownBlock> {
    val lines = value.split('\n')
    val blocks = mutableListOf<MarkdownBlock>()
    var i = 0
    fun cells(line: String) = line.trim().removePrefix("|").removeSuffix("|").split('|').map(String::trim)
    while (i < lines.size) {
        val line = lines[i]
        if (line.trim().startsWith("```")) {
            val language = line.trim().removePrefix("```").trim()
            i++
            val code = buildList { while (i < lines.size && !lines[i].trim().startsWith("```")) add(lines[i++]); if (i < lines.size) i++ }
            blocks += MarkdownBlock.Code(code.joinToString("\n"), language)
            continue
        }
        if (line.trim().matches(Regex("^([-*_])\\1{2,}\\s*$"))) {
            blocks += MarkdownBlock.Rule; i++; continue
        }
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            val rows = buildList {
                while (i < lines.size && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
                    val row = cells(lines[i++])
                    if (!row.all { it.matches(Regex(":?-{3,}:?")) }) add(row)
                }
            }
            if (rows.isNotEmpty()) blocks += MarkdownBlock.Table(rows)
            continue
        }
        if (line.isBlank()) { blocks += MarkdownBlock.Break; i++; continue }
        val heading = Regex("^(#{1,4})\\s+(.+)").find(line)
        if (heading != null) {
            blocks += MarkdownBlock.Text(heading.groupValues[2], heading.groupValues[1].length)
            i++
            continue
        }
        if (line.trimStart().startsWith('>')) {
            val quote = buildList {
                while (i < lines.size && lines[i].trimStart().startsWith('>')) add(lines[i++].trimStart().removePrefix("> ").removePrefix(">"))
            }
            blocks += MarkdownBlock.Quote(quote.joinToString("\n"))
            continue
        }
        val marker = Regex("^\\s*([-+*]|\\d+[.)])\\s+(.+)").find(line)
        if (marker != null) {
            val ordered = marker.groupValues[1][0].isDigit()
            val values = buildList {
                while (i < lines.size) {
                    val item = Regex("^\\s*([-+*]|\\d+[.)])\\s+(.+)").find(lines[i]) ?: break
                    if (item.groupValues[1][0].isDigit() != ordered) break
                    add(item.groupValues[2]); i++
                }
            }
            blocks += MarkdownBlock.ListItems(ordered, values)
            continue
        }
        val paragraph = buildList {
            while (i < lines.size && lines[i].isNotBlank() &&
                !lines[i].trimStart().startsWith("```") &&
                !lines[i].matches(Regex("^#{1,4}\\s+.+")) &&
                !lines[i].trimStart().startsWith('>') &&
                !lines[i].matches(Regex("^\\s*([-+*]|\\d+[.)])\\s+.+")) &&
                !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|'))
            ) add(lines[i++])
        }
        blocks += MarkdownBlock.Text(paragraph.joinToString(" "))
    }
    return blocks
}

@Composable
private fun MarkdownInline(value: String, style: TextStyle = MaterialTheme.typography.bodyMedium) {
    val palette = jarvisColors()
    val uriHandler = LocalUriHandler.current
    val text = buildAnnotatedString {
        val token = Regex("(`[^`\\n]+`|~~[^~\\n]+~~|\\[([^]]+)\\]\\((https?://[^)\\s]+)\\)|\\*\\*([^*\\n]+)\\*\\*|__([^_\\n]+)__|(?<!\\*)\\*([^*\\n]+)\\*(?!\\*)|(?<!_)_([^_\\n]+)_(?!_))")
        var last = 0
        token.findAll(value).forEach { match ->
            append(value.substring(last, match.range.first))
            when {
                match.value.startsWith('`') -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = palette.accentSoft, color = palette.accentStrong)) { append(match.value.drop(1).dropLast(1)) }
                match.value.startsWith("~~") -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough, color = palette.muted)) { append(match.value.drop(2).dropLast(2)) }
                match.groupValues[3].isNotEmpty() -> {
                    pushStringAnnotation("url", match.groupValues[3])
                    withStyle(SpanStyle(color = palette.accent, textDecoration = TextDecoration.Underline)) { append(match.groupValues[2]) }
                    pop()
                }
                match.groupValues[4].isNotEmpty() || match.groupValues[5].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = palette.textStrong)) {
                    append(match.groupValues[4].ifEmpty { match.groupValues[5] })
                }
                else -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(match.groupValues[6].ifEmpty { match.groupValues[7] }) }
            }
            last = match.range.last + 1
        }
        append(value.substring(last))
    }
    ClickableText(text, style = style.copy(color = palette.text), onClick = { offset ->
        text.getStringAnnotations("url", offset, offset).firstOrNull()?.let { uriHandler.openUri(it.item) }
    })
}

private sealed interface ImageState {
    data object Loading : ImageState
    data class Ready(val bitmap: ImageBitmap) : ImageState
    data class Failed(val reason: String?) : ImageState
}

@Composable
private fun AssistantImage(path: String, load: suspend (String) -> ByteArray) {
    val palette = jarvisColors()
    var retry by remember(path) { mutableIntStateOf(0) }
    var expanded by remember(path) { mutableStateOf(false) }
    val state by produceState<ImageState>(ImageState.Loading, path, retry) {
        value = ImageState.Loading
        value = try {
            val bitmap = withContext(Dispatchers.IO) {
                val bytes = load(path)
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                require(bounds.outWidth in 1..8192 && bounds.outHeight in 1..8192)
                val options = BitmapFactory.Options().apply {
                    inSampleSize = 1
                    while (bounds.outWidth / inSampleSize > 1600 || bounds.outHeight / inSampleSize > 1600) inSampleSize *= 2
                }
                requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)).asImageBitmap()
            }
            ImageState.Ready(bitmap)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            ImageState.Failed(error.message)
        }
    }
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = palette.surface2),
        border = androidx.compose.foundation.BorderStroke(1.dp, palette.line),
    ) {
        when (val image = state) {
            ImageState.Loading -> Box(Modifier.fillMaxWidth().aspectRatio(16f / 10f), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = palette.accent)
            }
            is ImageState.Failed -> Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("图片暂不可用", color = palette.muted, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { retry++ }) { Text("重新加载", color = palette.accent) }
            }
            is ImageState.Ready -> Image(
                image.bitmap,
                "Jarvis 返回的图片",
                Modifier.fillMaxWidth().heightIn(max = 440.dp).clickable { expanded = true },
                contentScale = ContentScale.Fit,
            )
        }
    }
    if (expanded && state is ImageState.Ready) {
        Dialog(onDismissRequest = { expanded = false }) {
            Surface(shape = RoundedCornerShape(20.dp), color = palette.surface) {
                Column(Modifier.padding(10.dp)) {
                    Image((state as ImageState.Ready).bitmap, "Jarvis 返回的图片", Modifier.fillMaxWidth().heightIn(max = 680.dp), contentScale = ContentScale.Fit)
                    TextButton(onClick = { expanded = false }, modifier = Modifier.align(Alignment.End)) { Text("关闭") }
                }
            }
        }
    }
}

@Composable
private fun MarkdownMessage(value: String, modifier: Modifier = Modifier) {
    val palette = jarvisColors()
    val clipboard = LocalClipboardManager.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        parseMarkdown(value).forEach { block ->
            when (block) {
                is MarkdownBlock.Text -> {
                    val style = when (block.level) {
                        1 -> MaterialTheme.typography.headlineSmall
                        2 -> MaterialTheme.typography.titleLarge
                        3 -> MaterialTheme.typography.titleMedium
                        else -> MaterialTheme.typography.bodyLarge
                    }
                    MarkdownInline(block.value, style)
                }
                is MarkdownBlock.Code -> Column(
                    Modifier.fillMaxWidth()
                        .background(palette.background.copy(alpha = 0.6f), RoundedCornerShape(11.dp))
                        .border(1.dp, palette.line, RoundedCornerShape(11.dp)),
                ) {
                    Row(
                        Modifier.fillMaxWidth().background(palette.surface2, RoundedCornerShape(topStart = 11.dp, topEnd = 11.dp)).padding(horizontal = 11.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(block.language.ifBlank { "code" }, style = MaterialTheme.typography.labelSmall, color = palette.muted)
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { clipboard.setText(AnnotatedString(block.value)) }, contentPadding = PaddingValues(0.dp)) {
                            Text("复制", style = MaterialTheme.typography.labelSmall, color = palette.accent)
                        }
                    }
                    SelectionContainer {
                        Text(
                            block.value,
                            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(11.dp),
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall,
                            color = palette.textDim,
                        )
                    }
                }
                is MarkdownBlock.Quote -> Row(Modifier.fillMaxWidth()) {
                    Box(Modifier.width(2.dp).heightIn(min = 20.dp).background(palette.accent.copy(alpha = 0.6f), CircleShape))
                    Spacer(Modifier.width(10.dp))
                    MarkdownInline(block.value, MaterialTheme.typography.bodyMedium.copy(color = palette.muted))
                }
                is MarkdownBlock.ListItems -> Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    block.values.forEachIndexed { index, item ->
                        Row(Modifier.fillMaxWidth()) {
                            Text(if (block.ordered) "${index + 1}." else "·", Modifier.width(22.dp), style = MaterialTheme.typography.bodyMedium, color = palette.accent)
                            MarkdownInline(item, MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
                is MarkdownBlock.Table -> Column(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).border(1.dp, palette.line, RoundedCornerShape(10.dp)),
                ) {
                    block.rows.forEachIndexed { rowIndex, row ->
                        Row(Modifier.background(if (rowIndex == 0) palette.surface2 else Color.Transparent)) {
                            row.forEach { cell ->
                                Text(
                                    cell,
                                    Modifier.widthIn(min = 96.dp).padding(horizontal = 10.dp, vertical = 8.dp),
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = if (rowIndex == 0) FontWeight.SemiBold else FontWeight.Normal,
                                    color = if (rowIndex == 0) palette.textStrong else palette.textDim,
                                )
                            }
                        }
                        if (rowIndex < block.rows.size - 1) HorizontalDivider(color = palette.line)
                    }
                }
                MarkdownBlock.Rule -> HorizontalDivider(color = palette.line)
                MarkdownBlock.Break -> Spacer(Modifier.height(1.dp))
            }
        }
    }
}

@Composable
private fun AssistantMessage(value: String, load: suspend (String) -> ByteArray) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        assistantContentParts(value).forEachIndexed { index, part ->
            key("$index:$part") {
                when (part) {
                    is AssistantContentPart.Text -> if (part.value.isNotBlank()) MarkdownMessage(part.value.trim('\n'))
                    is AssistantContentPart.Image -> AssistantImage(part.path, load)
                }
            }
        }
    }
}

@Composable
private fun UserMessage(value: String) {
    val palette = jarvisColors()
    val answer = remember(value) { Regex("^用户已回答问题：([\\s\\S]*?)\\n回答：([\\s\\S]*?)\\n请根据此回答继续原任务。$").matchEntire(value) }
    if (answer == null) {
        MarkdownMessage(value)
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("对「${answer.groupValues[1]}」的回答", style = MaterialTheme.typography.labelSmall, color = palette.accentInk.copy(alpha = 0.8f))
            Text(answer.groupValues[2], fontWeight = FontWeight.SemiBold, color = palette.accentInk)
        }
    }
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(
    repo: M2Repository,
    openRun: (String) -> Unit,
    openView: (String) -> Unit,
    openWorkspace: () -> Unit,
    onVoice: () -> Unit = {},
    developer: Boolean = false,
) {
    val palette = jarvisColors()
    val conversations by repo.conversations.collectAsStateWithLifecycle()
    val current by repo.conversation.collectAsStateWithLifecycle()
    val sending by repo.sending.collectAsStateWithLifecycle()
    val draft by repo.draft.collectAsStateWithLifecycle()
    val options by repo.composerOptions.collectAsStateWithLifecycle()
    val resources by repo.resources.collectAsStateWithLifecycle()
    val liveReply by repo.liveReply.collectAsStateWithLifecycle()
    val selectedId by repo.selectedConversationId.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var reasoning by remember { mutableStateOf<String?>(null) }
    var selectedSkills by remember { mutableStateOf(setOf<String>()) }
    var skillsOpen by remember { mutableStateOf(false) }
    var reasoningOpen by remember { mutableStateOf(false) }
    var historyOpen by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<JsonObject?>(null) }
    var followLatest by remember { mutableStateOf(true) }

    LaunchedEffect(draft) {
        if (draft.isNotBlank()) { text = draft; repo.clearDraft() }
    }
    val efforts = options?.get("reasoning_efforts")?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
    val skills = options?.get("skills")?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()
    LaunchedEffect(efforts) {
        if (reasoning == null && efforts.isNotEmpty()) reasoning = efforts.firstOrNull { it == "medium" } ?: efforts.first()
    }

    val messages = current?.objects("messages").orEmpty()
    val events = current?.objects("events").orEmpty()
    val activities = current?.objects("activities").orEmpty()
    val questions = current?.objects("questions").orEmpty()
    val approvals = current?.objects("approvals").orEmpty()
    val results = current?.objects("results").orEmpty()
    val title = current?.get("conversation")?.jsonObject?.str("title").orEmpty().ifBlank { "与 Jarvis 对话" }
    val conversationId = current?.get("conversation")?.jsonObject?.str("id").orEmpty().ifBlank { selectedId.orEmpty() }
    val activeMessage = messages.lastOrNull { it.str("role") == "jarvis" && it.str("status") in listOf("queued", "streaming") }
    val localPending = liveReply?.takeIf { it.conversationId == conversationId && !it.finished && messages.none { message -> message.str("id") == it.messageId } }
    val activeTurnId = activeMessage?.str("turn_id")?.takeIf { it.isNotBlank() }
        ?: liveReply?.takeIf { it.conversationId == conversationId && !it.finished }?.turnId
    val running = activeMessage != null || localPending != null || sending

    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress to listState.firstVisibleItemIndex }.collect { (scrolling, first) ->
            if (scrolling) {
                val total = listState.layoutInfo.totalItemsCount
                followLatest = first >= (total - 4).coerceAtLeast(0)
            }
        }
    }
    // If a delta/status frame is dropped, reconcile the reply over HTTP instead
    // of leaving the composer disabled forever.
    val pendingMessageId = activeMessage?.str("id")?.takeIf { it.isNotBlank() } ?: localPending?.messageId
    LaunchedEffect(conversationId, pendingMessageId) {
        val messageId = pendingMessageId ?: return@LaunchedEffect
        var misses = 0
        while (true) {
            delay(2_500)
            val reply = runCatching { repo.syncLiveReply(conversationId, messageId) }.getOrNull()
            if (reply == null) {
                misses++
                if (misses >= 4) break
            } else {
                misses = 0
                if (reply.finished) break
            }
        }
    }
    val itemCount = messages.size + (if (localPending != null) 1 else 0)
    LaunchedEffect(conversationId, itemCount, messages.lastOrNull()?.str("content")?.length, localPending?.content?.length, results.size) {
        if (followLatest && itemCount > 0) {
            delay(90)
            runCatching {
                listState.scrollToItem(
                    index = (listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0),
                    scrollOffset = Int.MAX_VALUE,
                )
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            JarvisOrb(34.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = palette.textStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("私人对话 · 仅你可见", style = MaterialTheme.typography.labelSmall, color = palette.muted)
            }
            Surface(onClick = onVoice, shape = CircleShape, color = palette.accentSoft, modifier = Modifier.size(36.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Mic, "语音通话", Modifier.size(17.dp), tint = palette.accent) }
            }
            Surface(onClick = { historyOpen = true }, shape = CircleShape, color = palette.surface2, modifier = Modifier.size(36.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.History, "对话记录", Modifier.size(17.dp), tint = palette.muted) }
            }
        }
        HorizontalDivider(color = palette.line)

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (messages.isEmpty() && localPending == null) {
                ConversationWelcome(onPrompt = { text = it }, onVoice = onVoice, onNew = { repo.newConversation() })
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(22.dp),
                ) {
                    items(messages.size, key = { messages[it].str("id").ifBlank { "message-$it" } }) { index ->
                        val message = messages[index]
                        if (message.str("role") == "user") {
                            UserBubble(message.str("content"))
                        } else {
                            JarvisTurn(
                                message = message,
                                events = events,
                                activities = activities,
                                questions = questions,
                                approvals = approvals,
                                results = results,
                                resources = resources,
                                developer = developer,
                                repo = repo,
                                openRun = openRun,
                                openView = openView,
                                openWorkspace = openWorkspace,
                            )
                        }
                    }
                    if (localPending != null) {
                        item(key = "pending-${localPending.messageId}") {
                            PendingJarvisMessage(localPending, events, activities)
                        }
                    }
                }
                if (!followLatest && listState.layoutInfo.totalItemsCount > 3) {
                    SmallFloatingActionButton(
                        onClick = {
                            followLatest = true
                            scope.launch {
                                runCatching {
                                    listState.scrollToItem(
                                        index = (listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0),
                                        scrollOffset = Int.MAX_VALUE,
                                    )
                                }
                            }
                        },
                        modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                        containerColor = palette.surface2,
                        contentColor = palette.accent,
                    ) { Icon(JarvisIcons.ChevronDown, "回到最新消息", Modifier.size(18.dp)) }
                }
            }
        }

        Composer(
            text = text,
            onTextChange = { text = it },
            enabled = activeTurnId == null,
            running = running,
            sending = sending,
            efforts = efforts,
            reasoning = reasoning,
            selectedSkills = selectedSkills,
            hasSkills = skills.isNotEmpty(),
            onSkills = { skillsOpen = true },
            onReasoning = { reasoningOpen = true },
            onVoice = onVoice,
            onSend = {
                if (text.isNotBlank()) {
                    val submitted = text
                    text = ""
                    followLatest = true
                    repo.send(submitted, reasoning, selectedSkills)
                    selectedSkills = emptySet()
                }
            },
            onStop = { activeTurnId?.let { repo.stop(it) } },
        )
    }

    if (skillsOpen) {
        ModalBottomSheet(onDismissRequest = { skillsOpen = false }, containerColor = palette.surface, dragHandle = { BottomSheetDefaults.DragHandle(color = palette.lineBright) }) {
            Column(Modifier.fillMaxWidth().heightIn(max = 600.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 30.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SheetHeader("本次可用 Skills", "由 Hermes 选择技能，或让 Jarvis 自动决定。", onClose = { skillsOpen = false })
                SkillRow("Auto", "由 Hermes 自动选择", selectedSkills.isEmpty()) { selectedSkills = emptySet() }
                skills.forEach { skill ->
                    val name = skill.str("name")
                    SkillRow(name, skill.str("description"), selectedSkills.contains(name)) {
                        selectedSkills = if (selectedSkills.contains(name)) selectedSkills - name else selectedSkills + name
                    }
                }
            }
        }
    }
    if (reasoningOpen) {
        ModalBottomSheet(onDismissRequest = { reasoningOpen = false }, containerColor = palette.surface, dragHandle = { BottomSheetDefaults.DragHandle(color = palette.lineBright) }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 30.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SheetHeader("推理强度", "越深越多思考步骤，也更慢。", onClose = { reasoningOpen = false })
                efforts.forEach { effort ->
                    SkillRow(reasoningName(effort), reasoningDescription(effort), reasoning == effort) { reasoning = effort; reasoningOpen = false }
                }
            }
        }
    }
    if (historyOpen) {
        ModalBottomSheet(onDismissRequest = { historyOpen = false }, containerColor = palette.surface, dragHandle = { BottomSheetDefaults.DragHandle(color = palette.lineBright) }) {
            var query by remember { mutableStateOf("") }
            Column(Modifier.fillMaxWidth().heightIn(max = 620.dp).padding(horizontal = 16.dp).padding(bottom = 26.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                SheetHeader("对话记录", "${conversations.size} 个会话", onClose = { historyOpen = false })
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(query, { query = it }, placeholder = { Text("搜索会话", style = MaterialTheme.typography.bodySmall) }, singleLine = true, modifier = Modifier.weight(1f), shape = RoundedCornerShape(11.dp), textStyle = MaterialTheme.typography.bodySmall)
                    PrimaryButton("＋ 新会话", icon = JarvisIcons.Plus) { repo.newConversation(); historyOpen = false }
                }
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    conversations.filter { it.str("title").contains(query.trim(), ignoreCase = true) }.forEach { conversation ->
                        val selected = conversation.str("id") == conversationId
                        Row(
                            Modifier.fillMaxWidth()
                                .background(if (selected) palette.accentSoft else palette.surface2, RoundedCornerShape(11.dp))
                                .border(1.dp, if (selected) palette.accent.copy(alpha = 0.3f) else palette.line, RoundedCornerShape(11.dp))
                                .clickable { repo.selectConversation(conversation.str("id")); historyOpen = false }
                                .padding(start = 12.dp, top = 4.dp, bottom = 4.dp, end = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(conversation.str("title"), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = if (selected) palette.accent else palette.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            TextButton(onClick = { deleteTarget = conversation }) { Text("删除", color = palette.danger, style = MaterialTheme.typography.labelSmall) }
                        }
                    }
                    if (conversations.isEmpty()) EmptyState("还没有会话", "从一句想法开始。")
                }
            }
        }
    }
    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("删除会话") },
            text = { Text("确定删除会话“${target.str("title")}”吗？删除后无法恢复。") },
            confirmButton = {
                TextButton(onClick = { repo.deleteConversation(target.str("id")); deleteTarget = null }) { Text("删除", color = palette.danger) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("取消") } },
        )
    }
}

@Composable
private fun UserBubble(value: String) {
    val palette = jarvisColors()
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Column(
            Modifier.fillMaxWidth(0.86f)
                .background(palette.surface2, RoundedCornerShape(18.dp, 18.dp, 5.dp, 18.dp))
                .border(1.dp, palette.line, RoundedCornerShape(18.dp, 18.dp, 5.dp, 18.dp))
                .padding(horizontal = 14.dp, vertical = 11.dp),
        ) { UserMessage(value) }
    }
}

@Composable
private fun ConversationWelcome(onPrompt: (String) -> Unit, onVoice: () -> Unit, onNew: () -> Unit) {
    val palette = jarvisColors()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        JarvisOrb(90.dp, mode = OrbMode.Idle)
        Spacer(Modifier.height(20.dp))
        Eyebrow("JARVIS · PRIVATE CLOUD")
        Spacer(Modifier.height(6.dp))
        Text("今天，想做点什么？", style = MaterialTheme.typography.headlineMedium, color = palette.textStrong, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(5.dp))
        Text("一句话交代目标，Jarvis 会理解、调用工具，并把结果带回来。", style = MaterialTheme.typography.bodySmall, color = palette.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(18.dp))
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("看看家里的近况", "帮我找几张赛里木湖的照片", "今天服务器状态怎么样").forEach { prompt ->
                Surface(
                    onClick = { onPrompt(prompt) },
                    shape = RoundedCornerShape(13.dp),
                    color = palette.surface,
                    border = androidx.compose.foundation.BorderStroke(1.dp, palette.line),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(prompt, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = palette.text)
                        Icon(JarvisIcons.ArrowRight, null, Modifier.size(14.dp), tint = palette.accent)
                    }
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlineButton("语音通话", icon = JarvisIcons.Mic) { onVoice() }
            OutlineButton("新会话", icon = JarvisIcons.Plus) { onNew() }
        }
    }
}

@Composable
private fun JarvisTurn(
    message: JsonObject,
    events: List<JsonObject>,
    activities: List<JsonObject>,
    questions: List<JsonObject>,
    approvals: List<JsonObject>,
    results: List<JsonObject>,
    resources: Map<String, JsonObject>,
    developer: Boolean,
    repo: M2Repository,
    openRun: (String) -> Unit,
    openView: (String) -> Unit,
    openWorkspace: () -> Unit,
) {
    val palette = jarvisColors()
    val turnId = message.str("turn_id")
    val status = message.str("status")
    val running = status in listOf("queued", "streaming")
    val turnEvents = events.filter { it.str("turn_id") == turnId }
    val turnActivities = activities.filter { it.str("turn_id") == turnId }
    val turnQuestions = questions.filter { it.str("turn_id") == turnId && it.str("status") == "pending" }
    val turnApprovals = approvals.filter { it.str("turn_id") == turnId && it.str("status") == "pending" }
    val turnResults = results.filter { it.str("turn_id") == turnId }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            JarvisOrb(26.dp, mode = if (running) OrbMode.Thinking else OrbMode.Idle, animated = running)
            Text("Jarvis", style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
            if (running) {
                Row(Modifier.background(palette.accentSoft, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(9.dp), strokeWidth = 1.5.dp, color = palette.accent)
                    Spacer(Modifier.width(5.dp))
                    Text(if (status == "queued") "排队中" else "正在处理", style = MaterialTheme.typography.labelSmall, color = palette.accent)
                }
            }
        }
        ExecutionStream(turnEvents, turnActivities, developer)
        if (message.str("content").isNotBlank()) {
            AssistantMessage(message.str("content"), repo::media)
        } else if (running) {
            ThinkingLine(status)
        }
        if (status !in listOf("completed", "", "streaming", "queued")) {
            StatusBadge(statusLabel(status), if (status == "failed") palette.danger else palette.muted)
        }
        turnQuestions.forEach { question -> QuestionCard(question, repo) }
        turnApprovals.forEach { approval -> ApprovalCard(approval, repo) }
        turnResults.forEach { result -> ConversationResultCard(result, resources, repo, openRun, openWorkspace) }
        message.str("run_id").takeIf { it.isNotBlank() }?.let { runId ->
            TextButton(onClick = { openRun(runId) }, contentPadding = PaddingValues(0.dp)) { Text("查看任务 →", color = palette.accent) }
        }
        message.str("view_id").takeIf { it.isNotBlank() }?.let { id ->
            TextButton(onClick = { openView(id) }, contentPadding = PaddingValues(0.dp)) { Text("查看动态结果", color = palette.accent) }
        }
        val workspaceId = message.str("workspace_id").takeIf { it.isNotBlank() }
        if (workspaceId != null || message.str("view_id").isNotBlank() || turnResults.any { it.str("workspace_id").isNotBlank() }) {
            TextButton(
                onClick = { repo.openWorkspace(workspaceId ?: turnResults.firstOrNull { it.str("workspace_id").isNotBlank() }?.str("workspace_id")); openWorkspace() },
                contentPadding = PaddingValues(0.dp),
            ) { Text("打开工作区 →", color = palette.accent) }
        }
    }
}

@Composable
private fun PendingJarvisMessage(reply: LiveReply, events: List<JsonObject>, activities: List<JsonObject>) {
    val palette = jarvisColors()
    val turnEvents = events.filter { it.str("turn_id") == reply.turnId }
    val turnActivities = activities.filter { it.str("turn_id") == reply.turnId }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            JarvisOrb(26.dp, mode = OrbMode.Thinking, animated = true)
            Text("Jarvis", style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
            Row(Modifier.background(palette.accentSoft, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(9.dp), strokeWidth = 1.5.dp, color = palette.accent)
                Spacer(Modifier.width(5.dp))
                Text("正在回答", style = MaterialTheme.typography.labelSmall, color = palette.accent)
            }
        }
        ExecutionStream(turnEvents, turnActivities, false)
        if (reply.content.isNotBlank()) MarkdownMessage(reply.content)
        else ThinkingLine(reply.status)
    }
}

@Composable
private fun ThinkingLine(status: String) {
    val palette = jarvisColors()
    val transition = rememberInfiniteTransition(label = "thinking")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "alpha",
    )
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(3) { index ->
            Box(Modifier.size(5.dp).background(palette.accent.copy(alpha = if (index == 0) alpha else alpha * 0.55f), CircleShape))
        }
        Text(if (status == "queued") "任务排队中…" else "正在整理答案…", style = MaterialTheme.typography.bodySmall, color = palette.muted)
    }
}

private data class ExecutionStep(val id: String, val event: JsonObject?, val activity: JsonObject?)

@Composable
private fun ExecutionStream(events: List<JsonObject>, activities: List<JsonObject>, developer: Boolean) {
    val palette = jarvisColors()
    val visibleActivities = activities.filterNot { it.str("status") == "completed" && Regex("^(?:mcp_jarvis_|mcp__jarvis__)").containsMatchIn(it.str("capability")) }
    val activityIds = events.mapNotNull { it.str("activity_id").ifBlank { null } }.toSet()
    val steps = buildList {
        events.forEach { event ->
            val activityId = event.str("activity_id")
            if (activityId.isBlank() || visibleActivities.any { it.str("id") == activityId }) add(ExecutionStep(event.str("id"), event, null))
        }
        visibleActivities.filter { it.str("id") !in activityIds }.forEach { add(ExecutionStep(it.str("id"), null, it)) }
    }
    if (steps.isEmpty()) return
    val running = steps.any { (it.event?.str("status") ?: it.activity?.str("status")) in listOf("queued", "running", "streaming") }
    val starts = steps.mapNotNull { it.event?.str("started_at")?.let { value -> runCatching { Instant.parse(value) }.getOrNull() } }
    val finishes = steps.mapNotNull { it.event?.str("completed_at")?.let { value -> runCatching { Instant.parse(value) }.getOrNull() } }
    val duration = if (starts.isNotEmpty() && finishes.size == steps.size &&
        steps.all { it.event?.str("status") in listOf("completed", "failed", "cancelled") }) {
        Duration.between(starts.minOrNull()!!, finishes.maxOrNull()!!).toMillis()
    } else null
    var open by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth()
            .background(palette.surface2.copy(alpha = 0.72f), RoundedCornerShape(13.dp))
            .border(1.dp, palette.line, RoundedCornerShape(13.dp)),
    ) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (running) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.7.dp, color = palette.accent)
            else Icon(JarvisIcons.Check, null, Modifier.size(13.dp), tint = palette.sage)
            Spacer(Modifier.width(8.dp))
            Text(if (running) "正在执行" else "执行过程", style = MaterialTheme.typography.labelMedium, color = palette.text)
            Spacer(Modifier.weight(1f))
            Text("${steps.size} 个步骤", style = MaterialTheme.typography.labelSmall, color = palette.muted)
            Spacer(Modifier.width(8.dp))
            Text(
                duration?.let { if (it < 1000) "${it} 毫秒" else "%.1f 秒".format(it / 1000.0) } ?: if (running) "实时" else "过程记录",
                style = MaterialTheme.typography.labelSmall,
                color = palette.muted2,
            )
            Icon(JarvisIcons.ChevronDown, null, Modifier.size(14.dp), tint = palette.muted)
        }
        AnimatedVisibility(open) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                steps.forEachIndexed { index, step ->
                    val status = step.event?.str("status") ?: step.activity?.str("status") ?: "queued"
                    val kind = step.event?.str("kind")?.ifBlank { null }
                        ?: step.activity?.str("capability")?.let { if (it.startsWith("mcp")) "tool" else "processing" }
                        ?: "tool"
                    val title = step.event?.str("title")?.ifBlank { null }
                        ?: step.activity?.let { activityTitle(it.str("capability"), it["input"] as? JsonObject) }
                        ?: "执行操作"
                    val content = step.event?.str("content").orEmpty()
                    var detail by remember(step.id) { mutableStateOf(false) }
                    Row(Modifier.fillMaxWidth()) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(18.dp)) {
                            Box(
                                Modifier.size(15.dp).background(
                                    when (status) {
                                        "completed" -> palette.sage.copy(alpha = 0.18f)
                                        "failed" -> palette.danger.copy(alpha = 0.18f)
                                        else -> palette.accentSoft
                                    },
                                    CircleShape,
                                ),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    when (status) { "completed" -> "✓"; "failed" -> "!"; "cancelled" -> "×"; "running" -> "◌"; else -> "·" },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = when (status) { "completed" -> palette.sage; "failed" -> palette.danger; else -> palette.accent },
                                )
                            }
                            if (index < steps.size - 1) Box(Modifier.width(1.dp).height(30.dp).background(palette.line))
                        }
                        Spacer(Modifier.width(9.dp))
                        Column(Modifier.weight(1f).padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(activityKindLabel(kind), style = MaterialTheme.typography.labelSmall, color = palette.muted2)
                                Spacer(Modifier.width(7.dp))
                                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = palette.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(statusLabel(status), style = MaterialTheme.typography.labelSmall, color = if (status == "failed") palette.danger else palette.muted2)
                            }
                            if (content.isNotBlank()) {
                                TextButton(onClick = { detail = !detail }, contentPadding = PaddingValues(0.dp), modifier = Modifier.height(24.dp)) {
                                    Text(if (detail) "收起详情" else "查看详情", style = MaterialTheme.typography.labelSmall, color = palette.accent)
                                }
                            }
                            if (developer) {
                                val evidence = step.activity ?: step.event
                                TextButton(onClick = { detail = !detail }, contentPadding = PaddingValues(0.dp), modifier = Modifier.height(24.dp)) {
                                    Text("原始数据", style = MaterialTheme.typography.labelSmall, color = palette.muted2)
                                }
                                if (detail) Text(
                                    evidence?.toString() ?: "",
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                    color = palette.muted,
                                )
                            }
                            if (detail && content.isNotBlank()) MarkdownMessage(content)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuestionCard(question: JsonObject, repo: M2Repository) {
    val palette = jarvisColors()
    JarvisCard(padding = 14.dp, color = palette.accentSoft.copy(alpha = 0.55f)) {
        Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(JarvisIcons.Sparkle, null, Modifier.size(14.dp), tint = palette.accent)
                Spacer(Modifier.width(6.dp))
                Eyebrow("等待你的选择")
            }
            Text(question.str("prompt"), style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                if (question.str("kind") == "boolean") {
                    PrimaryButton("是") { repo.answerQuestion(question.str("id"), JsonPrimitive(true)) }
                    OutlineButton("否") { repo.answerQuestion(question.str("id"), JsonPrimitive(false)) }
                } else {
                    question.objects("options").forEach { option ->
                        OutlineButton(option.str("label")) { repo.answerQuestion(question.str("id"), option["value"] ?: JsonNull) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ApprovalCard(approval: JsonObject, repo: M2Repository) {
    val palette = jarvisColors()
    JarvisCard(padding = 14.dp, color = palette.danger.copy(alpha = 0.08f)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("需要你的确认", style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
            Text(capabilityLabel(approval.str("capability")), style = MaterialTheme.typography.bodySmall, color = palette.muted)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("批准一次", Modifier.weight(1f)) { repo.resolveApproval(approval.str("id"), true) }
                OutlineButton("取消", Modifier.weight(1f)) { repo.resolveApproval(approval.str("id"), false) }
            }
        }
    }
}

@Composable
private fun ConversationResultCard(
    result: JsonObject,
    resources: Map<String, JsonObject>,
    repo: M2Repository,
    openRun: (String) -> Unit,
    openWorkspace: () -> Unit,
) {
    val palette = jarvisColors()
    when (result.str("status")) {
        "failed" -> JarvisCard(padding = 14.dp, color = palette.danger.copy(alpha = 0.08f)) {
            Column {
                Text(result.str("title").ifBlank { "结果生成失败" }, style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                Text(result.str("error").ifBlank { "结果暂时无法生成，请重试。" }, style = MaterialTheme.typography.bodySmall, color = palette.muted)
            }
        }
        "loading" -> JarvisCard(padding = 14.dp) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = palette.accent)
                Text("${result.str("title")} · 正在生成分析界面", style = MaterialTheme.typography.bodySmall, color = palette.muted)
            }
        }
        else -> {
            if (result.str("target") == "workspace") {
                JarvisCard(padding = 14.dp, onClick = { repo.openWorkspace(result.str("workspace_id")); openWorkspace() }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(34.dp).background(palette.accentSoft, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                            Icon(JarvisIcons.Apps, null, Modifier.size(16.dp), tint = palette.accent)
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(result.str("title"), style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                            Text(if (result.str("status") == "loading") "正在生成分析界面" else "在工作区查看完整分析", style = MaterialTheme.typography.labelSmall, color = palette.muted)
                        }
                        Icon(JarvisIcons.ArrowRight, null, Modifier.size(15.dp), tint = palette.accent)
                    }
                }
            } else {
                val view = result["view"] as? JsonObject
                if (view != null) {
                    val sources = view["sections"]?.jsonArray?.mapNotNull { (it as? JsonObject)?.str("source")?.ifBlank { null } }?.toSet().orEmpty()
                    val scoped = resources.filterKeys { it in sources }
                    SemanticView(view, scoped, imageLoader = repo::thumbnail, followup = repo::prefill) { action ->
                        if (action.str("type") == "run.open") openRun(action.str("target")) else repo.action(action)
                    }
                }
            }
        }
    }
}

@Composable
private fun Composer(
    text: String,
    onTextChange: (String) -> Unit,
    enabled: Boolean,
    running: Boolean,
    sending: Boolean,
    efforts: List<String>,
    reasoning: String?,
    selectedSkills: Set<String>,
    hasSkills: Boolean,
    onSkills: () -> Unit,
    onReasoning: () -> Unit,
    onVoice: () -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
) {
    val palette = jarvisColors()
    Column(
        Modifier.fillMaxWidth().background(palette.background).padding(horizontal = 14.dp).padding(top = 8.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Column(
            Modifier.fillMaxWidth()
                .background(palette.surface, RoundedCornerShape(20.dp))
                .border(1.dp, if (running) palette.accent.copy(alpha = 0.35f) else palette.line, RoundedCornerShape(20.dp))
                .padding(horizontal = 12.dp, vertical = 9.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = onTextChange,
                placeholder = { Text("问 Jarvis 任何事情……", style = MaterialTheme.typography.bodyMedium) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 1,
                maxLines = 5,
                enabled = enabled,
                shape = RoundedCornerShape(13.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color.Transparent,
                    unfocusedBorderColor = Color.Transparent,
                    disabledBorderColor = Color.Transparent,
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    disabledContainerColor = Color.Transparent,
                ),
            )
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (hasSkills) {
                    Surface(onClick = onSkills, shape = CircleShape, color = palette.surface2) {
                        Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(JarvisIcons.Sparkle, null, Modifier.size(12.dp), tint = palette.accent)
                            Spacer(Modifier.width(4.dp))
                            Text(if (selectedSkills.isEmpty()) "Skills · Auto" else "Skills · ${selectedSkills.size}", style = MaterialTheme.typography.labelSmall, color = palette.accent)
                        }
                    }
                }
                if (efforts.isNotEmpty()) {
                    Surface(onClick = onReasoning, shape = CircleShape, color = palette.surface2) {
                        Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("推理 · ${reasoningName(reasoning)}", style = MaterialTheme.typography.labelSmall, color = palette.muted)
                        }
                    }
                }
                Spacer(Modifier.weight(1f))
                Surface(onClick = onVoice, shape = CircleShape, color = palette.accentSoft, modifier = Modifier.size(38.dp)) {
                    Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Mic, "语音通话", Modifier.size(17.dp), tint = palette.accent) }
                }
                if (running) {
                    Surface(onClick = onStop, shape = CircleShape, color = palette.danger.copy(alpha = 0.16f), modifier = Modifier.size(38.dp)) {
                        Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Stop, "停止任务", Modifier.size(15.dp), tint = palette.danger) }
                    }
                } else {
                    Surface(onClick = onSend, shape = CircleShape, color = if (text.isBlank() || sending) palette.surface3 else palette.accent, modifier = Modifier.size(38.dp)) {
                        Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Send, "发送消息", Modifier.size(18.dp), tint = if (text.isBlank() || sending) palette.muted2 else palette.accentInk) }
                    }
                }
            }
        }
        Text(
            if (running) "正在处理 · 可随时停止" else "Enter 发送 · 也可以直接说话",
            style = MaterialTheme.typography.labelSmall,
            color = palette.muted2,
            modifier = Modifier.padding(start = 6.dp),
        )
    }
}

private fun reasoningName(value: String?): String = when (value) {
    "low" -> "快速"
    "medium" -> "标准"
    "high" -> "深度"
    "max" -> "极深"
    else -> "自动"
}

private fun reasoningDescription(value: String): String = when (value) {
    "low" -> "最快，适合简单问答"
    "medium" -> "平衡速度与质量"
    "high" -> "更完整地推理与检查"
    "max" -> "尽量深入，耗时最长"
    else -> ""
}

@Composable
private fun SkillRow(title: String, description: String, selected: Boolean, onClick: () -> Unit) {
    val palette = jarvisColors()
    Row(
        Modifier.fillMaxWidth()
            .background(if (selected) palette.accentSoft else palette.surface2, RoundedCornerShape(12.dp))
            .border(1.dp, if (selected) palette.accent.copy(alpha = 0.35f) else palette.line, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodySmall, color = if (selected) palette.accent else palette.text)
            if (description.isNotBlank()) Text(description, style = MaterialTheme.typography.labelSmall, color = palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (selected) Icon(JarvisIcons.Check, null, Modifier.size(15.dp), tint = palette.accent)
    }
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

@Composable
fun WorkspaceScreen(repo: M2Repository, back: () -> Unit, developer: Boolean = false) {
    val palette = jarvisColors()
    val workspace by repo.workspace.collectAsStateWithLifecycle()
    val workspaces by repo.workspaces.collectAsStateWithLifecycle()
    val semantic by repo.semanticView.collectAsStateWithLifecycle()
    val legacy by repo.view.collectAsStateWithLifecycle()
    val resources by repo.resources.collectAsStateWithLifecycle()
    val busy by repo.workspaceBusy.collectAsStateWithLifecycle()
    val conversation by repo.conversation.collectAsStateWithLifecycle()
    var source by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { repo.openWorkspace() }
    val artifacts = workspace?.objects("artifacts").orEmpty()
    val nativeArtifact = artifacts.firstOrNull { it.str("type") == "native" }
    val html = artifacts.firstOrNull { it.str("type") != "native" }
    val workspaceObject = workspace?.get("workspace") as? JsonObject
    val title = workspaceObject?.str("title") ?: "工作区"
    val workspaceId = workspaceObject?.str("id").orEmpty()

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(onClick = back, shape = CircleShape, color = palette.surface2, modifier = Modifier.size(34.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Back, "返回", Modifier.size(16.dp), tint = palette.muted) }
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = palette.textStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("当前对话的分析结果", style = MaterialTheme.typography.labelSmall, color = palette.muted)
            }
            if (conversation != null) {
                Surface(onClick = { repo.createWorkspace() }, shape = CircleShape, color = palette.accentSoft, modifier = Modifier.size(34.dp)) {
                    Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Plus, "新建工作区", Modifier.size(16.dp), tint = palette.accent) }
                }
            }
        }
        HorizontalDivider(color = palette.line)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            if (workspace == null) {
                EmptyState(
                    "还没有工作区",
                    "从一条对话打开工作区后，这里会保存可恢复的分析结果。",
                    action = if (conversation != null) "新建工作区" else null,
                    onAction = { repo.createWorkspace() },
                )
            } else {
                if (workspaces.size > 1) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        workspaces.forEach { item ->
                            val selected = item.str("id") == workspaceId
                            Surface(
                                onClick = { repo.openWorkspaceById(item.str("id")) },
                                shape = CircleShape,
                                color = if (selected) palette.accentSoft else palette.surface2,
                                border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) palette.accent.copy(alpha = 0.35f) else palette.line),
                            ) {
                                Text(
                                    item.str("title") + " · r" + item.str("revision"),
                                    Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (selected) palette.accent else palette.muted,
                                )
                            }
                        }
                    }
                }
                when {
                    nativeArtifact != null -> {
                        val semanticView = semantic
                        val legacyView = legacy
                        if (semanticView != null) {
                            SemanticView(semanticView, resources, imageLoader = repo::thumbnail, followup = repo::prefill) { action ->
                                if (action.str("type") == "run.open") repo.show("agent_run_analysis", "agent-run/" + action.str("target"))
                                else repo.action(action)
                            }
                        } else if (legacyView != null) {
                            DynamicBlocks(legacyView, resources, action = { action -> repo.action(action) })
                        } else {
                            EmptyState("正在整理分析界面", "工作区内容马上就好。")
                        }
                    }
                    html != null -> {
                        val compiled = html.str("compiled")
                        if (compiled.isNotBlank()) JarvisCard(padding = 0.dp) { WorkspaceArtifact(compiled) }
                        if (developer) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlineButton(if (editing) "收起源码" else "编辑 Artifact", Modifier.weight(1f)) {
                                    if (!editing) source = html.str("source").ifBlank { compiled }
                                    editing = !editing
                                }
                                OutlineButton("保存", Modifier.weight(1f), enabled = source.isNotBlank()) {
                                    repo.saveArtifact(workspaceId, html.str("id").ifBlank { null }, source)
                                }
                            }
                            if (editing) {
                                OutlinedTextField(
                                    value = source,
                                    onValueChange = { source = it },
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp),
                                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                    label = { Text("Artifact 源码") },
                                    shape = RoundedCornerShape(12.dp),
                                )
                            }
                        }
                    }
                    else -> EmptyState("正在生成分析界面", "结果会保存在这个工作区里。")
                }
                if (busy) LoadingLine("正在保存工作区…")
            }
            Spacer(Modifier.height(26.dp))
        }
    }
}

@Composable
private fun WorkspaceArtifact(compiled: String) {
    val document = remember(compiled) {
        "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'\"><body style=\"background:transparent;margin:0\">$compiled</body>"
    }
    AndroidView(
        factory = { context -> WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.domStorageEnabled = false
            webViewClient = WebViewClient()
        } },
        update = { it.loadDataWithBaseURL(null, document, "text/html", "UTF-8", null) },
        modifier = Modifier.fillMaxWidth().heightIn(min = 220.dp, max = 620.dp),
    )
}
