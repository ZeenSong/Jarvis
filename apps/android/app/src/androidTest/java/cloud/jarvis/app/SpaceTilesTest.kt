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
        // A tile opens its own space screen; the explanation lives there instead of
        // expanding inside the grid.
        compose.onNodeWithText("照片").performClick()
        compose.runOnIdle { assertEquals("space/photos",destination) }
        compose.onNodeWithText("开发").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("space/development",destination) }
    }
}
