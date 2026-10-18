package cloud.jarvis.app.voice

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.AppPreferences
import cloud.jarvis.app.M2Repository
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.formatClock
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Full-screen, Doubao-like voice call. The orb is the only primary control:
 * tap while Jarvis speaks to interrupt, tap while listening to finish early.
 */
@Composable
fun VoiceCallScreen(
    repo: M2Repository,
    onClose: (conversationId: String?) -> Unit,
) {
    val palette = jarvisColors()
    val context = LocalContext.current
    val prefs = remember { AppPreferences(context) }
    val controller = remember {
        VoiceCallController(
            context = context,
            repo = repo,
            initialConversationId = repo.selectedId(),
            speakerOnStart = prefs.voiceSpeaker,
            speechRate = prefs.voiceRate,
        )
    }
    val state by controller.state.collectAsStateWithLifecycle()
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
    }
    var started by remember { mutableStateOf(false) }
    var keyboardOpen by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var rate by remember { mutableFloatStateOf(prefs.voiceRate) }
    val scope = rememberCoroutineScope()
    val transcript = rememberScrollState()
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        granted = allowed
        if (allowed && !started) {
            controller.start()
            started = true
        } else if (!allowed) keyboardOpen = true
    }

    fun close() {
        controller.end()
        prefs.voiceSpeaker = state.speaker
        prefs.voiceRate = rate
        onClose(controller.conversationId ?: repo.selectedId())
    }

    LaunchedEffect(Unit) {
        if (granted) {
            controller.start()
            started = true
        } else {
            permission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    LaunchedEffect(state.speechAvailable) {
        if (!state.speechAvailable) keyboardOpen = true
    }
    LaunchedEffect(keyboardOpen) { controller.setKeyboardMode(keyboardOpen) }
    LaunchedEffect(state.turns.size, state.partial, state.replyDraft) {
        if (transcript.maxValue > 0) runCatching { transcript.animateScrollTo(transcript.maxValue) }
    }
    DisposableEffect(Unit) { onDispose { controller.end() } }
    BackHandler {
        controller.end()
        onClose(controller.conversationId ?: repo.selectedId())
    }

    val transition = rememberInfiniteTransition(label = "voice")
    val wave by transition.animateFloat(
        initialValue = 0.32f,
        targetValue = 0.92f,
        animationSpec = infiniteRepeatable(tween(620, easing = LinearEasing), RepeatMode.Reverse),
        label = "wave",
    )
    val orbit by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(12_000, easing = LinearEasing), RepeatMode.Restart),
        label = "orbit",
    )
    val level = when (state.phase) {
        VoicePhase.listening -> state.level
        VoicePhase.speaking -> wave
        else -> 0f
    }
    val orbMode = when (state.phase) {
        VoicePhase.listening -> OrbMode.Listening
        VoicePhase.thinking -> OrbMode.Thinking
        VoicePhase.speaking -> OrbMode.Speaking
        else -> OrbMode.Idle
    }
    val submitTyped = {
        val value = typed
        typed = ""
        if (value.isNotBlank()) controller.sendTyped(value)
    }
    val phaseLabel = when {
        keyboardOpen && state.phase == VoicePhase.typing -> "键盘输入"
        else -> when (state.phase) {
            VoicePhase.preparing -> "正在接通"
            VoicePhase.listening -> if (state.partial.isBlank()) "正在聆听" else "我在听"
            VoicePhase.typing -> "键盘输入"
            VoicePhase.thinking -> "正在思考"
            VoicePhase.speaking -> "Jarvis 正在回答"
            VoicePhase.muted -> "麦克风已静音"
            VoicePhase.error -> "语音暂时不可用"
            VoicePhase.ended -> "通话已结束"
        }
    }

    Box(
        Modifier.fillMaxSize().background(
            Brush.radialGradient(
                colors = listOf(
                    palette.accent.copy(alpha = if (palette.light) 0.18f else 0.20f),
                    Color.Transparent,
                ),
                center = Offset(0.5f * 1000f, 0.2f * 1000f),
                radius = 1100f,
            ),
        ),
    ) {
        // Lantern night sky and orbit.
        Canvas(Modifier.fillMaxSize()) {
            drawRect(
                Brush.verticalGradient(listOf(palette.hero1, palette.background, palette.hero1)),
            )
            val random = kotlin.random.Random(7)
            repeat(46) {
                val x = random.nextFloat() * size.width
                val y = random.nextFloat() * size.height
                drawCircle(
                    color = palette.text.copy(alpha = 0.05f + random.nextFloat() * 0.18f),
                    radius = 0.6f + random.nextFloat() * 1.1f,
                    center = Offset(x, y),
                )
            }
            val center = Offset(size.width / 2f, size.height * 0.40f)
            repeat(2) { index ->
                val radius = size.width * (0.33f + index * 0.11f)
                drawCircle(
                    color = palette.accent.copy(alpha = 0.10f - index * 0.03f),
                    radius = radius,
                    center = center,
                    style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1f),
                )
                val angle = (orbit + index * 160f) * PI.toFloat() / 180f
                drawCircle(
                    color = palette.accent.copy(alpha = 0.5f),
                    radius = 2.2.dp.toPx(),
                    center = Offset(center.x + cos(angle) * radius, center.y + sin(angle) * radius),
                )
            }
        }

        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(horizontal = 22.dp)) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Eyebrow("JARVIS · VOICE CALL")
                    Text(
                        if (state.phase == VoicePhase.ended) "通话结束" else formatClock(state.elapsedSeconds),
                        style = MaterialTheme.typography.labelLarge.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace),
                        color = palette.muted,
                    )
                }
                VoiceLevelBars(level = level, active = state.phase in listOf(VoicePhase.listening, VoicePhase.speaking), modifier = Modifier.padding(end = 10.dp))
                Surface(onClick = { close() }, shape = CircleShape, color = palette.surface2.copy(alpha = 0.7f), modifier = Modifier.size(36.dp)) {
                    Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Close, "结束通话", Modifier.size(16.dp), tint = palette.muted) }
                }
            }

            if (!keyboardOpen) {
                Spacer(Modifier.weight(0.22f))
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    JarvisOrb(176.dp, mode = orbMode, audioLevel = level, animated = true)
                    Spacer(Modifier.height(4.dp))
                    Text(phaseLabel, style = MaterialTheme.typography.headlineSmall, color = palette.textStrong, textAlign = TextAlign.Center)
                    Text(
                        when (state.phase) {
                            VoicePhase.listening -> if (state.partial.isBlank()) "说完会自动发送 · 也可以轻触光球结束这句" else "轻触光球结束这句"
                            VoicePhase.speaking -> "轻触光球可以打断"
                            VoicePhase.thinking -> "正在调用 Jarvis 的能力…"
                            VoicePhase.typing -> "输入后发送，或关闭键盘继续说话"
                            VoicePhase.muted -> "轻触麦克风恢复收音"
                            VoicePhase.error -> state.error ?: state.status
                            VoicePhase.preparing -> "正在准备语音引擎…"
                            VoicePhase.ended -> ""
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = palette.muted,
                        textAlign = TextAlign.Center,
                    )
                    if (state.partial.isNotBlank()) {
                        Text(
                            state.partial,
                            style = MaterialTheme.typography.bodyLarge,
                            color = palette.textStrong,
                            textAlign = TextAlign.Center,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 16.dp),
                        )
                    }
                }
                Spacer(Modifier.weight(0.18f))
                Column(
                    Modifier.fillMaxWidth().heightIn(max = 168.dp).verticalScroll(transcript),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    val shown = buildList {
                        addAll(state.turns.takeLast(6))
                        if (state.partial.isNotBlank()) add(VoiceTurn(-1, "user", state.partial))
                        if (state.replyDraft.isNotBlank()) add(VoiceTurn(-2, "jarvis", state.replyDraft))
                    }
                    shown.forEach { turn ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (turn.role == "user") Arrangement.End else Arrangement.Start) {
                            Column(
                                Modifier.widthIn(max = 300.dp)
                                    .background(if (turn.role == "user") palette.surface2 else palette.surface.copy(alpha = 0.55f), RoundedCornerShape(14.dp))
                                    .border(1.dp, palette.line, RoundedCornerShape(14.dp))
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                            ) {
                                Text(
                                    if (turn.role == "user") "你" else "Jarvis",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (turn.role == "user") palette.muted2 else palette.accent,
                                )
                                Text(
                                    turn.text + if (turn.interrupted) " …（已打断）" else "",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = palette.text,
                                    maxLines = 4,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
            } else {
                Spacer(Modifier.weight(0.35f))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    JarvisOrb(56.dp, mode = orbMode, audioLevel = level, animated = true)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(if (typed.isBlank()) "想说什么，写下来也可以" else "正在输入", style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                        Text(phaseLabel, style = MaterialTheme.typography.labelSmall, color = palette.muted)
                    }
                }
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier.fillMaxWidth().background(palette.surface2.copy(alpha = 0.92f), RoundedCornerShape(16.dp)).border(1.dp, palette.line, RoundedCornerShape(16.dp)).padding(start = 8.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = typed,
                        onValueChange = { typed = it },
                        placeholder = { Text("输入想说的话…", style = MaterialTheme.typography.bodySmall) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        textStyle = MaterialTheme.typography.bodyMedium,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { submitTyped() }),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color.Transparent,
                            unfocusedBorderColor = Color.Transparent,
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent,
                        ),
                    )
                    Surface(
                        onClick = { submitTyped() },
                        shape = CircleShape,
                        color = if (typed.isBlank()) palette.surface3 else palette.accent,
                        modifier = Modifier.size(38.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(JarvisIcons.Send, "发送", Modifier.size(16.dp), tint = if (typed.isBlank()) palette.muted2 else palette.accentInk)
                        }
                    }
                }
                Spacer(Modifier.weight(0.65f))
            }

            Row(
                Modifier.fillMaxWidth().padding(bottom = 12.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                VoiceControl(
                    icon = JarvisIcons.Mic,
                    label = if (state.muted) "取消静音" else "静音",
                    active = state.muted,
                    danger = false,
                    onClick = { controller.toggleMute() },
                )
                VoiceControl(
                    icon = JarvisIcons.Speaker,
                    label = if (state.speaker) "扬声器" else "听筒",
                    active = state.speaker,
                    danger = false,
                    onClick = { controller.toggleSpeaker() },
                )
                VoiceControl(
                    icon = JarvisIcons.Keyboard,
                    label = "键盘",
                    active = keyboardOpen,
                    danger = false,
                    onClick = { keyboardOpen = !keyboardOpen },
                )
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Surface(
                        onClick = { close() },
                        shape = CircleShape,
                        color = palette.danger,
                        modifier = Modifier.size(58.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(JarvisIcons.Phone, "结束通话", Modifier.size(23.dp).rotate(135f), tint = Color.White)
                        }
                    }
                    Text("结束", style = MaterialTheme.typography.labelSmall, color = palette.danger)
                }
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (state.ttsAvailable) "语音播报已开启" else "语音播报不可用 · 显示字幕",
                    style = MaterialTheme.typography.labelSmall,
                    color = palette.muted2,
                )
                Spacer(Modifier.width(10.dp))
                listOf(0.85f to "慢", 1.0f to "标准", 1.15f to "快").forEach { (value, label) ->
                    Surface(
                        onClick = { rate = value; controller.setRate(value); prefs.voiceRate = value },
                        shape = CircleShape,
                        color = if (kotlin.math.abs(rate - value) < 0.01f) palette.accentSoft else Color.Transparent,
                    ) {
                        Text(
                            label,
                            Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (kotlin.math.abs(rate - value) < 0.01f) palette.accent else palette.muted2,
                        )
                    }
                }
            }
        }

        if (!granted) {
            Box(Modifier.fillMaxSize().background(palette.background.copy(alpha = 0.86f)), contentAlignment = Alignment.Center) {
                JarvisCard(padding = 22.dp, modifier = Modifier.padding(30.dp)) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        JarvisOrb(72.dp, mode = OrbMode.Idle, animated = false)
                        Text("允许麦克风", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
                        Text(
                            "语音通话需要麦克风来听取你的问题。音频只在设备与语音服务之间处理；Jarvis 服务端只接收转写后的文字。",
                            style = MaterialTheme.typography.bodySmall,
                            color = palette.muted,
                            textAlign = TextAlign.Center,
                        )
                        PrimaryButton("授权并开始通话", Modifier.fillMaxWidth(), icon = JarvisIcons.Mic) {
                            permission.launch(Manifest.permission.RECORD_AUDIO)
                        }
                        TextButton(onClick = { close() }) { Text("以后再说", color = palette.muted) }
                    }
                }
            }
        }
    }
}

@Composable
private fun VoiceControl(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean,
    danger: Boolean,
    onClick: () -> Unit,
) {
    val palette = jarvisColors()
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Surface(
            onClick = onClick,
            shape = CircleShape,
            color = when {
                danger -> palette.danger
                active -> palette.accentSoft
                else -> palette.surface2.copy(alpha = 0.85f)
            },
            border = androidx.compose.foundation.BorderStroke(1.dp, if (active) palette.accent.copy(alpha = 0.4f) else palette.line),
            modifier = Modifier.size(52.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(icon, label, Modifier.size(20.dp), tint = if (active) palette.accent else palette.muted)
            }
        }
        Text(label, style = MaterialTheme.typography.labelSmall, color = if (active) palette.accent else palette.muted2)
    }
}
