package cloud.jarvis.app
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import cloud.jarvis.app.designsystem.JarvisTheme
import cloud.jarvis.app.features.SpaceTiles
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals

class SpaceTilesTest {
    @get:Rule val compose = createComposeRule()
    @Test fun sixSpacesExplainMissingContentAndNavigateToRealEntrypoints() {
        var destination = ""
        compose.setContent { JarvisTheme { Column(Modifier.verticalScroll(rememberScrollState())) { SpaceTiles { destination=it } } } }
        listOf("照片","文件","知识","家庭","媒体","开发").forEach { compose.onNodeWithText(it).assertExists() }
        compose.onNodeWithText("照片").performClick()
        compose.onNodeWithText("不是你的照片",substring=true).assertIsDisplayed()
        compose.onNodeWithText("查看已安装应用").performClick()
        compose.runOnIdle { assertEquals("apps",destination) }
        compose.onNodeWithText("开发").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("tasks",destination) }
    }
}
