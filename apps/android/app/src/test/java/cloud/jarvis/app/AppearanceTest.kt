package cloud.jarvis.app

import cloud.jarvis.app.designsystem.JarvisStyle
import cloud.jarvis.app.designsystem.jarvisPalette
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppearanceTest {
    @Test fun unknownStyleFallsBackToLantern() {
        assertEquals(JarvisStyle.Lantern, JarvisStyle.fromId(null))
        assertEquals(JarvisStyle.Lantern, JarvisStyle.fromId("missing"))
        assertEquals(JarvisStyle.Moss, JarvisStyle.fromId("moss"))
        assertEquals(JarvisStyle.Graphite, JarvisStyle.fromId("graphite"))
    }

    @Test fun everyAppearanceHasDistinctLightAndDarkPalettes() {
        for (style in JarvisStyle.entries) {
            val dark = jarvisPalette(style, light = false)
            val light = jarvisPalette(style, light = true)
            assertNotEquals("background $style", dark.background, light.background)
            assertNotEquals("surface $style", dark.surface, light.surface)
            assertTrue("dark text $style", dark.text.luminance() > dark.background.luminance())
            assertTrue("light text $style", light.text.luminance() < light.background.luminance())
        }
        assertNotEquals(jarvisPalette(JarvisStyle.Lantern, false).accent, jarvisPalette(JarvisStyle.Moss, false).accent)
        assertNotEquals(jarvisPalette(JarvisStyle.Clay, false).accent, jarvisPalette(JarvisStyle.Graphite, false).accent)
    }

    @Test fun statusAndCapabilityLabelsStayHumanReadable() {
        assertEquals("已完成", statusLabel("completed"))
        assertEquals("等待审批", statusLabel("waiting_for_approval"))
        assertEquals("Home Assistant 控制", capabilityLabel("mcp.homeassistant.write"))
        assertEquals("Jarvis 服务调用", capabilityLabel("mcp_jarvis_system_status_read"))
        assertEquals("23:59", formatClock(23 * 60 + 59))
    }

    private fun androidx.compose.ui.graphics.Color.luminance(): Float = 0.2126f * red + 0.7152f * green + 0.0722f * blue
}
