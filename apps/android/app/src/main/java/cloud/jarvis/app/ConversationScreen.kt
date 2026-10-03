package cloud.jarvis.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.serialization.json.*
import android.webkit.WebView
import android.webkit.WebViewClient
import android.graphics.BitmapFactory
import android.util.Log
import cloud.jarvis.app.designsystem.JarvisOrb
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch

private fun JsonObject?.str(key: String) = (this?.get(key) as? JsonPrimitive)?.contentOrNull ?: ""

private sealed interface MarkdownBlock {
    data class Text(val value: String, val style: Int = 0) : MarkdownBlock
    data class Code(val value: String) : MarkdownBlock
    data class Quote(val value: String) : MarkdownBlock
    data class ListItems(val ordered: Boolean, val values: List<String>) : MarkdownBlock
    data class Table(val rows: List<List<String>>) : MarkdownBlock
    data object Break : MarkdownBlock
}

private fun parseMarkdown(value: String): List<MarkdownBlock> {
    val lines = value.split('\n'); val blocks = mutableListOf<MarkdownBlock>(); var i = 0
    fun cells(line: String) = line.trim().removePrefix("|").removeSuffix("|").split('|').map(String::trim)
    while (i < lines.size) {
        val line = lines[i]
        if (line.trim().startsWith("```")) { i++; val code = buildList { while (i < lines.size && !lines[i].trim().startsWith("```")) add(lines[i++]); if (i < lines.size) i++ }; blocks += MarkdownBlock.Code(code.joinToString("\n")); continue }
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            val rows = buildList { while (i < lines.size && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) { val row = cells(lines[i++]); if (!row.all { it.matches(Regex(":?-{3,}:?")) }) add(row) } }
            if (rows.isNotEmpty()) blocks += MarkdownBlock.Table(rows); continue
        }
        if (line.isBlank()) { blocks += MarkdownBlock.Break; i++; continue }
        val heading = Regex("^(#{1,3})\\s+(.+)").find(line)
        if (heading != null) { blocks += MarkdownBlock.Text(heading.groupValues[2], heading.groupValues[1].length); i++; continue }
        if (line.trimStart().startsWith('>')) { val quote = buildList { while (i < lines.size && lines[i].trimStart().startsWith('>')) add(lines[i++].trimStart().removePrefix("> ").removePrefix(">")) }; blocks += MarkdownBlock.Quote(quote.joinToString("\n")); continue }
        val marker = Regex("^\\s*([-+*]|\\d+[.)])\\s+(.+)").find(line)
        if (marker != null) { val ordered = marker.groupValues[1][0].isDigit(); val values = buildList { while (i < lines.size) { val item = Regex("^\\s*([-+*]|\\d+[.)])\\s+(.+)").find(lines[i]) ?: break; if (item.groupValues[1][0].isDigit() != ordered) break; add(item.groupValues[2]); i++ } }; blocks += MarkdownBlock.ListItems(ordered, values); continue }
        val paragraph = buildList { while (i < lines.size && lines[i].isNotBlank() && !lines[i].trimStart().startsWith("```") && !lines[i].matches(Regex("^#{1,3}\\s+.+")) && !lines[i].trimStart().startsWith('>') && !lines[i].matches(Regex("^\\s*([-+*]|\\d+[.)])\\s+.+")) && !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|'))) add(lines[i++]) }
        blocks += MarkdownBlock.Text(paragraph.joinToString(" "))
    }
    return blocks
}

@Composable private fun MarkdownInline(value: String, style: TextStyle = MaterialTheme.typography.bodyMedium) {
    val uriHandler = LocalUriHandler.current
    val text = buildAnnotatedString {
        val token = Regex("(`[^`\\n]+`|\\[([^]]+)\\]\\((https?://[^)\\s]+)\\)|\\*\\*([^*\\n]+)\\*\\*|__([^_\\n]+)__|(?<!\\*)\\*([^*\\n]+)\\*(?!\\*)|(?<!_)_([^_\\n]+)_(?!_))")
        var last = 0
        token.findAll(value).forEach { match ->
            append(value.substring(last, match.range.first))
            when {
                match.value.startsWith('`') -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Color(0x22000000))) { append(match.value.drop(1).dropLast(1)) }
                match.groupValues[3].isNotEmpty() -> { pushStringAnnotation("url", match.groupValues[3]); withStyle(SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline)) { append(match.groupValues[2]) }; pop() }
                match.groupValues[4].isNotEmpty() || match.groupValues[5].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(match.groupValues[4].ifEmpty { match.groupValues[5] }) }
                else -> withStyle(SpanStyle(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)) { append(match.groupValues[6].ifEmpty { match.groupValues[7] }) }
            }
            last = match.range.last + 1
        }
        append(value.substring(last))
    }
    ClickableText(text, style = style.copy(color = MaterialTheme.colorScheme.onSurface), onClick = { offset -> text.getStringAnnotations("url", offset, offset).firstOrNull()?.let { uriHandler.openUri(it.item) } })
}

private sealed interface ImageState {
    data object Loading : ImageState
    data class Ready(val bitmap: ImageBitmap) : ImageState
    data class Failed(val reason: String?) : ImageState
}

@Composable private fun AssistantImage(path: String, load: suspend (String) -> ByteArray) {
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
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) {
            Log.e("JarvisMedia", "Unable to render $path", error)
            ImageState.Failed(error.message)
        }
    }
    Card(Modifier.fillMaxWidth(), shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)) {
        when (val image = state) {
            ImageState.Loading -> Box(Modifier.fillMaxWidth().aspectRatio(16f / 10f), contentAlignment = androidx.compose.ui.Alignment.Center) { CircularProgressIndicator() }
            is ImageState.Failed -> Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                Text("图片暂不可用", color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { retry++ }) { Text("重新加载") }
            }
            is ImageState.Ready -> Image(image.bitmap, "Jarvis 返回的图片", Modifier.fillMaxWidth().heightIn(max = 440.dp).clickable { expanded = true }, contentScale = ContentScale.Fit)
        }
    }
    if (expanded && state is ImageState.Ready) Dialog(onDismissRequest = { expanded = false }) {
        Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(10.dp)) {
                Image((state as ImageState.Ready).bitmap, "Jarvis 返回的图片", Modifier.fillMaxWidth().heightIn(max = 680.dp), contentScale = ContentScale.Fit)
                TextButton(onClick = { expanded = false }, modifier = Modifier.align(androidx.compose.ui.Alignment.End)) { Text("关闭") }
            }
        }
    }
}

@Composable private fun AssistantMessage(value: String, load: suspend (String) -> ByteArray) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        assistantContentParts(value).forEachIndexed { index, part -> key("$index:$part") {
            when (part) {
                is AssistantContentPart.Text -> if (part.value.isNotBlank()) MarkdownMessage(part.value.trim('\n'))
                is AssistantContentPart.Image -> AssistantImage(part.path, load)
            }
        } }
    }
}

@Composable private fun UserMessage(value: String) {
    val answer = remember(value) { Regex("^用户已回答问题：([\\s\\S]*?)\\n回答：([\\s\\S]*?)\\n请根据此回答继续原任务。$").matchEntire(value) }
    if (answer == null) MarkdownMessage(value) else Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("对「${answer.groupValues[1]}」的回答", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
        Text(answer.groupValues[2], fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onPrimaryContainer)
    }
}

@Composable private fun MarkdownMessage(value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        parseMarkdown(value).forEach { block ->
            when (block) {
                is MarkdownBlock.Text -> { val style = when (block.style) { 1 -> MaterialTheme.typography.headlineSmall; 2 -> MaterialTheme.typography.titleLarge; 3 -> MaterialTheme.typography.titleMedium; else -> MaterialTheme.typography.bodyLarge }; MarkdownInline(block.value, style) }
                is MarkdownBlock.Code -> SelectionContainer { Text(block.value, modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).background(Color(0x22000000)).padding(10.dp), fontFamily = FontFamily.Monospace) }
                is MarkdownBlock.Quote -> Text(block.value, modifier = Modifier.fillMaxWidth().background(Color(0x1800A6C7)).padding(10.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                is MarkdownBlock.ListItems -> Column { block.values.forEachIndexed { index, item -> Row { Text(if (block.ordered) "${index + 1}. " else "• "); MarkdownInline(item) } } }
                is MarkdownBlock.Table -> Column(Modifier.horizontalScroll(rememberScrollState()).fillMaxWidth()) { block.rows.forEachIndexed { rowIndex, row -> Row { row.forEach { cell -> Text(cell, modifier = Modifier.widthIn(min = 110.dp).padding(6.dp), fontWeight = if (rowIndex == 0) FontWeight.Bold else FontWeight.Normal) } } } }
                MarkdownBlock.Break -> Spacer(Modifier.height(2.dp))
            }
        }
    }
}

@Composable private fun WorkspaceArtifact(compiled: String) {
    val document = remember(compiled) { "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'\"><body>$compiled</body>" }
    AndroidView(factory = { context -> WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.domStorageEnabled = false
        webViewClient = WebViewClient()
    } }, update = { it.loadDataWithBaseURL(null, document, "text/html", "UTF-8", null) }, modifier = Modifier.fillMaxWidth().heightIn(min = 220.dp, max = 560.dp))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ConversationScreen(repo: M2Repository, openRun: (String)->Unit, openView:(String)->Unit, openWorkspace: () -> Unit) {
    val conversations by repo.conversations.collectAsStateWithLifecycle(); val current by repo.conversation.collectAsStateWithLifecycle(); val sending by repo.sending.collectAsStateWithLifecycle(); val draft by repo.draft.collectAsStateWithLifecycle(); val options by repo.composerOptions.collectAsStateWithLifecycle()
    val resources by repo.resources.collectAsStateWithLifecycle()
    var text by remember { mutableStateOf("") }
    var reasoning by remember { mutableStateOf<String?>(null) }
    var selectedSkills by remember { mutableStateOf(setOf<String>()) }
    var reasoningMenu by remember { mutableStateOf(false) }
    var skillsMenu by remember { mutableStateOf(false) }
    var historyOpen by remember { mutableStateOf(false) }
    val conversationScroll = rememberScrollState()
    val screenScope = rememberCoroutineScope()
    var followLatest by remember { mutableStateOf(true) }
    LaunchedEffect(draft) { if (draft.isNotBlank()) { text = draft; repo.clearDraft() } }
    val efforts=options?.get("reasoning_efforts")?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
    val skills=options?.get("skills")?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()
    LaunchedEffect(efforts) { if(reasoning == null && efforts.isNotEmpty()) reasoning = efforts.firstOrNull { it == "medium" } ?: efforts.first() }
    val messages=current?.get("messages")?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()
    val events=current?.get("events")?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()
    val activities=current?.get("activities")?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()
    val questions=current?.get("questions")?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()
    val approvals=current?.get("approvals")?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()
    val results=current?.get("results")?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()
    val title=current?.get("conversation")?.jsonObject?.str("title").orEmpty().ifBlank { "与 Jarvis 对话" }
    val conversationId=current?.get("conversation")?.jsonObject?.str("id").orEmpty()
    val activeTurn=current?.get("turns")?.jsonArray?.mapNotNull { it as? JsonObject }?.lastOrNull { it.str("status") in listOf("queued","running","waiting_approval","waiting_question") }
    val latestContentLength = messages.lastOrNull()?.text("content")?.length ?: 0
    LaunchedEffect(conversationScroll) {
        snapshotFlow { conversationScroll.isScrollInProgress to (conversationScroll.maxValue - conversationScroll.value) }.collect { (scrolling, distance) ->
            if (scrolling) followLatest = distance < 180
        }
    }
    LaunchedEffect(messages.size, events.size, latestContentLength) {
        kotlinx.coroutines.delay(40)
        if (followLatest) conversationScroll.animateScrollTo(conversationScroll.maxValue)
    }
    Column(Modifier.fillMaxSize().padding(horizontal=16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().padding(top=4.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            JarvisOrb(34.dp);Column(Modifier.weight(1f)) { Text(title,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis);Text("你的家庭 AI · 想到什么，就从这里开始",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
            TextButton(onClick={historyOpen=true}) { Text("记录 ${conversations.size}") }
        }
        HorizontalDivider()
        Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
            TextButton(onClick={repo.selectConversation(null)}) {Text("＋ 新会话")}
            if(conversationId.isNotBlank()) Text(title,Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.labelLarge)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if(messages.isEmpty()) Column(Modifier.fillMaxSize(),horizontalAlignment=androidx.compose.ui.Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center) {
                JarvisOrb(58.dp);Spacer(Modifier.height(18.dp));Text("今天，有什么我可以帮你？",style=MaterialTheme.typography.headlineSmall);Spacer(Modifier.height(8.dp));Text("看看家里的近况，发现照片里的美好，或一起理清一个问题。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            } else Column(Modifier.fillMaxSize().verticalScroll(conversationScroll),verticalArrangement=Arrangement.spacedBy(18.dp)) {
                messages.forEach { m ->
                    if(m.text("role")=="user") Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) { Card(colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.primaryContainer),shape=androidx.compose.foundation.shape.RoundedCornerShape(16.dp,16.dp,4.dp,16.dp),modifier=Modifier.fillMaxWidth(.86f)) { Box(Modifier.padding(14.dp)) { UserMessage(m.text("content")) } } }
                    else Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) { JarvisOrb(28.dp);Text("Jarvis",fontWeight=FontWeight.SemiBold) }
                        ExecutionStream(events.filter { it.str("turn_id") == m.str("turn_id") },activities.filter { it.str("turn_id") == m.str("turn_id") })
                        if (m.text("content").isBlank()) Text(if(m.text("status")=="queued") "排队中…" else "正在处理…",color=MaterialTheme.colorScheme.onSurfaceVariant) else AssistantMessage(m.text("content"),repo::media)
                        if(m.text("status") !in listOf("completed","")) Text(display(m["status"]),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        questions.filter { it.str("turn_id")==m.str("turn_id") && it.str("status")=="pending" }.forEach { question -> QuestionCard(question,repo) }
                        approvals.filter { it.str("turn_id")==m.str("turn_id") && it.str("status")=="pending" }.forEach { approval -> ApprovalCard(approval,repo) }
                        results.filter { it.str("turn_id")==m.str("turn_id") }.forEach { result -> ConversationResult(result,resources,repo,openRun,openWorkspace) }
                        (m["run_id"] as? JsonPrimitive)?.contentOrNull?.let { id -> TextButton(onClick={openRun(id)}){Text("查看任务 →")} }
                        (m["view_id"] as? JsonPrimitive)?.contentOrNull?.let { id -> TextButton(onClick={openView(id)}){Text("查看动态结果")} }
                        val workspaceId = (m["workspace_id"] as? JsonPrimitive)?.contentOrNull
                        if (!workspaceId.isNullOrBlank() || (m["view_id"] as? JsonPrimitive)?.contentOrNull != null) TextButton(onClick={repo.openWorkspace(workspaceId); openWorkspace()}){Text("打开工作区 →")}
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
            if(conversationScroll.maxValue-conversationScroll.value>220) SmallFloatingActionButton(onClick={followLatest=true;screenScope.launch { conversationScroll.animateScrollTo(conversationScroll.maxValue) }},modifier=Modifier.align(androidx.compose.ui.Alignment.BottomEnd).padding(8.dp)) { Text("↓") }
        }
        Card(Modifier.fillMaxWidth(),shape=androidx.compose.foundation.shape.RoundedCornerShape(18.dp),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surfaceContainer)) { Column(Modifier.padding(10.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(value=text,onValueChange={text=it},placeholder={Text("问 Jarvis 任何事情……")},modifier=Modifier.fillMaxWidth().testTag("conversation-input"),minLines=1,maxLines=5,enabled=activeTurn==null,shape=androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
        Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)) {
            if(skills.isNotEmpty()) Box { TextButton(onClick={skillsMenu=true}) { Text(if(selectedSkills.isEmpty()) "Skills · Auto" else "Skills · ${selectedSkills.size} 项") };DropdownMenu(skillsMenu,{skillsMenu=false}) { DropdownMenuItem({Column{Text("Auto");Text("由 Hermes 自动选择",style=MaterialTheme.typography.labelSmall)}},{selectedSkills=emptySet()},leadingIcon={RadioButton(selectedSkills.isEmpty(),null)});skills.forEach { skill->val name=skill.str("name");DropdownMenuItem({Column{Text(name);skill.str("description").takeIf(String::isNotBlank)?.let{Text(it,style=MaterialTheme.typography.labelSmall,maxLines=2)}}},{selectedSkills=if(name in selectedSkills)selectedSkills-name else selectedSkills+name},leadingIcon={Checkbox(name in selectedSkills,null)}) } } }
            if(efforts.isNotEmpty()) Box { TextButton(onClick={reasoningMenu=true}) { Text("推理 · ${reasoningLabel(reasoning)}") };DropdownMenu(reasoningMenu,{reasoningMenu=false}) { efforts.forEach { effort->DropdownMenuItem({Text(reasoningLabel(effort))},{reasoning=effort;reasoningMenu=false}) } } }
            Spacer(Modifier.weight(1f))
            if(activeTurn!=null) OutlinedButton(onClick={repo.stop(activeTurn.str("id"))},enabled=!sending,shape=androidx.compose.foundation.shape.CircleShape,contentPadding=PaddingValues(0.dp),modifier=Modifier.size(52.dp)) { Text("■") }
            else Button(onClick={val submitted=text;text="";val submittedSkills=selectedSkills;selectedSkills=emptySet();followLatest=true;repo.send(submitted,reasoning,submittedSkills)},enabled=!sending&&text.isNotBlank(),shape=androidx.compose.foundation.shape.CircleShape,contentPadding=PaddingValues(0.dp),modifier=Modifier.size(52.dp).testTag("conversation-send")){Text(if(sending)"…" else "↑",style=MaterialTheme.typography.titleLarge)}
        }
        Text(if(activeTurn==null) "让想法成为行动" else if(activeTurn.str("status")=="queued") "任务排队中 · 可随时停止" else "正在处理 · 可随时停止",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(start=8.dp,bottom=2.dp))
        } }
    }
    if(historyOpen) ModalBottomSheet(onDismissRequest={historyOpen=false}) { Column(Modifier.fillMaxWidth().heightIn(max=620.dp).verticalScroll(rememberScrollState()).padding(horizontal=16.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text("对话记录",style=MaterialTheme.typography.titleLarge)
        OutlinedButton(onClick={repo.selectConversation(null);historyOpen=false},modifier=Modifier.fillMaxWidth()) { Text("＋ 新会话") }
        conversations.forEach { conversation -> Surface(color=if(conversation.str("id")==conversationId) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,shape=androidx.compose.foundation.shape.RoundedCornerShape(12.dp)) { Row(Modifier.fillMaxWidth().clickable { repo.selectConversation(conversation.str("id"));historyOpen=false }.padding(start=14.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) { Text(conversation.str("title"),Modifier.weight(1f).padding(vertical=12.dp),maxLines=2,overflow=TextOverflow.Ellipsis);TextButton(onClick={repo.deleteConversation(conversation.str("id"));if(conversation.str("id")==conversationId)historyOpen=false}) { Text("删除") } } } }
        Spacer(Modifier.height(24.dp))
    } }
}

private fun executionLabel(kind:String)=when(kind){"reasoning"->"推理";"skill"->"技能";"tool"->"工具";"processing"->"处理中";"render"->"渲染";"result"->"结果";"question"->"问题";"approval"->"审批";else->kind}
private fun reasoningLabel(value:String?)=when(value){"low"->"快速";"medium"->"标准";"high"->"深度";"max"->"极深";else->"自动"}
private fun statusLabel(value:String)=when(value){"queued"->"等待中";"running","streaming"->"进行中";"waiting_approval"->"等待确认";"waiting_question","waiting_for_user"->"等待选择";"completed"->"已完成";"failed"->"未完成";"cancelled"->"已停止";else->value}
private fun activityTitle(value:JsonObject):String {
    val capability=value.str("capability");val input=value["input"] as? JsonObject
    val provider=input?.str("provider").orEmpty().lowercase();val tool=(input?.str("tool_name").orEmpty()+input?.str("tool").orEmpty()+capability).lowercase()
    if(provider.contains("immich")||capability.lowercase().contains("immich")) return "Immich · "+when{Regex("search|find|query|album").containsMatchIn(tool)->"搜索照片";Regex("asset|photo|image").containsMatchIn(tool)->"查看照片";else->"整理相册"}
    if(provider.replace("_","").contains("homeassistant")||capability.lowercase().contains("homeassistant")) return "Home Assistant · "+when{Regex("snapshot|image|camera").containsMatchIn(tool)->"查看监控画面";Regex("call|service|control|setstate").containsMatchIn(tool)->"控制设备";Regex("search|find|list").containsMatchIn(tool)->"查找设备";else->"读取设备状态"}
    return when(capability){"system.status.read","system_status_read"->"读取服务器状态";"system.metrics.read","system_metrics_read"->"读取服务器指标";"ui.view.show","ui_view_show"->"打开工作区";"task.create","task_create"->"创建任务";"conversation.question.create","conversation_question_create"->"等待你的选择";else->"执行操作"}
}

@Composable private fun QuestionCard(question:JsonObject,repo:M2Repository) {
    Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.secondaryContainer.copy(alpha=.55f))) { Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Text(question.str("prompt"),fontWeight=FontWeight.SemiBold)
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            if(question.str("kind")=="boolean") { Button(onClick={repo.answerQuestion(question.str("id"),JsonPrimitive(true))}){Text("是")};OutlinedButton(onClick={repo.answerQuestion(question.str("id"),JsonPrimitive(false))}){Text("否")} }
            else question["options"]?.jsonArray?.mapNotNull{it as? JsonObject}?.forEach { option -> OutlinedButton(onClick={repo.answerQuestion(question.str("id"),option["value"] ?: JsonNull)}) { Text(option.str("label")) } }
        }
    } }
}

@Composable private fun ApprovalCard(approval:JsonObject,repo:M2Repository) {
    Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.tertiaryContainer.copy(alpha=.48f))) { Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text("需要你的确认",fontWeight=FontWeight.SemiBold);Text(activityTitle(approval),color=MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) { Button(onClick={repo.resolveApproval(approval.str("id"),true)}){Text("批准一次")};OutlinedButton(onClick={repo.resolveApproval(approval.str("id"),false)}){Text("取消")} }
    } }
}

@Composable private fun ConversationResult(result:JsonObject,resources:Map<String,JsonObject>,repo:M2Repository,openRun:(String)->Unit,openWorkspace:()->Unit) {
    when(result.str("status")) {
        "failed" -> Card(colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.errorContainer),modifier=Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)){Text(result.str("title"),fontWeight=FontWeight.SemiBold);Text(result.str("error").ifBlank{"结果暂时无法生成，请重试"})} }
        "loading" -> Card(Modifier.fillMaxWidth()) { Row(Modifier.padding(16.dp),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){CircularProgressIndicator(Modifier.size(24.dp));Text("${result.str("title")} · 正在生成") } }
        else -> if(result.str("target")=="workspace") Button(onClick={repo.openWorkspace(result.str("workspace_id"));openWorkspace()},modifier=Modifier.fillMaxWidth()) { Text("▥ ${result.str("title")} · 打开工作区") }
        else (result["view"] as? JsonObject)?.let { view -> cloud.jarvis.app.dynamicui.SemanticView(view,resources,imageLoader=repo::thumbnail,followup=repo::prefill) { action -> if(action.text("type")=="run.open")openRun(action.text("target")) else repo.action(action) } }
    }
}

@Composable private fun ExecutionStream(events:List<JsonObject>,activities:List<JsonObject>) {
    val visibleActivities=activities.filterNot { it.str("status")=="completed" && Regex("^(?:mcp_jarvis_|mcp__jarvis__)").containsMatchIn(it.str("capability")) }
    val activityIds=events.mapNotNull{it["activity_id"]?.jsonPrimitive?.contentOrNull}.toSet()
    val steps=events.filter { it.str("activity_id").isBlank() || visibleActivities.any { activity -> activity.str("id")==it.str("activity_id") } }+visibleActivities.filter { it.str("id") !in activityIds }.map { activity -> buildJsonObject { put("id",activity.str("id"));put("status",activity.str("status"));put("kind","tool");put("title",activityTitle(activity));put("content","") } }
    if(steps.isEmpty()) return
    val running=steps.any { it.str("status") in listOf("queued","running","streaming") }
    val starts=events.mapNotNull{runCatching{java.time.Instant.parse(it.str("started_at"))}.getOrNull()}
    val finishes=events.mapNotNull{runCatching{java.time.Instant.parse(it.str("completed_at"))}.getOrNull()}
    val duration=if(starts.isNotEmpty()&&finishes.size==events.size&&events.all{it.str("status") in listOf("completed","failed","cancelled")}) java.time.Duration.between(starts.minOrNull(),finishes.maxOrNull()).toMillis() else null
    val durationLabel=duration?.let{if(it<1000)"${it} 毫秒" else "${"%.1f".format(it/1000.0)} 秒"} ?: if(running)"实时执行" else "过程记录"
    Card(colors=CardDefaults.cardColors(containerColor=Color(0x221D82C4)),modifier=Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Text(if(running)"◌" else "✓",color=MaterialTheme.colorScheme.primary);Spacer(Modifier.width(6.dp));Text("执行过程 · ${steps.size} 个阶段",style=MaterialTheme.typography.titleSmall);Spacer(Modifier.weight(1f));Text(durationLabel,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            steps.forEachIndexed { index,event -> var expanded by remember(event.str("id")) { mutableStateOf(false) };Surface(onClick={expanded=!expanded},color=if(event.str("status")=="failed")MaterialTheme.colorScheme.errorContainer.copy(alpha=.35f) else Color.Transparent,shape=androidx.compose.foundation.shape.RoundedCornerShape(12.dp),modifier=Modifier.width(210.dp).heightIn(min=104.dp)) { Column(Modifier.padding(10.dp),verticalArrangement=Arrangement.spacedBy(5.dp)) { Row(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) { Text(if(event.str("status")=="completed") "✓" else if(event.str("status")=="failed") "!" else if(event.str("status")=="cancelled") "×" else "◌",color=MaterialTheme.colorScheme.primary);Text("${index+1}",style=MaterialTheme.typography.labelMedium);Text(executionLabel(event.str("kind")),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant) };Row{Text(event.str("title").ifBlank{"执行操作"},Modifier.weight(1f),maxLines=2,overflow=TextOverflow.Ellipsis);Text(if(expanded) "⌃" else "⌄")};Text(statusLabel(event.str("status")),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant);if(expanded) event.str("content").takeIf { it.isNotBlank() }?.let { Box(Modifier.padding(top=4.dp)) { MarkdownMessage(it) } } } } }
        }
    } }
}

@Composable fun WorkspaceScreen(repo: M2Repository, back: () -> Unit) {
    val current by repo.workspace.collectAsStateWithLifecycle()
    val conversation by repo.conversation.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { repo.openWorkspace() }
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement=Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = back) { Text("← 返回 Conversation") }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("工作区", style = MaterialTheme.typography.headlineMedium); Button(onClick = repo::createWorkspace, enabled = conversation != null) { Text("保存工作区") } }
        if (current == null) {
            Text("还没有与当前对话关联的持久化工作区。", style = MaterialTheme.typography.bodySmall)
        } else {
            val w = current!!.get("workspace")?.jsonObject
            Text(w?.str("title") ?: "Jarvis 工作区", style = MaterialTheme.typography.titleLarge)
            Text("revision ${w?.str("revision") ?: "0"}", style = MaterialTheme.typography.bodySmall)
            current!!.get("artifacts")?.jsonArray?.forEach { a ->
                val artifact = a.jsonObject
                Text("Artifact · ${artifact.str("type")} · ${artifact.str("status")}", style = MaterialTheme.typography.bodySmall)
                artifact["compiled"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }?.let { WorkspaceArtifact(it) }
            }
        }
        val hasArtifact = current?.get("artifacts")?.jsonArray?.any { it.jsonObject["compiled"]?.jsonPrimitive?.contentOrNull?.isNotBlank() == true } == true
        if (!hasArtifact) Box(Modifier.weight(1f)) { DynamicScreen(repo) { } }
    }
}
@Composable fun AgentCenter(repo: M2Repository, openRun:(String)->Unit, legacy:()->Unit, openAi:()->Unit = {}) {
    val hierarchy by repo.hierarchy.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("智能体",style=MaterialTheme.typography.headlineMedium)
        TextButton(onClick=legacy){Text("查看 M1 监控 Agent")}
        TextButton(onClick=openAi){Text("AI")}
        Card(Modifier.fillMaxWidth()){Column(Modifier.padding(20.dp)){Text("◈ Jarvis Core");Text("对话 · 委派 · 汇总")}}
        Text("领域智能体",style=MaterialTheme.typography.titleLarge)
        hierarchy?.get("definitions")?.jsonArray?.filter {it.jsonObject.text("tier")=="managed"}?.forEach {v->val d=v.jsonObject;Card(Modifier.fillMaxWidth()){Column(Modifier.padding(18.dp)){Text(d.text("name"));Text(d.text("description").ifBlank { "按能力路由的执行器" })}}}
        Text("任务与执行实例",style=MaterialTheme.typography.titleLarge)
        hierarchy?.get("runs")?.jsonArray?.forEach {v->val r=v.jsonObject;Card(Modifier.fillMaxWidth()){Column(Modifier.padding(18.dp)){Text(r.text("goal"));Text(display(r["status"]));if(r["agent_instance_id"] !is JsonNull)Text("◇ Worker",style=MaterialTheme.typography.bodySmall);TextButton(onClick={openRun(r.text("id"))},modifier=Modifier.testTag("run-open-${r.text("id")}")){Text("查看任务")}}}}
    }
}
