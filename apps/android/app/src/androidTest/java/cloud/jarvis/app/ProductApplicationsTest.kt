package cloud.jarvis.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import cloud.jarvis.app.designsystem.JarvisTheme
import cloud.jarvis.app.features.ProductApplications
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals

class ProductApplicationsTest {
    @get:Rule val compose = createComposeRule()
    @Test fun applicationOpensNativeDetailsAndCanRefresh() {
        var refreshes=0
        val data=Json.parseToJsonElement("""{"status":"ready","apps":[{"id":"immich","name":"Immich","status":"running","service_count":4,"description":"测试提供方简介"}]}""").jsonObject
        compose.setContent { JarvisTheme { ProductApplications(data) { refreshes++ } } }
        compose.onNodeWithText("刷新应用状态").performClick()
        compose.runOnIdle { assertEquals(1,refreshes) }
        compose.onNodeWithText("Immich").performClick()
        compose.onNodeWithText("服务数量：4").assertIsDisplayed()
        compose.onNodeWithText("测试提供方简介").assertDoesNotExist()
        compose.onNodeWithText("应用简介 · 来自 CasaOS").performClick()
        compose.onNodeWithText("测试提供方简介").assertIsDisplayed()
        compose.onNodeWithText("关闭应用详情").performClick()
        compose.onNodeWithText("服务数量：4").assertDoesNotExist()
    }
    @Test fun expiredAuthenticationIsNotAnEmptyAppList() {
        val data=Json.parseToJsonElement("""{"status":"authentication_required","apps":[]}""").jsonObject
        compose.setContent { JarvisTheme { ProductApplications(data) {} } }
        compose.onNodeWithText("CasaOS 需要重新认证").assertIsDisplayed()
        compose.onNodeWithText("还没有安装应用").assertDoesNotExist()
    }
}
