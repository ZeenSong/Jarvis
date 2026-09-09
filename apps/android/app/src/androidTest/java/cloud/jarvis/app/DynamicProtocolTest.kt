package cloud.jarvis.app
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test

class DynamicProtocolTest {
    @get:Rule val compose=createComposeRule()
    @Test fun sharedEighteenBlocksRenderWithoutExecutableMarkup(){
        val raw=InstrumentationRegistry.getInstrumentation().context.assets.open("all-blocks.json").bufferedReader().use {it.readText()}
        val fixture=Json.parseToJsonElement(raw).jsonObject
        val resources=fixture["resources"]!!.jsonArray.associate { it.jsonObject.text("resource") to it.jsonObject }
        compose.setContent {MaterialTheme {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {DynamicBlocks(fixture["view"]!!.jsonObject,resources,{})}}}
        fixture["view"]!!.jsonObject["blocks"]!!.jsonArray.forEach { b -> compose.onAllNodesWithText(b.jsonObject.text("title"),useUnmergedTree=true).onFirst().performScrollTo().assertIsDisplayed() }
    }
}
