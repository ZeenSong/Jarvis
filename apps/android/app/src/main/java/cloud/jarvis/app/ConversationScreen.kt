package cloud.jarvis.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.serialization.json.*

@Composable fun ConversationScreen(repo: M2Repository, openRun: (String)->Unit, openView:(String)->Unit) {
    val conversations by repo.conversations.collectAsStateWithLifecycle(); val current by repo.conversation.collectAsStateWithLifecycle(); val sending by repo.sending.collectAsStateWithLifecycle()
    var text by remember { mutableStateOf("") }
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
                    Text(m.text("content").ifBlank { "正在处理…" });Text(display(m["status"]),style=MaterialTheme.typography.bodySmall)
                    (m["run_id"] as? JsonPrimitive)?.contentOrNull?.let { id -> TextButton(onClick={openRun(id)}){Text("查看任务 →")} }
                    (m["view_id"] as? JsonPrimitive)?.contentOrNull?.let { id -> TextButton(onClick={openView(id)}){Text("查看动态图表")} }
                }}
            }
        }
        OutlinedTextField(value=text,onValueChange={text=it},label={Text("向 Jarvis 发送消息")},modifier=Modifier.fillMaxWidth().testTag("conversation-input"))
        Button(onClick={repo.send(text)},enabled=!sending&&text.isNotBlank(),modifier=Modifier.testTag("conversation-send")){Text(if(sending)"提交中…" else "发送")}
    }
}
@Composable fun AgentCenter(repo: M2Repository, openRun:(String)->Unit, legacy:()->Unit) {
    val hierarchy by repo.hierarchy.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("智能体",style=MaterialTheme.typography.headlineMedium)
        TextButton(onClick=legacy){Text("查看 M1 监控 Agent")}
        Card(Modifier.fillMaxWidth()){Column(Modifier.padding(20.dp)){Text("◈ Jarvis Core");Text("对话 · 委派 · 汇总")}}
        Text("领域智能体",style=MaterialTheme.typography.titleLarge)
        hierarchy?.get("definitions")?.jsonArray?.filter {it.jsonObject.text("tier")=="managed"}?.forEach {v->val d=v.jsonObject;Card(Modifier.fillMaxWidth()){Column(Modifier.padding(18.dp)){Text(d.text("name"));Text(if(d.text("role")=="coding")"隔离代码执行" else "只读运维分析")}}}
        Text("任务与执行实例",style=MaterialTheme.typography.titleLarge)
        hierarchy?.get("runs")?.jsonArray?.forEach {v->val r=v.jsonObject;Card(Modifier.fillMaxWidth()){Column(Modifier.padding(18.dp)){Text(r.text("goal"));Text("${r.text("agent_id")} · ${display(r["status"])}");if(r["agent_instance_id"] !is JsonNull)Text("◇ Worker",style=MaterialTheme.typography.bodySmall);TextButton(onClick={openRun(r.text("id"))},modifier=Modifier.testTag("run-open-${r.text("id")}")){Text("查看任务")}}}}
    }
}
