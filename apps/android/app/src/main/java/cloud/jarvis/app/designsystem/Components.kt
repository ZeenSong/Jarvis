package cloud.jarvis.app.designsystem

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The app background: warm radial light, a faint grid, and the Lantern base. */
@Composable
fun JarvisBackground(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val palette = jarvisColors()
    Box(modifier.fillMaxSize().background(palette.background)) {
        Canvas(Modifier.fillMaxSize()) {
            drawRect(
                brush = Brush.radialGradient(
                    listOf(palette.accent.copy(alpha = if (palette.light) 0.09f else 0.10f), Color.Transparent),
                    center = Offset(size.width * 0.80f, -size.height * 0.04f),
                    radius = size.width * 0.95f,
                ),
            )
            drawRect(
                brush = Brush.radialGradient(
                    listOf(palette.sage.copy(alpha = if (palette.light) 0.07f else 0.06f), Color.Transparent),
                    center = Offset(size.width * 0.02f, size.height * 1.02f),
                    radius = size.width * 0.8f,
                ),
            )
            val grid = 44.dp.toPx()
            val line = palette.text.copy(alpha = if (palette.light) 0.026f else 0.02f)
            var x = 0f
            while (x < size.width) {
                drawLine(line, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
                x += grid
            }
            var y = 0f
            while (y < size.height) {
                drawLine(line, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
                y += grid
            }
        }
        content()
    }
}

@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = jarvisColors().muted2) {
    Text(
        text.uppercase(),
        modifier = modifier,
        color = color,
        style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 1.7.sp, fontSize = 9.5.sp),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
fun SectionHeading(
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    subtitle: String? = null,
    action: String? = null,
    actionIcon: ImageVector? = null,
    compact: Boolean = false,
    onAction: (() -> Unit)? = null,
) {
    val palette = jarvisColors()
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            if (eyebrow != null) Eyebrow(eyebrow)
            Text(title, style = if (compact) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleLarge, color = palette.textStrong, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (action != null && onAction != null) {
            TextButton(onClick = onAction, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                Text(action, color = palette.accent, style = MaterialTheme.typography.labelLarge, maxLines = 1)
                if (actionIcon != null) {
                    Spacer(Modifier.width(4.dp))
                    Icon(actionIcon, null, Modifier.size(14.dp), tint = palette.accent)
                }
            }
        }
    }
}

@Composable
fun JarvisCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padding: Dp = 18.dp,
    shape: RoundedCornerShape = RoundedCornerShape(18.dp),
    color: Color? = null,
    content: @Composable () -> Unit,
) {
    val palette = jarvisColors()
    val base = modifier
        .fillMaxWidth()
        .background(color ?: palette.surface, shape)
        .border(1.dp, palette.line, shape)
        .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
    Box(base.padding(padding)) { content() }
}

@Composable
fun PrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
    onClick: () -> Unit,
) {
    val palette = jarvisColors()
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = palette.accent,
            contentColor = palette.accentInk,
            disabledContainerColor = palette.accent.copy(alpha = 0.35f),
            disabledContentColor = palette.accentInk.copy(alpha = 0.7f),
        ),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 11.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(15.dp), color = palette.accentInk, strokeWidth = 2.dp)
        } else {
            if (icon != null) {
                Icon(icon, null, Modifier.size(16.dp))
                Spacer(Modifier.width(7.dp))
            }
            Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun QuietButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    onClick: () -> Unit,
) {
    val palette = jarvisColors()
    TextButton(onClick = onClick, enabled = enabled, modifier = modifier, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 6.dp)) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(15.dp), tint = palette.muted)
            Spacer(Modifier.width(5.dp))
        }
        Text(text, color = palette.muted, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun OutlineButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    onClick: () -> Unit,
) {
    val palette = jarvisColors()
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(11.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = palette.text),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 9.dp),
    ) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(15.dp), tint = palette.accent)
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

@Composable
fun Pill(
    text: String,
    modifier: Modifier = Modifier,
    color: Color? = null,
    background: Color? = null,
    onClick: (() -> Unit)? = null,
) {
    val palette = jarvisColors()
    val shape = CircleShape
    val tint = color ?: palette.muted
    val bg = background ?: palette.surface2
    val base = modifier.background(bg, shape).border(1.dp, tint.copy(alpha = 0.18f), shape)
    Box(base.then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 10.dp, vertical = 5.dp)) {
        Text(text, color = tint, style = MaterialTheme.typography.labelMedium, maxLines = 1)
    }
}

/** A small status dot + label used for connection and application states. */
@Composable
fun StatusBadge(text: String, color: Color, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).background(color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = color, maxLines = 1)
    }
}

@Composable
fun EmptyState(
    title: String,
    text: String,
    modifier: Modifier = Modifier,
    glyph: String = "◇",
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val palette = jarvisColors()
    Column(modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 26.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(46.dp).border(1.dp, palette.line, CircleShape), contentAlignment = Alignment.Center) {
            Text(glyph, color = palette.accent, style = MaterialTheme.typography.titleLarge)
        }
        Text(title, style = MaterialTheme.typography.titleMedium, color = palette.textStrong)
        Text(text, style = MaterialTheme.typography.bodySmall, color = palette.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (action != null && onAction != null) OutlineButton(action, onClick = onAction)
    }
}

@Composable
fun MetricBar(label: String, value: Double?, modifier: Modifier = Modifier) {
    val palette = jarvisColors()
    val ratio = ((value ?: 0.0) / 100.0).coerceIn(0.0, 1.0)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = palette.muted)
            Text(if (value == null) "—" else "${value.toInt()}%", style = MaterialTheme.typography.titleMedium, color = palette.textStrong)
        }
        Box(Modifier.fillMaxWidth().height(3.dp).background(palette.text.copy(alpha = 0.08f), CircleShape)) {
            Box(
                Modifier
                    .fillMaxWidth(ratio.toFloat().coerceIn(0.004f, 1f))
                    .height(3.dp)
                    .background(Brush.horizontalGradient(listOf(palette.accent.copy(alpha = 0.45f), palette.accent)), CircleShape),
            )
        }
    }
}

/** Rounded app identity: a controlled monogram with an accent halo. */
@Composable
fun AppIdentityMark(name: String, id: String, modifier: Modifier = Modifier, size: Dp = 46.dp) {
    val palette = jarvisColors()
    val tint = when {
        id.contains("immich") -> Color(0xFF8F97FF)
        id.contains("homeassistant") || id.contains("home-assistant") -> Color(0xFF2EC5F2)
        id.contains("jellyfin") -> Color(0xFF22A9DD)
        id.contains("qbit") -> Color(0xFF6F9BEA)
        id.contains("mosquitto") -> Color(0xFFB28EE4)
        id.contains("authentik") -> Color(0xFFF07453)
        else -> palette.accent
    }
    Box(
        modifier.size(size).background(
            Brush.linearGradient(listOf(tint.copy(alpha = 0.42f), tint.copy(alpha = 0.14f))),
            RoundedCornerShape(size * 0.28f),
        ).border(1.dp, tint.copy(alpha = 0.32f), RoundedCornerShape(size * 0.28f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().take(1).uppercase().ifBlank { "◇" },
            color = Color.White.copy(alpha = 0.94f),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
fun SheetHeader(title: String, subtitle: String? = null, onClose: (() -> Unit)? = null) {
    val palette = jarvisColors()
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = palette.muted)
        }
        if (onClose != null) {
            Surface(onClick = onClose, shape = CircleShape, color = palette.surface2, modifier = Modifier.size(34.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Close, "关闭", Modifier.size(16.dp), tint = palette.muted) }
            }
        }
    }
}

@Composable
fun KeyValueRow(label: String, value: String, modifier: Modifier = Modifier, monospace: Boolean = false) {
    val palette = jarvisColors()
    Row(modifier.fillMaxWidth().padding(vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(label, Modifier.weight(0.85f), style = MaterialTheme.typography.bodySmall, color = palette.muted)
        Text(
            value.ifBlank { "—" },
            Modifier.weight(1.4f),
            style = if (monospace) MaterialTheme.typography.bodySmall.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace) else MaterialTheme.typography.bodySmall,
            color = palette.text,
        )
    }
}

@Composable
fun Divider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(jarvisColors().line))
}

@Composable
fun LoadingLine(text: String = "正在读取…", modifier: Modifier = Modifier) {
    Row(modifier.padding(vertical = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        CircularProgressIndicator(Modifier.size(15.dp), strokeWidth = 2.dp, color = jarvisColors().accent)
        Text(text, style = MaterialTheme.typography.bodySmall, color = jarvisColors().muted)
    }
}
