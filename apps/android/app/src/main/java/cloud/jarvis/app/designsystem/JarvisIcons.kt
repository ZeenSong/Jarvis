package cloud.jarvis.app.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * A tiny stroke icon set. It mirrors the Web navigation glyphs and avoids
 * pulling the whole Material Icons artifact into the APK.
 */
object JarvisIcons {
    private fun icon(name: String, path: String, width: Float = 1.6f): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).addPath(
            pathData = PathParser().parsePathString(path).toNodes(),
            fill = null,
            stroke = SolidColor(Color.White),
            strokeLineWidth = width,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        ).build()

    val Home = icon("home", "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9")
    val Spaces = icon("spaces", "M3 7V5h6l2 2h10v13H3V7Z")
    val Apps = icon("apps", "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z")
    val Tasks = icon("tasks", "M8 3h8v4H8zM8 5H5v16h14V5h-3M8 13l3 3 5-6")
    val Jarvis = icon("jarvis", "M21 11a9 9 0 0 1-9 9H5l-3 2 1-6a9 9 0 1 1 18-5ZM8 11h.01M12 11h.01M16 11h.01")
    val System = icon("system", "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M15 7h3M15 17h3")
    val Settings = icon("settings", "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM19 13.5v-3l-2-.6a7 7 0 0 0-.8-1.9l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.9-.8L10.5 2h-3l-.6 2a7 7 0 0 0-1.9.8l-1.9-.9L1 6l.9 1.9a7 7 0 0 0-.8 1.9l-2 .6v3l2 .6a7 7 0 0 0 .8 1.9L1 17.8l2.1 2.1 1.9-.9a7 7 0 0 0 1.9.8l.6 2h3l.6-2a7 7 0 0 0 1.9-.8l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .8-1.9l2-.6Z")
    val Mic = icon("mic", "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6")
    val Speaker = icon("speaker", "M4 9h4l5-4v14l-5-4H4zM17 8a5 5 0 0 1 0 8M19.5 5.5a9 9 0 0 1 0 13")
    val Bell = icon("bell", "M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6ZM10 20a2 2 0 0 0 4 0")
    val Close = icon("close", "M6 6l12 12M18 6L6 18")
    val Back = icon("back", "M15 5l-7 7 7 7")
    val Send = icon("send", "M12 20V5M6 11l6-6 6 6")
    val Plus = icon("plus", "M12 5v14M5 12h14")
    val Trash = icon("trash", "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6")
    val Check = icon("check", "M5 12l4 4L19 6")
    val ArrowRight = icon("arrow", "M5 12h14M13 6l6 6-6 6")
    val History = icon("history", "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l4 2")
    val Keyboard = icon("keyboard", "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10")
    val Stop = icon("stop", "M7 5h10v14H7z")
    val Refresh = icon("refresh", "M20 11a8 8 0 1 0-2 6M20 4v7h-7")
    val Logout = icon("logout", "M15 5H5v14h10M14 12h7M18 9l3 3-3 3")
    val Moon = icon("moon", "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z")
    val Sun = icon("sun", "M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z")
    val Sparkle = icon("sparkle", "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8ZM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8Z")
    val More = icon("more", "M6 12h.01M12 12h.01M18 12h.01", 2.4f)
    val Phone = icon("phone", "M6 3h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2Z")
    val ChevronDown = icon("chevron", "M6 9l6 6 6-6")
    val ChevronRight = icon("chevron-right", "M9 6l6 6-6 6")
    val Globe = icon("globe", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18")
    val Shield = icon("shield", "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6ZM9 12l2 2 4-4")
    val Wave = icon("wave", "M4 12h2M8 8v8M12 5v14M16 8v8M20 12h2")
    val Menu = icon("menu", "M4 7h16M4 12h16M4 17h16")
}
