package cloud.jarvis.app.voice

/**
 * Pure text helpers for the voice call. They are deliberately free of Android
 * imports so they can be tested on the JVM.
 */
object VoiceText {
    private val mediaMarker = Regex("""MEDIA_RESOURCE:\s*[0-9a-f-]{8,}|(?:MEDIA:\s*)?(?:/opt/data/|/api/media/)[^\s)]+""", RegexOption.IGNORE_CASE)
    private val fencedCode = Regex("```[\\s\\S]*?```")
    private val inlineCode = Regex("`([^`\\n]+)`")
    private val image = Regex("!\\[([^]]*)]\\([^)]*\\)")
    private val link = Regex("\\[([^]]+)]\\([^)]*\\)")
    private val url = Regex("https?://\\S+")
    private val htmlTag = Regex("<[^>]{1,200}>")
    private val tableRow = Regex("^\\s*\\|.*\\|\\s*$", RegexOption.MULTILINE)
    private val markdownLine = Regex("^\\s{0,3}(#{1,6}|[-+*>]|\\d+[.)])\\s*", RegexOption.MULTILINE)
    private val emphasis = Regex("(\\*\\*|__|\\*|_|~~)")

    /** Turn a streaming Markdown answer into words that sound right when spoken. */
    fun sanitize(markdown: String): String {
        var value = markdown.replace(mediaMarker, " ")
        value = value.replace(fencedCode, " 代码。 ")
        value = value.replace(image, "$1")
        value = value.replace(link, "$1")
        value = value.replace(url, " ")
        value = value.replace(htmlTag, " ")
        value = value.replace(tableRow, " ")
        value = value.replace(markdownLine, "")
        value = value.replace(inlineCode, "$1")
        value = value.replace(emphasis, "")
        value = value.replace(Regex("\\s+"), " ").trim()
        return value
    }

    private val terminators = setOf('。', '！', '？', '；', '!', '?', ';', '…', '\n')
    private val trailing = setOf('”', '’', '"', '\'', '）', ')', '】', ']')

    /**
     * Return sentences that end before [fromOffset], plus the next offset.
     * The unfinished tail stays in the caller's buffer so the next token batch
     * can complete it.
     */
    fun completeSentences(text: String, fromOffset: Int): Pair<List<String>, Int> {
        if (fromOffset >= text.length) return emptyList<String>() to text.length
        val sentences = mutableListOf<String>()
        var start = fromOffset.coerceIn(0, text.length)
        var index = start
        while (index < text.length) {
            val char = text[index]
            if (char in terminators) {
                var end = index + 1
                while (end < text.length && text[end] in trailing) end++
                val sentence = text.substring(start, end).trim()
                if (sentence.length >= 2) {
                    sentences += sentence
                    start = end
                }
                index = end
            } else {
                index++
            }
        }
        return sentences to start
    }

    /** Split the final tail without requiring punctuation. */
    fun splitLongTail(text: String, limit: Int = 120): List<String> {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return emptyList()
        if (trimmed.length <= limit) return listOf(trimmed)
        val result = mutableListOf<String>()
        var remaining = trimmed
        while (remaining.length > limit) {
            val pivot = remaining.lastIndexOf(' ', limit).takeIf { it > limit / 2 } ?: limit
            result += remaining.substring(0, pivot).trim()
            remaining = remaining.substring(pivot).trim()
        }
        if (remaining.isNotEmpty()) result += remaining
        return result
    }
}
