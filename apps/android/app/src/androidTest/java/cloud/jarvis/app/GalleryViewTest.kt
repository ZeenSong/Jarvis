package cloud.jarvis.app
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import cloud.jarvis.app.designsystem.JarvisTheme
import cloud.jarvis.app.dynamicui.SemanticView
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test
class GalleryViewTest {
    @get:Rule val compose=createComposeRule()
    @Test fun failedThumbnailStillAllowsNativeMetadataDetail() {
        val view=Json.parseToJsonElement("""{"ui_protocol":"2.0","id":"photos","title":"照片空间","sections":[{"id":"photos","role":"primary","component":"gallery","component_version":2,"title":"照片","fallback":"不可用","data":{"items":[{"id":"one","title":"测试照片","description":"仅供渲染测试","thumbnail":"/api/media/one/thumbnail"}]}}]}""").jsonObject
        compose.setContent { JarvisTheme { Column { SemanticView(view,imageLoader={error("unavailable")}) {} } } }
        compose.waitUntil(5000) { compose.onAllNodesWithText("图片暂不可用").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("测试照片").performClick()
        compose.onNodeWithText("仅供渲染测试").assertIsDisplayed()
        compose.onNodeWithText("关闭照片详情").performClick()
        compose.onNodeWithText("仅供渲染测试").assertDoesNotExist()
    }
}
