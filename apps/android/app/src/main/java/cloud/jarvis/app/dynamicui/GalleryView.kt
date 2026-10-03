package cloud.jarvis.app.dynamicui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

val mediaPath = Regex("^/api/media/[a-zA-Z0-9_-]{1,100}/thumbnail$")
private val resourceId = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
private fun JsonObject.field(key:String)=(get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonObject.imagePath()=field("resource_id")?.let { "/api/media/$it/thumbnail" } ?: field("thumbnail").orEmpty()
@Composable private fun Thumbnail(path:String,title:String,load:suspend(String)->ByteArray) {
    var bitmap by remember(path) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(path) { mutableStateOf(false) }
    LaunchedEffect(path) {
        failed=false
        try {
            bitmap=withContext(Dispatchers.IO) {
                require(mediaPath.matches(path))
                val bytes=load(path);require(bytes.size<=2*1024*1024)
                val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
                BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                require(bounds.outWidth in 1..8192 && bounds.outHeight in 1..8192)
                val options=BitmapFactory.Options().apply { inSampleSize=1;while(bounds.outWidth/inSampleSize>1024 || bounds.outHeight/inSampleSize>1024) inSampleSize*=2 }
                requireNotNull(BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)).asImageBitmap()
            }
        } catch(cancelled:CancellationException) { throw cancelled } catch(_:Exception) { failed=true }
    }
    Box(Modifier.fillMaxWidth().aspectRatio(4f/3f)) {
        bitmap?.let { Image(it,contentDescription=title,contentScale=ContentScale.Fit,modifier=Modifier.fillMaxSize()) }
            ?: Text(if(failed) "图片暂不可用" else "正在加载图片",modifier=Modifier.padding(12.dp))
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun GalleryView(title:String,data:JsonElement?,fallback:String,load:suspend(String)->ByteArray,action:(JsonObject)->Unit={},followup:(String)->Unit={}) {
    val raw=(data as? JsonObject)?.get("items") as? JsonArray
    val items=raw?.mapNotNull { it as? JsonObject }.orEmpty()
    val valid=raw!=null && raw.size==items.size && items.size<=100 && items.map{it.field("id")}.distinct().size==items.size && items.all {
        (it.field("id")?.length?:0) in 1..200 && (it.field("title")?.length?:301)<=300 && mediaPath.matches(it.imagePath()) &&
            (it["resource_id"]==null || resourceId.matches(it.field("resource_id").orEmpty())) &&
            (it["immich_asset_id"]==null || resourceId.matches(it.field("immich_asset_id").orEmpty())) &&
            listOf("description" to 2000,"captured_at" to 100).all { (key,max)->it[key]==null || (it.field(key)?.length?:(max+1))<=max }
    }
    var selected by remember { mutableStateOf<String?>(null) }
    val item=if(valid) items.find { it.field("id")==selected } else null
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(title,style=MaterialTheme.typography.titleMedium)
        if(!valid) Text(fallback) else if(items.isEmpty()) Text("暂无照片") else LazyVerticalGrid(columns=GridCells.Fixed(2),modifier=Modifier.heightIn(max=440.dp),horizontalArrangement=Arrangement.spacedBy(10.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            items(items,key={it.field("id")!!}) { photo -> Card(onClick={selected=photo.field("id")}) {
                Thumbnail(photo.imagePath(),photo.field("title")!!,load)
                Text(photo.field("title")!!,modifier=Modifier.padding(10.dp),style=MaterialTheme.typography.labelMedium)
            } }
        }
        if(valid && items.isNotEmpty()) Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick={followup("请从 Immich 为我查看更多符合当前筛选条件的照片，并简要说明每张照片的亮点。")}) { Text("查看更多") }
            if(items.size==3 && items.all { it.field("immich_asset_id")!=null }) OutlinedButton(onClick={
                followup("请在 Immich 中收藏以下照片：${items.joinToString("、") { it.field("immich_asset_id")!! }}。如果需要选择或新建相册，请先询问我；执行写操作前说明影响范围并等待确认。")
            }) { Text("收藏这三张") }
        }
    } }
    if(item!=null) ModalBottomSheet(onDismissRequest={selected=null}) { Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(item.field("title")!!,style=MaterialTheme.typography.titleLarge)
        Thumbnail(item.imagePath(),item.field("title")!!,load)
        item.field("description")?.let { Text(it) }
        item.field("captured_at")?.let { Text("拍摄时间：$it",style=MaterialTheme.typography.bodySmall) }
        val assetId=item.field("immich_asset_id")
        if(assetId==null) Text("当前显示缩略图",style=MaterialTheme.typography.labelSmall) else Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick={followup("请在 Immich 中收藏以下照片：$assetId。如果需要选择或新建相册，请先询问我；执行写操作前说明影响范围并等待确认。");selected=null}) { Text("收藏这张") }
            Button(onClick={action(buildJsonObject { put("type","app.open");put("target","immich");put("kind","photo");put("resource_id",assetId);put("platform","android") });selected=null}) { Text("在 Immich 打开") }
        }
        TextButton(onClick={selected=null}) { Text("关闭照片详情") }
    } }
}
