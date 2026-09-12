package cloud.jarvis.app.features

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import cloud.jarvis.app.R
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

private fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull ?: ""
private fun state(value: String) = when(value) { "running" -> "运行中"; "stopped" -> "已停止"; else -> "状态未知" }

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ProductApplications(value: JsonObject?, refresh: () -> Unit) {
    var selected by remember { mutableStateOf<String?>(null) }
    val apps = (value?.get("apps") as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
    val status = value?.text("status")
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
        if(status != "ready") {
            val title = when(status) { null -> "正在读取应用"; "not_configured" -> "尚未连接 CasaOS"; "authentication_required" -> "CasaOS 需要重新认证"; "configuration_error" -> "CasaOS 连接配置需要检查"; else -> "暂时无法读取应用" }
            Text(title, style=MaterialTheme.typography.titleMedium)
            Text("应用状态由私人云服务提供。",color=MaterialTheme.colorScheme.onSurfaceVariant)
        } else if(apps.isEmpty()) ProductEmpty("还没有安装应用","CasaOS 已连接，当前没有已安装应用。")
        else apps.forEach { app ->
            Card(onClick={selected=app.text("id")},modifier=Modifier.fillMaxWidth()) {
                Row(Modifier.padding(18.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    val icon=when(app.text("id")){"immich"->R.drawable.app_immich;"homeassistant"->R.drawable.app_homeassistant;else->null}
                    if(icon!=null) Image(painterResource(icon),contentDescription=null,modifier=Modifier.size(44.dp))
                    else Text(app.text("name").take(1),style=MaterialTheme.typography.headlineMedium,color=MaterialTheme.colorScheme.primary)
                    Column(Modifier.weight(1f)) { Text(app.text("name"),style=MaterialTheme.typography.titleMedium);Text("CasaOS",style=MaterialTheme.typography.bodySmall) }
                    Text(state(app.text("status")),style=MaterialTheme.typography.bodySmall)
                }
            }
        }
        TextButton(onClick=refresh) { Text("刷新应用状态") }
    }
    val app = apps.find { it.text("id") == selected }
    if(app != null && status == "ready") ModalBottomSheet(onDismissRequest={selected=null}) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text(app.text("name"),style=MaterialTheme.typography.headlineMedium)
            Text(state(app.text("status")),color=MaterialTheme.colorScheme.primary)
            Text("服务数量：${app.text("service_count").ifEmpty { "未知" }}")
            Text("应用标识：${app.text("id")}",style=MaterialTheme.typography.bodySmall)
            var expanded by remember(app.text("id")) { mutableStateOf(false) }
            if(app.text("description").isNotEmpty()) { TextButton(onClick={expanded=!expanded}) { Text(if(expanded) "收起简介" else "应用简介 · 来自 CasaOS") };if(expanded) Text(app.text("description")) }
            Text("当前提供只读状态。启停、更新等操作尚未开放。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick={selected=null}) { Text("关闭应用详情") }
        }
    }
}
