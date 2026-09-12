package cloud.jarvis.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import java.io.File
import org.junit.Rule
import org.junit.Test

class M3ApplicationsEndToEndTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private fun waitFor(text:String) { compose.waitUntil(25000) { compose.onAllNodesWithText(text,substring=true).fetchSemanticsNodes().isNotEmpty() } }
    @Test fun realApplicationsAndNativeDetailSurviveRecreation() {
        val args=InstrumentationRegistry.getArguments()
        compose.onNode(hasSetTextAction() and hasText("http://100.x.x.x:8080")).performTextInput(args.getString("server")!!)
        compose.onNode(hasSetTextAction() and hasText("配对码")).performTextInput(args.getString("pairingCode")!!)
        compose.onNodeWithText("配对并连接").performClick();waitFor("已连接")
        compose.onNodeWithText("切换浅色主题").performClick()
        compose.activityRule.scenario.recreate();waitFor("已连接")
        compose.onNodeWithText("切换深色主题").assertIsDisplayed().performClick()
        compose.onNodeWithText("我的空间").performScrollTo()
        compose.onNodeWithText("珍藏生活的片刻").assertIsDisplayed()
        compose.waitForIdle()
        val home=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        File(compose.activity.filesDir,"m3-live-home.png").outputStream().use { home.compress(Bitmap.CompressFormat.PNG,100,it) }
        compose.onNode(hasText("应用",substring=false) and hasClickAction()).performClick()
        waitFor("Home Assistant");waitFor("Immich")
        compose.onNodeWithText("Immich").assertIsDisplayed().performClick()
        waitFor("服务数量：4")
        compose.onNodeWithText("服务数量：4").assertIsDisplayed()
        val screenshot=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        File(compose.activity.filesDir,"m3-live-app-detail.png").outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG,100,it) }
        compose.onNodeWithText("关闭应用详情").performClick()
        compose.activityRule.scenario.recreate();waitFor("已连接")
        compose.onNode(hasText("应用",substring=false) and hasClickAction()).performClick()
        waitFor("Immich")
        compose.onNodeWithText("刷新应用状态").performClick()
        compose.onNodeWithText("Home Assistant").assertIsDisplayed()
    }
}
