package cloud.jarvis.app.dynamicui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable fun LogView(title: String, data: JsonElement?, fallback: String) {
    val text = when (data) {
        is JsonPrimitive -> if (data.isString) data.content else null
        is JsonObject -> (data["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        else -> null
    }
    var query by remember(title) { mutableStateOf("") }
    val lines = remember(text) { text?.takeLast(200000)?.replace(Regex("\u001B\\[[0-?]*[ -/]*[@-~]"), "")?.replace("\r\n", "\n")?.let { if (it.isEmpty()) emptyList() else it.split("\n") } }
    val recent = remember(lines) { lines?.takeLast(1000).orEmpty() }
    val matches = remember(recent, query) { recent.withIndex().filter { it.value.contains(query, ignoreCase = true) } }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            if (text == null) Text(fallback) else {
                OutlinedTextField(value = query, onValueChange = { query = it }, label = { Text("筛选日志") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("${matches.size} / ${recent.size} 行", style = MaterialTheme.typography.labelSmall)
                if (text.length > 200000 || (lines?.size ?: 0) > 1000) Text("仅显示最近 1000 行 / 200000 字符内的日志。")
                if (matches.isEmpty()) Text(if (recent.isEmpty()) "暂无日志" else "没有匹配的日志")
                else LazyColumn(Modifier.heightIn(max = 320.dp).fillMaxWidth()) {
                    itemsIndexed(matches) { _, line ->
                        Text("${line.index + 1}  ${line.value}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 3.dp))
                    }
                }
            }
        }
    }
}
