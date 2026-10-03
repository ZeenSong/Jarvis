package cloud.jarvis.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class AssistantContentTest {
    @Test fun `persistent media marker becomes authenticated content image`() {
        val id = "10000000-0000-4000-8000-000000000003"
        val parts = assistantContentParts("前文 MEDIA_RESOURCE:$id 后文")
        assertEquals(3, parts.size)
        assertEquals(AssistantContentPart.Text("前文 "), parts[0])
        assertEquals(AssistantContentPart.Image("/api/media/$id/content"), parts[1])
        assertEquals(AssistantContentPart.Text(" 后文"), parts[2])
        assertFalse(parts.toString().contains("MEDIA_RESOURCE"))
    }

    @Test fun `legacy media paths use the same authenticated endpoints as Web`() {
        assertEquals(
            AssistantContentPart.Image("/api/media/token_1/thumbnail"),
            assistantContentParts("MEDIA:/api/media/token_1/thumbnail").single(),
        )
        assertEquals(
            AssistantContentPart.Image("/api/media/file?path=%2Fopt%2Fdata%2Fmedia%2Fphoto.png"),
            assistantContentParts("MEDIA:/opt/data/media/photo.png").single(),
        )
    }
}
