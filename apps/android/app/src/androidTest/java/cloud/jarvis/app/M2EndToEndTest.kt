package cloud.jarvis.app
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test

class M2EndToEndTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private fun waitFor(text:String) {compose.waitUntil(25000){compose.onAllNodesWithText(text,substring=true).fetchSemanticsNodes().isNotEmpty()}}
    @Test fun conversationStreamingAndDynamicViewRestore(){
        val args=InstrumentationRegistry.getArguments()
        compose.onNode(hasSetTextAction() and hasText("http://100.x.x.x:8080")).performTextInput(args.getString("server")!!)
        compose.onNode(hasSetTextAction() and hasText("配对码")).performTextInput(args.getString("pairingCode")!!)
        compose.onNodeWithText("配对并连接").performClick();waitFor("已连接")
        compose.onNode(hasText("Jarvis") and hasClickAction()).performClick()
        compose.onNodeWithTag("conversation-input").performTextInput("CPU 现在多少？")
        compose.onNodeWithTag("conversation-send").performClick();waitFor("当前 CPU 使用率")
        compose.activityRule.scenario.recreate();waitFor("已连接")
        compose.onNode(hasText("Jarvis") and hasClickAction()).performClick();waitFor("当前 CPU 使用率")
        compose.onNodeWithText("查看动态图表").performClick();waitFor("CPU %")
        compose.onNode(hasText("智能体") and hasClickAction()).performClick();waitFor("Jarvis Core");waitFor("领域智能体")
        val inputRun=args.getString("inputRun")!!
        compose.onNodeWithTag("run-open-$inputRun").performScrollTo().performClick();waitFor("补充任务输入")
        compose.onNode(hasSetTextAction() and hasText("补充任务输入")).performScrollTo().performTextInput("Android 控制验证")
        compose.onNodeWithText("发送输入").performScrollTo().performClick();waitFor("输入已收到：Android 控制验证")
        compose.activityRule.scenario.recreate();waitFor("输入已收到：Android 控制验证")
        compose.onNode(hasText("智能体") and hasClickAction()).performClick()
        val cancelRun=args.getString("cancelRun")!!
        compose.onNodeWithTag("run-open-$cancelRun").performScrollTo().performClick();waitFor("补充任务输入")
        compose.onNode(hasText("取消任务") and hasClickAction()).performScrollTo().performClick();waitFor("取消后归档完成")
    }
}
