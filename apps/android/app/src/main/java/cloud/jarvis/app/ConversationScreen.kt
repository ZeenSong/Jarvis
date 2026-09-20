package cloud.jarvis.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.serialization.json.*
import android.webkit.WebView
import android.webkit.WebViewClient

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

@Composable private fun MarkdownInline(value: String, style: TextStyle = MaterialTheme.typography.bodyLarge) {
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

@Composable private fun MarkdownMessage(value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
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

@Composable fun ConversationScreen(repo: M2Repository, openRun: (String)->Unit, openView:(String)->Unit, openWorkspace: () -> Unit) {
    val conversations by repo.conversations.collectAsStateWithLifecycle(); val current by repo.conversation.collectAsStateWithLifecycle(); val sending by repo.sending.collectAsStateWithLifecycle(); val toolStates by repo.toolStates.collectAsStateWithLifecycle(); val draft by repo.draft.collectAsStateWithLifecycle()
    var text by remember { mutableStateOf("") }
    LaunchedEffect(draft) { if (draft.isNotBlank()) { text = draft; repo.clearDraft() } }
    Column(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            TextButton(onClick={repo.selectConversation(null)}) {Text("＋ 新会话")}
            conversations.forEach { c -> TextButton(onClick={repo.selectConversation(c.text("id"))}){Text(c.text("title").take(20))} }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            if(current==null)Text("今天需要我做什么？查看状态、分析用量，或委派代码任务。")
            current?.get("messages")?.jsonArray?.forEach { value -> val m=value.jsonObject
                Card(Modifier.fillMaxWidth()) {Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Text(if(m.text("role")=="user")"你" else "Jarvis",color=MaterialTheme.colorScheme.primary)
                    if (m.text("content").isBlank()) Text("正在处理…") else MarkdownMessage(m.text("content"));Text(display(m["status"]),style=MaterialTheme.typography.bodySmall)
                    val conversationId = current?.get("conversation")?.jsonObject?.text("id")
                    toolStates[conversationId]?.values?.forEach { state -> val parts = state.split('|', limit = 2); Text("工具 · ${parts.firstOrNull() ?: "tool"} · ${if (parts.getOrNull(1) == "running") "运行中" else if (parts.getOrNull(1) == "failed") "失败" else "已完成"}", modifier = Modifier.fillMaxWidth().background(Color(0x1800A6C7)).padding(8.dp), style = MaterialTheme.typography.bodySmall) }
                    (m["run_id"] as? JsonPrimitive)?.contentOrNull?.let { id -> TextButton(onClick={openRun(id)}){Text("查看任务 →")} }
                    (m["view_id"] as? JsonPrimitive)?.contentOrNull?.let { id -> TextButton(onClick={openView(id)}){Text("查看动态图表")} }
                    val workspaceId = (m["workspace_id"] as? JsonPrimitive)?.contentOrNull
                    if (!workspaceId.isNullOrBlank() || (m["view_id"] as? JsonPrimitive)?.contentOrNull != null) TextButton(onClick={repo.openWorkspace(workspaceId); openWorkspace()}){Text("打开工作区 →")}
                }}
            }
        }
        OutlinedTextField(value=text,onValueChange={text=it},label={Text("向 Jarvis 发送消息")},modifier=Modifier.fillMaxWidth().testTag("conversation-input"))
        Button(onClick={repo.send(text)},enabled=!sending&&text.isNotBlank(),modifier=Modifier.testTag("conversation-send")){Text(if(sending)"提交中…" else "发送")}
    }
}

@Composable fun WorkspaceScreen(repo: M2Repository, back: () -> Unit) {
    val current by repo.workspace.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { repo.openWorkspace() }
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement=Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = back) { Text("← 返回 Conversation") }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("工作区", style = MaterialTheme.typography.headlineMedium); Button(onClick = repo::createWorkspace, enabled = repo.conversation.value != null) { Text("保存工作区") } }
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
        hierarchy?.get("definitions")?.jsonArray?.filter {it.jsonObject.text("tier")=="managed" && it.jsonObject.text("id") != "coding-agent"}?.forEach {v->val d=v.jsonObject;Card(Modifier.fillMaxWidth()){Column(Modifier.padding(18.dp)){Text(d.text("name"));Text(if(d.text("role")=="coding")"隔离代码执行" else "只读运维分析")}}}
        Text("任务与执行实例",style=MaterialTheme.typography.titleLarge)
        hierarchy?.get("runs")?.jsonArray?.forEach {v->val r=v.jsonObject;Card(Modifier.fillMaxWidth()){Column(Modifier.padding(18.dp)){Text(r.text("goal"));Text("${r.text("agent_id")} · ${display(r["status"])}");if(r["agent_instance_id"] !is JsonNull)Text("◇ Worker",style=MaterialTheme.typography.bodySmall);TextButton(onClick={openRun(r.text("id"))},modifier=Modifier.testTag("run-open-${r.text("id")}")){Text("查看任务")}}}}
    }
}
