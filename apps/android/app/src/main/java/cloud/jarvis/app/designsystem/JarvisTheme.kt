package cloud.jarvis.app.designsystem

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable fun JarvisTheme(light: Boolean = false, content: @Composable () -> Unit) {
    val colors = if (light) lightColorScheme(primary=Color(0xFF176CBE), background=Color(0xFFEDF3FB), surface=Color.White)
    else darkColorScheme(primary=Color(0xFF72CBFF), secondary=Color(0xFFA895FF), background=Color(0xFF060F1C),
        surface=Color(0xFF101F32), surfaceVariant=Color(0xFF172B42), onSurface=Color(0xFFEEF5FF), onSurfaceVariant=Color(0xFF91A9C5),
        surfaceContainerLowest=Color(0xFF071320), surfaceContainerLow=Color(0xFF0C1929),
        surfaceContainer=Color(0xFF101F32), surfaceContainerHigh=Color(0xFF14263D), surfaceContainerHighest=Color(0xFF172B42),
        outline=Color(0xFF48617E), outlineVariant=Color(0xFF243A52),
        error=Color(0xFFFF9FA9))
    MaterialTheme(colorScheme=colors, content=content)
}

@Composable fun JarvisOrb(diameter: Dp = 64.dp) {
    Canvas(Modifier.size(diameter)) {
        drawCircle(Brush.radialGradient(listOf(Color(0x556EA2FF), Color.Transparent)), radius=size.minDimension/2)
        drawCircle(Brush.radialGradient(listOf(Color(0xFFE5FBFF), Color(0xFF54CCFF), Color(0xFF2467C8), Color(0xFF102056), Color(0xFF9878E8)),
            center=Offset(size.width*.35f,size.height*.3f),radius=size.width*.7f),radius=size.minDimension*.38f)
    }
}
