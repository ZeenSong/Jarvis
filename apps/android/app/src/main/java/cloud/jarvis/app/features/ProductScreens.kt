package cloud.jarvis.app.features

import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import cloud.jarvis.app.R
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.JarvisRepository
import cloud.jarvis.app.designsystem.JarvisOrb
import kotlinx.serialization.json.*

private fun JsonObject?.str(key: String) = (this?.get(key) as? JsonPrimitive)?.contentOrNull ?: ""
private fun JsonObject?.child(key: String) = this?.get(key) as? JsonObject
private val states = mapOf("queued" to "排队中", "starting" to "启动中", "running" to "运行中", "completed" to "已完成", "failed" to "失败", "cancelled" to "已取消", "waiting_for_user" to "等待输入", "waiting_for_approval" to "等待审批")

@Composable fun ProductHome(repo: JarvisRepository, navigate: (String) -> Unit) {
    val system by repo.system.collectAsStateWithLifecycle()
    val hierarchy by repo.m2.hierarchy.collectAsStateWithLifecycle()
    val conversations by repo.m2.conversations.collectAsStateWithLifecycle()
    val applications by repo.m2.applications.collectAsStateWithLifecycle()
    val runs = (hierarchy?.get("runs") as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
    val active = runs.filter { it.str("status") in listOf("queued","starting","running","waiting_for_user","waiting_for_approval") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=20.dp), verticalArrangement=Arrangement.spacedBy(20.dp)) {
        Row(Modifier.fillMaxWidth().background(Brush.horizontalGradient(listOf(Color(0xFF132B47),Color(0xFF222447))),RoundedCornerShape(24.dp)).padding(20.dp),verticalAlignment=Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("你的私人云",style=MaterialTheme.typography.headlineMedium,color=Color.White); Spacer(Modifier.height(8.dp)); Text(if(system == null) "正在连接…" else if(system.child("jarvis").str("server_status")=="healthy") "一切正常，随时为你效劳" else "有状态需要关注",style=MaterialTheme.typography.bodySmall,color=Color(0xFFB7CDE5)) }; JarvisOrb()
        }
        OutlinedButton(onClick={navigate("jarvis")},modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(18.dp),contentPadding=PaddingValues(14.dp)) { JarvisOrb(30.dp); Spacer(Modifier.width(12.dp)); Text("问 Jarvis，或说说你的想法…") }
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            listOf("CPU" to system.child("cpu"), "内存" to system.child("memory")).forEach { (name,data) ->
                val value=(data?.get("usage_percent") as? JsonPrimitive)?.doubleOrNull
                Card(onClick={navigate("server")},modifier=Modifier.weight(1f),shape=RoundedCornerShape(18.dp)) { Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) { Text(name);Text(value?.let { "%.0f%%".format(it) } ?: "—",style=MaterialTheme.typography.headlineMedium);LinearProgressIndicator(progress={((value?:0.0)/100).toFloat().coerceIn(0f,1f)},modifier=Modifier.fillMaxWidth()) } }
            }
        }
        Card(onClick={navigate("tasks")},modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(18.dp)) { Column(Modifier.padding(18.dp)) { Text("Jarvis 正在工作",style=MaterialTheme.typography.titleMedium);Text("${active.size} 个任务进行中",color=MaterialTheme.colorScheme.onSurfaceVariant);active.firstOrNull()?.let { Spacer(Modifier.height(10.dp));Text(it.str("goal")) } } }
        Text("我的空间",style=MaterialTheme.typography.titleLarge); SpaceTiles(navigate)
        Text("最近活动",style=MaterialTheme.typography.titleLarge)
        if(conversations.isEmpty()) ProductEmpty("从一次对话开始","你的对话与任务进展会汇集在这里。")
        conversations.take(3).forEach { c -> TextButton(onClick={repo.m2.selectConversation(c.str("id"));navigate("jarvis")}) { Text(c.str("title")) } }
        Text("我的应用",style=MaterialTheme.typography.titleLarge)
        ProductApplications(applications) { repo.m2.refreshApplications() }
        OutlinedButton(onClick={navigate("apps")},modifier=Modifier.fillMaxWidth()) { Text("打开应用中心 →") }
        TextButton(onClick={navigate("server")}) { Text("系统状态与设置") }
        Spacer(Modifier.height(16.dp))
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun SpaceTiles(navigate: (String) -> Unit) {
    var selected by remember { mutableStateOf<String?>(null) }
    val spaces = listOf("照片" to R.drawable.space_photos, "文件" to R.drawable.space_files,
        "知识" to R.drawable.space_knowledge, "家庭" to R.drawable.space_family,
        "媒体" to R.drawable.space_media, "开发" to R.drawable.space_development)
    val descriptions = mapOf("照片" to "珍藏生活的片刻", "文件" to "资料，触手可及", "知识" to "让想法持续生长",
        "家庭" to "设备与生活", "媒体" to "你的影音空间", "开发" to "把想法变成作品")
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)) { spaces.chunked(2).forEach { row ->
    Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        row.forEach { (name,image) ->
            Card(onClick={if(name=="开发") navigate("tasks") else selected=name},modifier=Modifier.weight(1f),shape=RoundedCornerShape(18.dp)) {
                Box(Modifier.fillMaxWidth().height(150.dp)) {
                    Image(painterResource(image),contentDescription=null,contentScale=ContentScale.Crop,modifier=Modifier.matchParentSize())
                    Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Transparent,Color(0xEE061322)))))
                    Column(Modifier.align(Alignment.BottomStart).padding(16.dp),verticalArrangement=Arrangement.spacedBy(5.dp)) {
                        Text(name,style=MaterialTheme.typography.titleMedium,color=Color.White)
                        Text(descriptions.getValue(name),style=MaterialTheme.typography.labelSmall,color=Color(0xFFC4D6E7))
                    }
                }
            }
        }
    }
    } }
    selected?.let { name -> ModalBottomSheet(onDismissRequest={selected=null}) {
        Column(Modifier.padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text("$name · 接入进度",style=MaterialTheme.typography.headlineSmall)
            Text(when(name) {
                "照片" -> "可在应用中心查看 Immich 的连接与运行状态。照片时间线、相册与搜索尚未接入；封面是装饰图，不是你的照片。"
                "家庭" -> "可在应用中心查看 Home Assistant 的连接与运行状态。设备、房间与控制尚未接入。"
                "知识" -> "知识库与检索尚未接入。已有对话可在 Jarvis 中查看。"
                "文件" -> "文件浏览、上传与权限控制尚未接入。这里不会显示模拟文件。"
                else -> "影音库尚未接入。这里不会显示模拟媒体内容。"
            })
            if(name in listOf("照片","家庭")) Button(onClick={selected=null;navigate("apps")},modifier=Modifier.fillMaxWidth()) { Text("查看已安装应用") }
            if(name=="知识") Button(onClick={selected=null;navigate("jarvis")},modifier=Modifier.fillMaxWidth()) { Text("打开 Jarvis") }
            TextButton(onClick={selected=null}) { Text("关闭") }
        }
    } }
}
@Composable fun ProductEmpty(title: String, subtitle: String) {
    Column(Modifier.fillMaxWidth().padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) { Text("◇",color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.headlineMedium);Text(title,style=MaterialTheme.typography.titleMedium);Text(subtitle,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
}
@Composable fun ProductTasks(repo: JarvisRepository, open: (String) -> Unit) {
    val hierarchy by repo.m2.hierarchy.collectAsStateWithLifecycle()
    val runs=(hierarchy?.get("runs") as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
    TaskList(runs,open)
}
@Composable fun TaskList(runs:List<JsonObject>, open:(String)->Unit) {
    var filter by remember { mutableStateOf("全部") }
    var query by remember { mutableStateOf("") }
    fun group(r:JsonObject)=when(r.str("status")){"waiting_for_user","waiting_for_approval"->"待处理";"queued","starting","running"->"进行中";"completed","cancelled","failed"->"已结束";else->"状态待确认"}
    val visible=runs.filter { (filter=="全部" || group(it)==filter) && it.str("goal").contains(query.trim(),ignoreCase=true) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("任务",style=MaterialTheme.typography.headlineMedium);Text("每一件交给 Jarvis 的事，都有迹可循。",color=MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) { listOf("全部","待处理","进行中","已结束","状态待确认").filter { it!="状态待确认" || runs.any {r->group(r)==it} }.forEach { label ->
            val count=if(label=="全部") runs.size else runs.count {group(it)==label}
            FilterChip(selected=filter==label,onClick={filter=label},label={Text("$label · $count")})
        } }
        OutlinedTextField(value=query,onValueChange={query=it},label={Text("搜索任务")},singleLine=true,modifier=Modifier.fillMaxWidth())
        if(runs.isEmpty()) ProductEmpty("还没有任务","向 Jarvis 描述你的目标，随时查看进展。")
        else if(visible.isEmpty()) ProductEmpty("没有符合条件的任务","试试其他关键词或筛选条件。")
        visible.forEach { r -> Card(onClick={open(r.str("id"))},modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(18.dp)) { Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) { Text(r.str("goal"));Text(states[r.str("status")]?:"状态待确认",color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.bodySmall) } } }
    }
}
