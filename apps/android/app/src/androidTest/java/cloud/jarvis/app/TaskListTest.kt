package cloud.jarvis.app
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import cloud.jarvis.app.features.TaskList
import cloud.jarvis.app.designsystem.JarvisTheme
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
class TaskListTest {
    @get:Rule val compose=createComposeRule()
    @Test fun filtersSearchAndDetailKeepTaskIdentity() {
        val runs=Json.parseToJsonElement("""[{"id":"a","goal":"整理照片","status":"running"},{"id":"b","goal":"检查备份","status":"waiting_for_user"}]""").jsonArray.map {it.jsonObject}
        var selected=""
        compose.setContent { JarvisTheme { TaskList(runs) {selected=it} } }
        compose.onNodeWithText("待处理 · 1").performClick()
        compose.onNodeWithText("整理照片").assertDoesNotExist()
        compose.onNodeWithText("检查备份").performClick()
        compose.runOnIdle {assertEquals("b",selected)}
        compose.onNodeWithText("全部 · 2").performClick()
        compose.onNodeWithText("搜索任务").performTextInput("照片")
        compose.onNodeWithText("整理照片").assertIsDisplayed()
        compose.onNodeWithText("检查备份").assertDoesNotExist()
    }
}
