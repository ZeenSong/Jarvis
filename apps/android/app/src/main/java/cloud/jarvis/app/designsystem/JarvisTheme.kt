package cloud.jarvis.app.designsystem

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The four appearances shipped by the Web client, in the same order. */
enum class JarvisStyle(val id: String, val label: String, val caption: String) {
    Lantern("lantern", "Lantern", "暖琥珀"),
    Moss("moss", "Moss", "苔绿"),
    Clay("clay", "Clay", "陶土"),
    Graphite("graphite", "Graphite", "石墨");

    companion object {
        fun fromId(value: String?): JarvisStyle = entries.firstOrNull { it.id == value } ?: Lantern
    }
}

/**
 * One palette per appearance and light/dark mode. The values mirror
 * `apps/web/src/design.css`; keeping them in Kotlin means the Android client
 * renders the same Lantern language without loading the Web stylesheet.
 */
data class JarvisPalette(
    val background: Color,
    val backgroundSoft: Color,
    val surface: Color,
    val surface2: Color,
    val surface3: Color,
    val text: Color,
    val textStrong: Color,
    val textDim: Color,
    val muted: Color,
    val muted2: Color,
    val accent: Color,
    val accentStrong: Color,
    val accentSoft: Color,
    val accentInk: Color,
    val sage: Color,
    val danger: Color,
    val info: Color,
    val line: Color,
    val lineStrong: Color,
    val lineBright: Color,
    val hero1: Color,
    val hero2: Color,
    val hero3: Color,
    val orb: List<Color>,
    val light: Boolean,
)

private fun color(hex: Long) = Color(0xFF000000 or hex)

fun jarvisPalette(style: JarvisStyle, light: Boolean): JarvisPalette = if (light) {
    when (style) {
        JarvisStyle.Lantern -> JarvisPalette(
            background = color(0xF5F1E9), backgroundSoft = color(0xEFE9DE), surface = color(0xFFFDF8),
            surface2 = color(0xF4EEE3), surface3 = color(0xEAE2D4), text = color(0x1B1814),
            textStrong = color(0x0F0D0A), textDim = color(0x3A342C), muted = color(0x6F675B),
            muted2 = color(0x7B7264), accent = color(0x96651D), accentStrong = color(0x7A5014),
            accentSoft = Color(0x1996651D), accentInk = color(0xFFFAF0), sage = color(0x5F7A5C),
            danger = color(0xB04A38), info = color(0x356F96), line = Color(0x1F262018),
            lineStrong = Color(0x2E262018), lineBright = Color(0x47262018), hero1 = color(0xF0E9DC),
            hero2 = color(0xEFE7D8), hero3 = color(0xEADFCC),
            orb = listOf(Color.White, color(0xFFF4DE), color(0xF6DFB3), color(0xE3B266), color(0xBC7E36), color(0x7A4A17)),
            light = true,
        )
        JarvisStyle.Moss -> JarvisPalette(
            background = color(0xEEF2E9), backgroundSoft = color(0xE7ECE1), surface = color(0xFBFDF8),
            surface2 = color(0xE8EFE1), surface3 = color(0xDDE7D5), text = color(0x182016),
            textStrong = color(0x0D120C), textDim = color(0x35422F), muted = color(0x65725F),
            muted2 = color(0x74816D), accent = color(0x5F7F4E), accentStrong = color(0x48633A),
            accentSoft = Color(0x1A5F7F4E), accentInk = color(0xF5FFF0), sage = color(0x4F6B4B),
            danger = color(0xA44A38), info = color(0x356F96), line = Color(0x1F1E2D19),
            lineStrong = Color(0x2E1E2D19), lineBright = Color(0x471E2D19), hero1 = color(0xEAF0E2),
            hero2 = color(0xE5EDDB), hero3 = color(0xDEE8D2),
            orb = listOf(Color.White, color(0xF2FFE6), color(0xD8EDC2), color(0xA9CB90), color(0x6D9457), color(0x3B5A2C)),
            light = true,
        )
        JarvisStyle.Clay -> JarvisPalette(
            background = color(0xF6EFE9), backgroundSoft = color(0xF0E6DD), surface = color(0xFFFAF5),
            surface2 = color(0xF2E6DC), surface3 = color(0xE8D9CC), text = color(0x201612),
            textStrong = color(0x120C09), textDim = color(0x463831), muted = color(0x7A665A),
            muted2 = color(0x8A7568), accent = color(0xA85B33), accentStrong = color(0x84431F),
            accentSoft = Color(0x1AA85B33), accentInk = color(0xFFF8F0), sage = color(0x6F7A5C),
            danger = color(0xA44A38), info = color(0x356F96), line = Color(0x1F32201A),
            lineStrong = Color(0x2E32201A), lineBright = Color(0x4732201A), hero1 = color(0xF1E6DA),
            hero2 = color(0xEEE1D3), hero3 = color(0xE9D8C7),
            orb = listOf(Color.White, color(0xFFF0E1), color(0xF8DCC6), color(0xE8B58F), color(0xC28155), color(0x7E4A2A)),
            light = true,
        )
        JarvisStyle.Graphite -> JarvisPalette(
            background = color(0xF2F2F0), backgroundSoft = color(0xECECE9), surface = color(0xFBFBFA),
            surface2 = color(0xE9E9E6), surface3 = color(0xDEDEDB), text = color(0x161616),
            textStrong = color(0x0A0A0A), textDim = color(0x363636), muted = color(0x6B6B68),
            muted2 = color(0x7A7A76), accent = color(0x3A3A38), accentStrong = color(0x1F1F1E),
            accentSoft = Color(0x143A3A38), accentInk = color(0xFAFAF8), sage = color(0x5F6B5C),
            danger = color(0xA44A38), info = color(0x356F96), line = Color(0x1F141414),
            lineStrong = Color(0x2E141414), lineBright = Color(0x47141414), hero1 = color(0xEFEFEC),
            hero2 = color(0xEAEAE6), hero3 = color(0xE3E3DE),
            orb = listOf(Color.White, color(0xF4F1EA), color(0xDED9CF), color(0xA8A296), color(0x5C574E), color(0x242320)),
            light = true,
        )
    }
} else {
    when (style) {
        JarvisStyle.Lantern -> JarvisPalette(
            background = color(0x0A0B0D), backgroundSoft = color(0x0E1012), surface = color(0x121417),
            surface2 = color(0x171A1E), surface3 = color(0x1D2126), text = color(0xECE7DD),
            textStrong = color(0xFBF7EE), textDim = color(0xC9C3B7), muted = color(0x9C9588),
            muted2 = color(0x8A8377), accent = color(0xE2B56D), accentStrong = color(0xF3D49B),
            accentSoft = Color(0x1FE2B56D), accentInk = color(0x1B1408), sage = color(0x93AB8D),
            danger = color(0xDD8A74), info = color(0x8FB2CF), line = Color(0x1AECE7DD),
            lineStrong = Color(0x29ECE7DD), lineBright = Color(0x3DECE7DD), hero1 = color(0x0F1113),
            hero2 = color(0x131416), hero3 = color(0x171719),
            orb = listOf(color(0xFFFDF5), color(0xF9E8C4), color(0xECCB90), color(0xCF9C52), color(0x8B5A24), color(0x2D1D0C)),
            light = false,
        )
        JarvisStyle.Moss -> JarvisPalette(
            background = color(0x090D0A), backgroundSoft = color(0x0D120E), surface = color(0x111711),
            surface2 = color(0x161F17), surface3 = color(0x1C271D), text = color(0xE9EEE4),
            textStrong = color(0xF7FBF3), textDim = color(0xC7D2C3), muted = color(0x9AA896),
            muted2 = color(0x8B9A87), accent = color(0x9EC08F), accentStrong = color(0xC3DDA8),
            accentSoft = Color(0x1F9EC08F), accentInk = color(0x0E1A0C), sage = color(0x8FBF9A),
            danger = color(0xDD8A74), info = color(0x8FB2CF), line = Color(0x1AE9EEE4),
            lineStrong = Color(0x29E9EEE4), lineBright = Color(0x3DE9EEE4), hero1 = color(0x0C100D),
            hero2 = color(0x111612), hero3 = color(0x151A16),
            orb = listOf(color(0xFBFFF6), color(0xE3F4D3), color(0xC4E0AA), color(0x8FB475), color(0x4F743D), color(0x1D2F17)),
            light = false,
        )
        JarvisStyle.Clay -> JarvisPalette(
            background = color(0x0E0B09), backgroundSoft = color(0x120E0B), surface = color(0x181310),
            surface2 = color(0x211A15), surface3 = color(0x2A211A), text = color(0xF0E7DE),
            textStrong = color(0xFBF5EE), textDim = color(0xD6C8BC), muted = color(0xB09C8D),
            muted2 = color(0x9B887A), accent = color(0xD98A63), accentStrong = color(0xF0B08B),
            accentSoft = Color(0x1FD98A63), accentInk = color(0x1D0E07), sage = color(0xA8A37F),
            danger = color(0xE08A75), info = color(0x8FB2CF), line = Color(0x1AF0E7DE),
            lineStrong = Color(0x29F0E7DE), lineBright = Color(0x3DF0E7DE), hero1 = color(0x120D0A),
            hero2 = color(0x17110D), hero3 = color(0x1C1511),
            orb = listOf(color(0xFFF8EF), color(0xF8E3D2), color(0xEEC3A3), color(0xD4956E), color(0x9A5B3B), color(0x3A2013)),
            light = false,
        )
        JarvisStyle.Graphite -> JarvisPalette(
            background = color(0x0B0B0B), backgroundSoft = color(0x0E0E0E), surface = color(0x141414),
            surface2 = color(0x1B1B1B), surface3 = color(0x232323), text = color(0xECECEC),
            textStrong = color(0xFAFAFA), textDim = color(0xC9C9C9), muted = color(0xA0A0A0),
            muted2 = color(0x8A8A8A), accent = color(0xD6D0C3), accentStrong = color(0xF0ECE3),
            accentSoft = Color(0x1AD6D0C3), accentInk = color(0x111111), sage = color(0xA7B3A2),
            danger = color(0xDD8A74), info = color(0x9AABBA), line = Color(0x1AECECEC),
            lineStrong = Color(0x29ECECEC), lineBright = Color(0x3DECECEC), hero1 = color(0x0D0D0D),
            hero2 = color(0x111111), hero3 = color(0x141414),
            orb = listOf(color(0xFFFFFF), color(0xF4F1EA), color(0xDED9CF), color(0xA8A296), color(0x5C574E), color(0x242320)),
            light = false,
        )
    }
}

val LocalJarvisPalette = staticCompositionLocalOf { jarvisPalette(JarvisStyle.Lantern, true) }
val LocalJarvisStyle = staticCompositionLocalOf { JarvisStyle.Lantern }

@Composable
fun jarvisColors(): JarvisPalette = LocalJarvisPalette.current

private val JarvisTypography = Typography(
    displayLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 38.sp, lineHeight = 46.sp, letterSpacing = 0.4.sp),
    displayMedium = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 31.sp, lineHeight = 39.sp, letterSpacing = 0.3.sp),
    displaySmall = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Medium, fontSize = 26.sp, lineHeight = 34.sp),
    headlineLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 25.sp, lineHeight = 33.sp, letterSpacing = 0.2.sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 21.sp, lineHeight = 29.sp),
    headlineSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 18.sp, lineHeight = 26.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 24.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 22.sp),
    titleSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 13.5.sp, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 25.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 23.sp),
    bodySmall = TextStyle(fontWeight = FontWeight.Normal, fontSize = 12.5.sp, lineHeight = 19.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.5.sp, lineHeight = 18.sp, letterSpacing = 0.2.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 11.5.sp, lineHeight = 16.sp, letterSpacing = 0.4.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 10.sp, lineHeight = 14.sp, letterSpacing = 1.1.sp),
)

private val JarvisShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(11.dp),
    medium = RoundedCornerShape(15.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(26.dp),
)

@Composable
fun JarvisTheme(
    light: Boolean = false,
    style: JarvisStyle = JarvisStyle.Lantern,
    content: @Composable () -> Unit,
) {
    val palette = jarvisPalette(style, light)
    val scheme = if (light) {
        lightColorScheme(
            primary = palette.accent, onPrimary = palette.accentInk,
            primaryContainer = palette.accentSoft, onPrimaryContainer = palette.textStrong,
            secondary = palette.sage, onSecondary = palette.accentInk,
            secondaryContainer = palette.surface3, onSecondaryContainer = palette.text,
            tertiary = palette.info, onTertiary = palette.background,
            background = palette.background, onBackground = palette.text,
            surface = palette.surface, onSurface = palette.text,
            surfaceVariant = palette.surface2, onSurfaceVariant = palette.muted,
            surfaceContainerLowest = palette.surface, surfaceContainerLow = palette.backgroundSoft,
            surfaceContainer = palette.surface2, surfaceContainerHigh = palette.surface2,
            surfaceContainerHighest = palette.surface3,
            outline = palette.lineBright, outlineVariant = palette.line,
            error = palette.danger, onError = Color.White,
            errorContainer = Color(0x1FB04A38), onErrorContainer = palette.danger,
            inverseSurface = palette.text, inverseOnSurface = palette.surface,
        )
    } else {
        darkColorScheme(
            primary = palette.accent, onPrimary = palette.accentInk,
            primaryContainer = palette.accentSoft, onPrimaryContainer = palette.accentStrong,
            secondary = palette.sage, onSecondary = palette.accentInk,
            secondaryContainer = palette.surface3, onSecondaryContainer = palette.text,
            tertiary = palette.info, onTertiary = palette.background,
            background = palette.background, onBackground = palette.text,
            surface = palette.surface, onSurface = palette.text,
            surfaceVariant = palette.surface2, onSurfaceVariant = palette.muted,
            surfaceContainerLowest = palette.background, surfaceContainerLow = palette.backgroundSoft,
            surfaceContainer = palette.surface, surfaceContainerHigh = palette.surface2,
            surfaceContainerHighest = palette.surface3,
            outline = palette.lineBright, outlineVariant = palette.line,
            error = palette.danger, onError = palette.background,
            errorContainer = Color(0x33DD8A74), onErrorContainer = palette.danger,
            inverseSurface = palette.text, inverseOnSurface = palette.background,
        )
    }
    CompositionLocalProvider(LocalJarvisPalette provides palette, LocalJarvisStyle provides style) {
        MaterialTheme(colorScheme = scheme, typography = JarvisTypography, shapes = JarvisShapes, content = content)
    }
}
