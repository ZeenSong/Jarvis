package cloud.jarvis.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** Error bodies must never reach a person as JSON. */
class FriendlyErrorTest {
    @Test fun serverCodesBecomeReadableText() {
        assertEquals("内容不存在或无权访问", friendlyError(IllegalStateException("""{"error":"not_found"}""")))
        assertEquals("登录已过期，请重新登录", friendlyError(IllegalStateException("""{"error":"unauthorized"}""")))
        assertEquals("无权访问该内容", friendlyError(IllegalStateException("""{"error":"forbidden"}""")))
        assertEquals("这个视图需要先选择具体对象", friendlyError(IllegalStateException("""{"error":"view_resource_required"}""")))
        assertEquals("操作失败（integration_credentials_key_missing）", friendlyError(IllegalStateException("""{"error":"integration_credentials_key_missing"}""")))
    }

    @Test fun unknownBodiesAreNotRenderedAsJson() {
        listOf("""{"error":{}}""", """{"unexpected":1}""", "{", """{"error":"weird_new_code"}""").forEach {
            val text = friendlyError(IllegalStateException(it))
            assertFalse(text, text.startsWith("{"))
            assertFalse(text, text.contains("\""))
        }
    }

    @Test fun plainMessagesSurviveButAreBounded() {
        assertEquals("尚未连接", friendlyError(IllegalStateException("尚未连接")))
        assertEquals("操作失败，请重试", friendlyError(IllegalStateException("  ")))
        assertEquals("操作失败，请重试", friendlyError(null))
        assertEquals(160, friendlyError(IllegalStateException("x".repeat(400))).length)
    }
}
