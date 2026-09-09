package cloud.jarvis.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.serialization.json.*

internal fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull ?: ""
private val chinese = mapOf("queued" to "排队中", "starting" to "启动中", "running" to "运行中", "completed" to "已完成", "failed" to "失败", "cancelled" to "已取消", "waiting_for_user" to "等待输入", "waiting_for_approval" to "等待审批", "input_tokens" to "输入 Token", "output_tokens" to "输出 Token", "estimated_cost_usd" to "预估费用（美元）", "healthy" to "正常")
internal fun display(value: JsonElement?): String = if(value == null || value is JsonNull) "暂无数据" else if(value is JsonPrimitive) chinese[value.content] ?: value.content else value.toString()
private fun path(data: JsonElement?, path: String?): JsonElement? = if(path.isNullOrBlank()) data else path.split('.').fold(data) { v,k -> (v as? JsonObject)?.get(k) }

@Composable fun DynamicScreen(repo: M2Repository, openRun: (String) -> Unit) {
    val view by repo.view.collectAsStateWithLifecycle(); val resources by repo.resources.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("usage_analysis" to "用量分析", "system_overview" to "系统趋势", "network_overview" to "服务器网络").forEach { (i,t) -> TextButton(onClick = { repo.show(i) }) { Text(t) } }
        }
        view?.let { DynamicBlocks(it, resources, { a -> if(a.text("type") == "run.open") openRun(a.text("target")) else repo.action(a) }) } ?: Text("选择一个视图查看实时数据")
    }
}
@Composable fun DynamicBlocks(view: JsonObject, resources: Map<String,JsonObject>, action: (JsonObject) -> Unit) {
    if(view["version"]?.jsonPrimitive?.intOrNull != 1) { Text("请更新客户端以显示此视图"); return }
    Text(view.text("title"), style = MaterialTheme.typography.headlineSmall)
    view["blocks"]?.jsonArray?.forEach { item ->
        val b = item.jsonObject; val data = path(resources[b.text("resource")]?.get("data"),b.text("path")) ?: b["text"]
        Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(b.text("title"),color=MaterialTheme.colorScheme.primary)
            when(b.text("type")) {
                "metric" -> Text(display(data),style=MaterialTheme.typography.headlineLarge)
                "metric_group", "status_grid" -> (data as? JsonObject)?.forEach { (k,v) -> Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.SpaceBetween) { Text(chinese[k] ?: k,Modifier.weight(1f)); Text(display(v),Modifier.weight(1f)) } } ?: Text("暂无数据")
                "sparkline", "line_chart", "bar_chart", "donut", "gauge" -> DataChart(b.text("type"), data)
                "progress" -> { val n=(data as? JsonPrimitive)?.floatOrNull; LinearProgressIndicator(progress={ ((n ?: 0f)/100f).coerceIn(0f,1f) },modifier=Modifier.fillMaxWidth()); Text(display(data)) }
                "timeline" -> (data as? JsonArray)?.forEach { v -> val e=v.jsonObject; Text("● " + ((e["payload"] as? JsonObject)?.text("title")?.ifBlank { null } ?: display((e["payload"] as? JsonObject)?.get("status")))); Text(e.text("timestamp"),style=MaterialTheme.typography.bodySmall); var expanded by remember(e.text("id")) { mutableStateOf(false) }; TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起" else "详情")}; if(expanded) Text(display(e["payload"])); HorizontalDivider() }
                "table" -> (data as? JsonArray)?.forEach { row -> (row as? JsonObject)?.forEach { (k,v) -> if(k!="content") Text("${chinese[k] ?: k}：${display(v)}") }; HorizontalDivider() } ?: Text("暂无记录")
                "run_graph" -> { val rows=(data as? JsonArray)?.map { it.jsonObject } ?: emptyList(); rows.filter { r -> rows.none { it["id"]==r["parent_run_id"] } }.forEach { RunNode(it,rows,0,action) } }
                "action" -> (b["action"] as? JsonObject)?.let { a ->
                    if(a.text("type")=="run.input") {
                        var text by remember(a.text("target")) { mutableStateOf("") }
                        OutlinedTextField(value=text,onValueChange={if(it.length<=16000)text=it},label={Text("补充任务输入")})
                        Button(enabled=text.isNotBlank(),onClick={action(JsonObject(a + ("text" to JsonPrimitive(text.trim()))))}) { Text("发送输入") }
                    } else Button(onClick={action(a)}) { Text(b.text("title")) }
                }
                "approval" -> { Text("审批不能扩大 Worker 权限"); (b["action"] as? JsonObject)?.let { a -> Button(onClick={action(JsonObject(a + ("approved" to JsonPrimitive(false))))}) {Text("拒绝操作")} } }
                "code_diff" -> display(data).lines().forEach { line -> Text(line, color=if(line.startsWith("+")) Color(0xFF98D9AB) else if(line.startsWith("-")) Color(0xFFFFA3A3) else MaterialTheme.colorScheme.onSurface,style=MaterialTheme.typography.bodySmall) }
                "markdown", "card", "alert" -> Text(display(data)) // Text never interprets HTML or executes links.
                else -> Text("此组件需要更新客户端才能显示")
            }
        } }
    }
}
@Composable private fun RunNode(row: JsonObject, rows: List<JsonObject>, depth: Int, action: (JsonObject)->Unit) {
    if(depth>3)return
    Column(Modifier.padding(start=(depth*12).dp)) {
        TextButton(onClick={action(buildJsonObject { put("type","run.open");put("target",row.text("id")) })}) {Text("${if(depth>0)"└ " else ""}${row.text("agent_id")} · ${display(row["status"])}")}
        if(row["agent_instance_id"] !is JsonNull && row["agent_instance_id"] != null) Text("   ◇ Worker",style=MaterialTheme.typography.bodySmall)
        rows.filter { it["parent_run_id"]==row["id"] }.forEach { RunNode(it,rows,depth+1,action) }
    }
}
@Composable private fun DataChart(type: String, data: JsonElement?) {
    val rows=(data as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
    val samples=rows.map { r -> (r["value"] as? JsonPrimitive)?.floatOrNull ?: (r["data"] as? JsonObject)?.get("cpu")?.jsonObject?.get("usage_percent")?.jsonPrimitive?.floatOrNull ?: ((r["input_tokens"] as? JsonPrimitive)?.floatOrNull?.plus((r["output_tokens"] as? JsonPrimitive)?.floatOrNull ?: 0f)) }
    val gpuSamples=rows.map { r -> ((r["data"] as? JsonObject)?.get("gpu") as? JsonObject)?.get("utilization_percent")?.jsonPrimitive?.floatOrNull }
    val history=rows.any { it["data"] is JsonObject }
    val gauge=(data as? JsonPrimitive)?.floatOrNull
    if((type=="gauge" && gauge==null) || (type!="gauge" && samples.none { it!=null } && gpuSamples.none { it!=null })) {Text("暂无数据 · 未采集时段保留缺口");return}
    val accent=MaterialTheme.colorScheme.primary
    Canvas(Modifier.fillMaxWidth().height(180.dp)) {
        val max=if(history)100f else (samples.filterNotNull().maxOrNull() ?: 100f).coerceAtLeast(1f)
        if(type=="gauge") { drawArc(Color(0xFF2C4245),140f,260f,false,topLeft=Offset(size.width/2-75.dp.toPx(),8f),size=Size(150.dp.toPx(),150.dp.toPx()),style=androidx.compose.ui.graphics.drawscope.Stroke(12.dp.toPx()));drawArc(accent,140f,260f*((gauge?:0f)/100f).coerceIn(0f,1f),false,topLeft=Offset(size.width/2-75.dp.toPx(),8f),size=Size(150.dp.toPx(),150.dp.toPx()),style=androidx.compose.ui.graphics.drawscope.Stroke(12.dp.toPx())) }
        else if(type=="donut") { val sum=samples.filterNotNull().sum().coerceAtLeast(1f);var angle=-90f;samples.forEachIndexed { i,v -> val sweep=(v?:0f)/sum*360;drawArc(listOf(accent,Color(0xFF83A6D8),Color(0xFFDAB981),Color(0xFFB39ADC))[i%4],angle,sweep,false,style=androidx.compose.ui.graphics.drawscope.Stroke(25.dp.toPx()));angle+=sweep } }
        else { val step=size.width/(samples.size.coerceAtLeast(2)-1);samples.forEachIndexed { i,v -> if(v!=null){ val y=size.height-v/max*(size.height-10);if(type=="bar_chart")drawRect(accent,Offset(i*size.width/samples.size,y),Size((size.width/samples.size-8).coerceAtLeast(1f),size.height-y)) else {if(i>0&&samples[i-1]!=null)drawLine(accent,Offset((i-1)*step,size.height-samples[i-1]!!/max*(size.height-10)),Offset(i*step,y),3f);drawCircle(accent,3f,Offset(i*step,y))} } } }
        if(history && type in listOf("line_chart","sparkline")) {
            val step=size.width/(gpuSamples.size.coerceAtLeast(2)-1)
            gpuSamples.forEachIndexed { i,v -> if(v!=null) { val point=Offset(i*step,size.height-v/max*(size.height-10));if(i>0&&gpuSamples[i-1]!=null)drawLine(Color(0xFFB39ADC),Offset((i-1)*step,size.height-gpuSamples[i-1]!!/max*(size.height-10)),point,3f);drawCircle(Color(0xFFB39ADC),3f,point) } }
        }
    }
    if(history) { Text("CPU · 绿色    GPU · 紫色    纵轴 0–100%",style=MaterialTheme.typography.bodySmall);Text("断线处表示指标缺失",style=MaterialTheme.typography.bodySmall) }
    if(type=="gauge")Text("$gauge %") else Text("${rows.firstOrNull()?.let { it.text("label").ifBlank { it.text("sampled_at") } } ?: ""} → ${rows.lastOrNull()?.let { it.text("label").ifBlank { it.text("sampled_at") } } ?: ""}",style=MaterialTheme.typography.bodySmall)
}
