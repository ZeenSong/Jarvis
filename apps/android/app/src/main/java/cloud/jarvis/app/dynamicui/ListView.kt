package cloud.jarvis.app.dynamicui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable fun ListView(title: String, data: JsonElement?, fallback: String) {
    val items = (data as? JsonObject)?.get("items") as? JsonArray
    fun field(item: JsonObject, key: String) = (item[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    val valid = items != null && items.size <= 200 && items.all { value ->
        val item = value as? JsonObject
        item != null && (field(item,"title")?.length ?: 0) in 1..300 &&
            listOf("description" to 2000,"status" to 100).all { (key,max) -> item[key] == null || (field(item,key)?.length ?: (max+1)) <= max }
    }
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (!valid) Text(fallback)
        else if (items!!.isEmpty()) Text("暂无条目")
        else LazyColumn(Modifier.heightIn(max = 420.dp).fillMaxWidth()) {
            items(items!!.map { it.jsonObject }) { item ->
                Column(Modifier.padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(field(item,"title")!!, style = MaterialTheme.typography.titleSmall)
                    field(item,"description")?.let { Text(it,style = MaterialTheme.typography.bodyMedium) }
                    field(item,"status")?.let { Text(it,style = MaterialTheme.typography.labelMedium,color = MaterialTheme.colorScheme.primary) }
                }
                HorizontalDivider()
            }
        }
    } }
}
