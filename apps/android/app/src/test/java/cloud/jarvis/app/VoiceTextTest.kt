package cloud.jarvis.app

import cloud.jarvis.app.voice.VoiceText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceTextTest {
    @Test fun sanitizeRemovesMarkersAndMarkdown() {
        val input = """
            这是 **重点**，还有 `inline` 和 [链接](https://example.com)。
            MEDIA_RESOURCE: 123e4567-e89b-12d3-a456-426614174000
            ```kotlin
            println("hidden")
            ```
            | a | b |
            |---|---|
            | 1 | 2 |
        """.trimIndent()
        val output = VoiceText.sanitize(input)
        assertTrue(output.contains("这是 重点"))
        assertTrue(output.contains("inline"))
        assertTrue(output.contains("链接"))
        assertFalse(output.contains("MEDIA_RESOURCE"))
        assertFalse(output.contains("println"))
        assertFalse(output.contains("https://"))
        assertFalse(output.contains("**"))
    }

    @Test fun completeSentencesOnlyConsumesFinishedSentences() {
        val (first, offset) = VoiceText.completeSentences("你好。我在听", 0)
        assertEquals(listOf("你好。"), first)
        assertEquals(3, offset)
        val (second, next) = VoiceText.completeSentences("你好。我在听", offset)
        assertTrue(second.isEmpty())
        assertEquals(offset, next)
    }

    @Test fun completeSentencesKeepsClosingPunctuation() {
        val (sentences, offset) = VoiceText.completeSentences("真的吗？”然后呢", 0)
        assertEquals(listOf("真的吗？”"), sentences)
        assertEquals(5, offset)
    }

    @Test fun longTailSplitsOnSpacesAndNeverDropsText() {
        val chunks = VoiceText.splitLongTail("one two three four five six", limit = 10)
        assertEquals("one two", chunks.first())
        assertEquals("one two three four five six", chunks.joinToString(" "))
    }

    @Test fun emptyInputIsQuiet() {
        assertEquals(emptyList<String>(), VoiceText.completeSentences("", 0).first)
        assertTrue(VoiceText.sanitize("  \n ").isEmpty())
        assertEquals(emptyList<String>(), VoiceText.splitLongTail("   "))
    }
}
