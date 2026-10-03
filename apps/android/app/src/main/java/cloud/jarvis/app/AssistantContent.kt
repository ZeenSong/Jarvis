package cloud.jarvis.app

import java.net.URLEncoder

internal sealed interface AssistantContentPart {
    data class Text(val value: String) : AssistantContentPart
    data class Image(val path: String) : AssistantContentPart
}

private val assistantMediaPattern = Regex(
    """MEDIA_RESOURCE:\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b|(?:MEDIA:\s*)?((?:/opt/data/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp))|(?:/api/media/[A-Za-z0-9_-]{1,100}/thumbnail))\b""",
    RegexOption.IGNORE_CASE,
)

/** Mirrors Web's assistantContentParts: media markers become authenticated image
 * requests and are removed from the text shown to the user. */
internal fun assistantContentParts(content: String): List<AssistantContentPart> {
    val parts = mutableListOf<AssistantContentPart>()
    var cursor = 0
    assistantMediaPattern.findAll(content).forEach { match ->
        if (match.range.first > cursor) parts += AssistantContentPart.Text(content.substring(cursor, match.range.first))
        val resourceId = match.groups[1]?.value
        val legacyPath = match.groups[2]?.value
        val path = when {
            resourceId != null -> "/api/media/$resourceId/content"
            legacyPath?.startsWith("/api/media/") == true -> legacyPath
            legacyPath != null -> "/api/media/file?path=${URLEncoder.encode(legacyPath, "UTF-8")}" 
            else -> null
        }
        if (path != null) parts += AssistantContentPart.Image(path)
        cursor = match.range.last + 1
    }
    if (cursor < content.length) parts += AssistantContentPart.Text(content.substring(cursor))
    if (parts.isEmpty()) parts += AssistantContentPart.Text(content)
    return parts
}
