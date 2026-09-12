package cloud.jarvis.app.dynamicui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cloud.jarvis.app.DynamicBlocks
import kotlinx.serialization.json.*

private val components = listOf("metric","metric_group","sparkline","line_chart","bar_chart","donut","gauge","progress","status","data_table","timeline","card","alert","action","approval","markdown","log","code_diff","run_graph","list","task","gallery","photo_grid")
private fun JsonObject.str(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull ?: ""
val mobileRenderer = buildJsonObject {
    put("platform","android"); put("supports",buildJsonObject { put("min","2.0");put("max","2.0") })
    put("components",JsonArray(components.map { JsonPrimitive("$it@2") }));put("features",JsonArray(listOf("charts","actions","gallery").map(::JsonPrimitive)))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun SemanticView(view: JsonObject, liveResources: Map<String,JsonObject> = emptyMap(), imageLoader:suspend(String)->ByteArray = { error("媒体服务未连接") }, action: (JsonObject) -> Unit) {
    if(view.str("ui_protocol")!="2.0") { Text(view.str("fallback").ifBlank { "请更新客户端以显示此视图" });return }
    val sections=(view["sections"] as? JsonArray)?.mapNotNull { it as? JsonObject }?.map { section ->
        val resource=liveResources[section.str("source")]
        val bound=(section["source_revision"] as? JsonPrimitive)?.longOrNull
        val revision=(resource?.get("revision") as? JsonPrimitive)?.longOrNull
        if(bound!=null && revision!=null && revision>bound) {
            val sourcePath=section.str("source_path")
            val data=if(sourcePath.isBlank()) resource["data"] else sourcePath.split('.').fold(resource["data"]) { v,key -> (v as? JsonObject)?.get(key) }
            JsonObject(section + ("data" to (data ?: JsonNull)))
        } else section
    } ?: emptyList()
    val sheet=sections.filter { it.str("role") in listOf("detail","actions") }
    val order=listOf("summary","primary","activity","resources")
    val main=sections.filter { it.str("role") !in listOf("detail","actions") }.sortedBy { order.indexOf(it.str("role")) }
    var expanded by remember(view.str("id")) { mutableStateOf(false) }
    Text(view.str("title"),style=MaterialTheme.typography.headlineSmall)
    main.forEach { SemanticSection(it,action,imageLoader) }
    if(sheet.isNotEmpty()) Button(onClick={expanded=true},modifier=Modifier.fillMaxWidth()) { Text("查看操作与详情") }
    if(expanded) ModalBottomSheet(onDismissRequest={expanded=false}) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text("操作与详情",style=MaterialTheme.typography.titleLarge)
            sheet.forEach { SemanticSection(it,action,imageLoader) }
        }
    }
}

@Composable private fun SemanticSection(section: JsonObject, action: (JsonObject) -> Unit, imageLoader:suspend(String)->ByteArray) {
    val component=section.str("component")
    if(component !in components || (section["component_version"] as? JsonPrimitive)?.intOrNull != 2) {
        Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp)) { Text(section.str("title"));Text(section.str("fallback")) } };return
    }
    if(component == "log") { LogView(section.str("title"), section["data"], section.str("fallback"));return }
    if(component == "list") { ListView(section.str("title"), section["data"], section.str("fallback"));return }
    if(component == "task") { TaskView(section.str("title"), section["data"], section.str("fallback"));return }
    if(component in listOf("gallery","photo_grid")) { GalleryView(section.str("title"),section["data"],section.str("fallback"),imageLoader);return }
    if(component == "timeline") { TimelineView(section.str("title"), section["data"], section.str("fallback").ifBlank { "此面板数据格式不兼容" });return }
    val actions = section["actions"] as? JsonArray
    if (component == "action" && actions != null && actions.size > 1) {
        actions.take(20).mapNotNull { it as? JsonObject }.forEach { item ->
            key(item.str("id")) { SemanticSection(JsonObject(section + mapOf("title" to JsonPrimitive(item.str("label")), "actions" to JsonArray(listOf(item)))), action,imageLoader) }
        }
        return
    }
    val type=when(component){"data_table"->"table";"status"->"status_grid";else->component}
    val a=(section["actions"] as? JsonArray)?.firstOrNull() as? JsonObject
    val supportedActions=listOf("run.open","run.cancel","run.input","run.resume","approval.response","conversation.open","view.show")
    if(type=="action" && (a==null || a.str("capability") !in supportedActions)) { Text(section.str("fallback"));return }
    val block=buildJsonObject {
        put("type",type);put("title",section.str("title"));put("resource","system/status")
        if(a!=null && a.str("capability") in supportedActions) put("action",buildJsonObject {
            (a["input"] as? JsonObject)?.filterKeys { it in listOf("text","approved") }?.forEach { (key,value) -> put(key,value) }
            put("type",a.str("capability"));put("target",a.str("resource_id"))
        })
    }
    val spec=buildJsonObject { put("version",1);put("type","dashboard");put("title","");put("blocks",JsonArray(listOf(block))) }
    val data=section["data"] ?: JsonNull
    var pending by remember(a) { mutableStateOf<JsonObject?>(null) }
    val dangerous = a?.str("risk") == "dangerous"
    if (dangerous) Text("高风险操作 · 执行前请确认影响范围", color = MaterialTheme.colorScheme.error)
    DynamicBlocks(spec,mapOf("system/status" to buildJsonObject { put("data",data) })) { value -> if (dangerous) pending = value else action(value) }
    if (pending != null) AlertDialog(onDismissRequest = { pending = null }, title = { Text("确认高风险操作") },
        text = { Text("${a?.str("label")}\n目标：${a?.str("resource_id")}\n此操作可能产生难以恢复的影响。确认后仍需由服务端验证权限和审批状态。") },
        dismissButton = { TextButton(onClick = { pending = null }) { Text("返回检查") } },
        confirmButton = { TextButton(onClick = { val value = pending; pending = null; value?.let(action) }) { Text("确认执行") } })
}
