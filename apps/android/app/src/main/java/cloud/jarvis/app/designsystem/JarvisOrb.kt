package cloud.jarvis.app.designsystem

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

enum class OrbMode { Idle, Listening, Thinking, Speaking }

/**
 * The Lantern orb. Idle is a quiet sun; listening opens slow rings; thinking
 * draws an orbiting arc; speaking breathes with the synthesised audio level.
 */
@Composable
fun JarvisOrb(
    diameter: Dp = 64.dp,
    mode: OrbMode = OrbMode.Idle,
    audioLevel: Float = 0f,
    animated: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val palette = jarvisColors()
    val transition = rememberInfiniteTransition(label = "orb")
    val spin by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(if (mode == OrbMode.Thinking) 2200 else 9000, easing = LinearEasing), RepeatMode.Restart),
        label = "spin",
    )
    val breathe by transition.animateFloat(
        initialValue = 0.94f,
        targetValue = 1.06f,
        animationSpec = infiniteRepeatable(tween(2600, easing = LinearEasing), RepeatMode.Reverse),
        label = "breathe",
    )
    val ring by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(2800, easing = LinearEasing), RepeatMode.Restart),
        label = "ring",
    )
    val level = audioLevel.coerceIn(0f, 1f)
    val bodyScale = if (!animated) 1f else when (mode) {
        OrbMode.Speaking -> (0.95f + level * 0.16f)
        OrbMode.Listening -> breathe
        OrbMode.Thinking -> 0.96f + (sin(spin / 40f).toFloat() + 1f) * 0.02f
        else -> 1f
    }
    Box(modifier.size(diameter), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val radius = size.minDimension / 2f
            val center = Offset(size.width / 2f, size.height / 2f)
            // Soft ambient light.
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(palette.accent.copy(alpha = if (palette.light) 0.05f else 0.20f), Color.Transparent),
                    center = center,
                    radius = radius * 1.18f,
                ),
                radius = radius * 1.18f,
            )
            if (animated && mode == OrbMode.Listening) {
                repeat(3) { index ->
                    val progress = ((ring + index / 3f) % 1f)
                    val alpha = (1f - progress) * 0.32f
                    drawCircle(
                        color = palette.accent.copy(alpha = alpha),
                        radius = radius * (0.72f + progress * 0.72f),
                        center = center,
                        style = Stroke(width = 1.2.dp.toPx()),
                    )
                }
            }
            if (animated && mode == OrbMode.Speaking) {
                repeat(2) { index ->
                    val progress = ((ring * 1.8f + index / 2f) % 1f)
                    drawCircle(
                        color = palette.sage.copy(alpha = (1f - progress) * (0.10f + level * 0.28f)),
                        radius = radius * (0.78f + progress * 0.55f),
                        center = center,
                        style = Stroke(width = (1.2f + level * 1.8f).dp.toPx()),
                    )
                }
            }
            if (animated && mode == OrbMode.Thinking) {
                val arcRadius = radius * 1.02f
                drawArc(
                    brush = Brush.sweepGradient(listOf(palette.accent.copy(alpha = 0.0f), palette.accent.copy(alpha = 0.7f), palette.sage.copy(alpha = 0.0f)), center),
                    startAngle = spin,
                    sweepAngle = 110f,
                    useCenter = false,
                    topLeft = Offset(center.x - arcRadius, center.y - arcRadius),
                    size = androidx.compose.ui.geometry.Size(arcRadius * 2, arcRadius * 2),
                    style = Stroke(width = 1.6.dp.toPx(), cap = StrokeCap.Round),
                )
                // A small satellite makes "working" legible without a spinner.
                val angle = (spin - 90f) * PI.toFloat() / 180f
                drawCircle(
                    color = palette.accentStrong,
                    radius = 2.4.dp.toPx(),
                    center = Offset(center.x + cos(angle) * arcRadius, center.y + sin(angle) * arcRadius),
                )
            }
            val orbRadius = radius * 0.72f * bodyScale
            drawCircle(
                brush = Brush.radialGradient(
                    colors = palette.orb,
                    center = Offset(center.x - orbRadius * 0.36f, center.y - orbRadius * 0.42f),
                    radius = orbRadius * 1.55f,
                ),
                radius = orbRadius,
                center = center,
            )
            // Specular highlight and a dark lower limb give the sphere depth.
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(Color.White.copy(alpha = 0.55f), Color.Transparent),
                    center = Offset(center.x - orbRadius * 0.34f, center.y - orbRadius * 0.38f),
                    radius = orbRadius * 0.55f,
                ),
                radius = orbRadius * 0.52f,
                center = Offset(center.x - orbRadius * 0.28f, center.y - orbRadius * 0.30f),
            )
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(Color.Transparent, Color.Black.copy(alpha = 0.38f)),
                    center = center,
                    radius = orbRadius * 1.15f,
                ),
                radius = orbRadius,
                center = center,
            )
            drawCircle(color = Color.White.copy(alpha = 0.14f), radius = orbRadius, center = center, style = Stroke(width = 1f))
        }
    }
}

/** A quiet five-bar level meter used by the voice-call header. */
@Composable
fun VoiceLevelBars(level: Float, active: Boolean, modifier: Modifier = Modifier, bars: Int = 5) {
    val palette = jarvisColors()
    Canvas(modifier.size(width = (bars * 5 + (bars - 1) * 3).dp, height = 18.dp)) {
        val gap = 3.dp.toPx()
        val width = (size.width - gap * (bars - 1)) / bars
        val centre = (bars - 1) / 2f
        for (index in 0 until bars) {
            val distance = kotlin.math.abs(index - centre) / centre
            val base = (1f - distance * 0.45f) * if (active) 0.5f + level * 0.5f else 0.18f
            val height = size.height * (0.18f + base.coerceIn(0f, 1f) * 0.82f)
            drawRoundRect(
                color = if (active) palette.accent.copy(alpha = 0.55f + base * 0.35f) else palette.muted2.copy(alpha = 0.4f),
                topLeft = Offset(index * (width + gap), (size.height - height) / 2f),
                size = androidx.compose.ui.geometry.Size(width, height),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(width / 2f),
            )
        }
    }
}
