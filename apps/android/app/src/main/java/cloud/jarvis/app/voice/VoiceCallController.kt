package cloud.jarvis.app.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.speech.SpeechRecognizer
import cloud.jarvis.app.LiveReply
import cloud.jarvis.app.M2Repository
import cloud.jarvis.app.str
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

enum class VoicePhase { preparing, listening, typing, thinking, speaking, muted, error, ended }

data class VoiceTurn(val id: Long, val role: String, val text: String, val interrupted: Boolean = false)

data class VoiceCallState(
    val phase: VoicePhase = VoicePhase.preparing,
    val turns: List<VoiceTurn> = emptyList(),
    val partial: String = "",
    val replyDraft: String = "",
    val status: String = "正在准备麦克风…",
    val error: String? = null,
    val elapsedSeconds: Long = 0,
    val level: Float = 0f,
    val muted: Boolean = false,
    val speaker: Boolean = true,
    val speechAvailable: Boolean = true,
    val ttsAvailable: Boolean = true,
    val conversationId: String? = null,
    val turnId: String? = null,
    val speakingRate: Float = 1f,
)

/**
 * The voice-call state machine.
 *
 * Turn shape mirrors a phone call: listen → recognise → think → stream + speak →
 * listen again. Speaking can be interrupted at any time; the server turn is
 * stopped so a new utterance does not queue behind a reply the user no longer
 * wants.
 */
class VoiceCallController(
    context: Context,
    private val repo: M2Repository,
    private val initialConversationId: String?,
    speakerOnStart: Boolean,
    speechRate: Float,
) : RecognitionListenerCallback {
    private val appContext = context.applicationContext
    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val audioManager = appContext.getSystemService(AudioManager::class.java)
    private val mutableState = MutableStateFlow(
        VoiceCallState(
            speaker = speakerOnStart,
            conversationId = initialConversationId,
            speakingRate = speechRate,
            status = "正在准备麦克风…",
        ),
    )
    val state: StateFlow<VoiceCallState> = mutableState.asStateFlow()

    private var recognizer: RecognitionEngine? = null
    private var synthesizer: SpeechSynthesizer? = null
    private var timerJob: Job? = null
    private var turnJob: Job? = null
    private var greetingPending = true
    private var greetingStarted = false
    private var greetingSpeaking = false
    private var greetingSayLater: String? = null
    private var turnFinished = false
    private var spokenOffset = 0
    private var lastSanitized = ""
    private var turnCount = 0L
    private var consecutiveErrors = 0
    private var starting = false
    private var focusRequest: AudioFocusRequest? = null
    private var previousSpeaker = false
    private var ended = false

    private val focusListener = AudioManager.OnAudioFocusChangeListener { }

    val conversationId: String? get() = mutableState.value.conversationId

    fun start() {
        if (starting || ended) return
        starting = true
        previousSpeaker = runCatching { audioManager?.isSpeakerphoneOn == true }.getOrDefault(false)
        requestAudioFocus()
        applySpeaker(mutableState.value.speaker)
        recognizer = RecognitionEngine(appContext, this)
        val speech = recognizer
        mutableState.update { it.copy(speechAvailable = speech?.available == true || it.speechAvailable) }
        if (speech?.available == false) {
            mutableState.update {
                it.copy(
                    speechAvailable = false,
                    status = "此设备没有可用的语音识别服务，可以使用键盘输入。",
                )
            }
        }
        synthesizer = SpeechSynthesizer(
            appContext,
            rate = mutableState.value.speakingRate,
            onReady = {
                mutableState.update { it.copy(ttsAvailable = true) }
                val pendingGreeting = greetingSayLater
                greetingSayLater = null
                if (pendingGreeting != null) {
                    greetingSpeaking = true
                    mutableState.update { it.copy(phase = VoicePhase.speaking, status = "Jarvis 正在说话") }
                    synthesizer?.speak(pendingGreeting)
                    synthesizer?.finish()
                } else if (greetingPending) {
                    speakGreeting()
                } else if (mutableState.value.phase == VoicePhase.preparing) {
                    startListening()
                }
            },
            onIdle = { handleSpeechIdle() },
            onUnavailable = {
                mutableState.update { it.copy(ttsAvailable = false) }
                greetingSayLater = null
                greetingSpeaking = false
                if (greetingPending) {
                    greetingPending = false
                    startListening()
                } else if (turnFinished) {
                    startListening()
                }
            },
        )
        timerJob = mainScope.launch {
            while (isActive && !ended) {
                delay(1000)
                mutableState.update { it.copy(elapsedSeconds = it.elapsedSeconds + 1) }
            }
        }
        // Give the engine a brief chance to initialise, then greet or listen.
        mainScope.launch {
            delay(1200)
            if (greetingPending && !ended) speakGreeting()
        }
    }

    private fun speakGreeting() {
        if (!greetingPending || ended || greetingStarted) return
        greetingStarted = true
        greetingPending = false
        val greeting = if (mutableState.value.conversationId == null) {
            "你好，我是 Jarvis。今天想让我帮你做什么？"
        } else {
            "我在。继续说就好。"
        }
        addTurn("jarvis", greeting)
        mutableState.update { it.copy(phase = VoicePhase.speaking, status = "Jarvis 正在说话") }
        val speech = synthesizer
        if (speech != null && speech.isAvailable && speech.isReady) {
            greetingSpeaking = true
            speech.speak(greeting)
            speech.finish()
        } else if (speech != null && speech.isAvailable) {
            greetingSayLater = greeting
        } else {
            mainScope.launch { delay(500); startListening() }
        }
    }

    private fun startListening() {
        if (ended || mutableState.value.muted) {
            if (mutableState.value.muted) mutableState.update { it.copy(phase = VoicePhase.muted, status = "麦克风已静音") }
            return
        }
        val speech = recognizer
        if (speech == null || !speech.available) {
            mutableState.update {
                it.copy(
                    phase = VoicePhase.error,
                    speechAvailable = false,
                    status = "语音识别不可用，请使用键盘输入。",
                )
            }
            return
        }
        mutableState.update {
            it.copy(
                phase = VoicePhase.listening,
                partial = "",
                level = 0f,
                status = "正在聆听…",
                error = null,
                speechAvailable = true,
            )
        }
        speech.start("zh-CN")
    }

    // ------------------------------------------------------------------
    // Recognition callbacks
    // ------------------------------------------------------------------

    override fun onReady() {
        mutableState.update { it.copy(phase = VoicePhase.listening, status = "我在听", level = 0f) }
    }

    override fun onSpeechStart() {
        consecutiveErrors = 0
        mutableState.update { it.copy(phase = VoicePhase.listening, status = "我在听") }
    }

    override fun onPartial(text: String) {
        mutableState.update { it.copy(partial = text, phase = VoicePhase.listening, status = "我在听") }
    }

    override fun onFinal(text: String) {
        if (ended) return
        val value = text.trim()
        if (value.isEmpty()) { restartListeningSoon(); return }
        consecutiveErrors = 0
        recognizer?.cancel()
        addTurn("user", value)
        mutableState.update { it.copy(partial = "", phase = VoicePhase.thinking, status = "正在思考…", level = 0f) }
        send(value)
    }

    override fun onLevel(level: Float) {
        if (mutableState.value.phase == VoicePhase.listening) mutableState.update { it.copy(level = level) }
    }

    override fun onError(code: Int) {
        if (ended) return
        when (code) {
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                mutableState.update {
                    it.copy(
                        phase = VoicePhase.error,
                        speechAvailable = false,
                        status = "需要麦克风权限才能语音通话。",
                        error = "请在系统设置中允许 Jarvis 使用麦克风。",
                    )
                }
            }
            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> restartListeningSoon()
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT -> {
                consecutiveErrors++
                if (consecutiveErrors >= 3) {
                    mutableState.update {
                        it.copy(phase = VoicePhase.error, speechAvailable = false, status = "语音识别暂时不可用，请使用键盘输入。")
                    }
                } else restartListeningSoon(600)
            }
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> {
                consecutiveErrors++
                mutableState.update { it.copy(status = "识别服务连接不稳定，正在重试…") }
                if (consecutiveErrors >= 4) {
                    mutableState.update { it.copy(phase = VoicePhase.error, speechAvailable = false, status = "语音识别服务暂时不可用，请使用键盘输入。") }
                } else restartListeningSoon(900)
            }
            else -> restartListeningSoon(700)
        }
    }

    override fun onEndOfSpeech() {
        if (mutableState.value.phase == VoicePhase.listening) {
            mutableState.update { it.copy(status = "正在整理你的话…") }
        }
    }

    private fun restartListeningSoon(delayMs: Long = 350) {
        if (ended || mutableState.value.muted) return
        if (mutableState.value.phase == VoicePhase.speaking || mutableState.value.phase == VoicePhase.thinking) return
        mainScope.launch {
            delay(delayMs)
            if (!ended && mutableState.value.phase != VoicePhase.speaking && mutableState.value.phase != VoicePhase.thinking) startListening()
        }
    }

    // ------------------------------------------------------------------
    // Turn sending and streaming
    // ------------------------------------------------------------------

    private fun send(text: String) {
        synthesizer?.stop()
        recognizer?.cancel()
        mutableState.value.turnId?.let { previous -> repo.stop(previous) }
        turnJob?.cancel()
        turnFinished = false
        spokenOffset = 0
        lastSanitized = ""
        mutableState.update { it.copy(replyDraft = "", turnId = null) }
        turnJob = mainScope.launch {
            try {
                val accepted = repo.submit(text, conversationId = mutableState.value.conversationId)
                val conversationId = accepted.str("conversation_id").ifBlank { repo.selectedId().orEmpty() }
                val turnId = accepted.str("turn_id")
                mutableState.update { it.copy(conversationId = conversationId, turnId = turnId) }
                // The accepted reply is already mirroring in liveReply. Watch it
                // until the terminal status event arrives.
                val done = CompletableDeferred<LiveReply>()
                val collector = launch {
                    repo.liveReply.filterNotNull().collect { reply ->
                        if (reply.turnId != turnId) return@collect
                        handleReply(reply)
                        if (reply.finished && !done.isCompleted) done.complete(reply)
                    }
                }
                val initial = repo.liveReply.value
                if (initial != null && initial.turnId == turnId && initial.finished && !done.isCompleted) done.complete(initial)
                // Events are the live path. Polling recovers a dropped
                // conversation.status/delta frame without losing the turn.
                val poller = launch {
                    while (isActive && !done.isCompleted) {
                        delay(1600)
                        val snapshot = runCatching { repo.syncLiveReply(conversationId, accepted.str("reply_id")) }.getOrNull()
                        if (snapshot != null) {
                            handleReply(snapshot)
                            if (snapshot.finished && !done.isCompleted) done.complete(snapshot)
                        }
                    }
                }
                val finalReply = withTimeout(180_000) { done.await() }
                collector.cancel()
                poller.cancel()
                finishTurn(finalReply)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                collectorFailure(error)
            }
        }
    }

    private fun handleReply(reply: LiveReply) {
        if (reply.content.isEmpty()) {
            if (reply.status in listOf("completed", "failed", "cancelled")) {
                mutableState.update { it.copy(status = statusFor(reply.status)) }
            }
            return
        }
        val clean = VoiceText.sanitize(reply.content)
        if (clean.length < spokenOffset) spokenOffset = 0
        val (sentences, next) = VoiceText.completeSentences(clean, spokenOffset)
        spokenOffset = next
        lastSanitized = clean
        mutableState.update {
            it.copy(
                replyDraft = reply.content,
                phase = VoicePhase.speaking,
                status = "Jarvis 正在回答",
                error = null,
            )
        }
        if (sentences.isNotEmpty()) {
            val speech = synthesizer
            if (speech != null && speech.isAvailable) {
                speech.speak(sentences.joinToString(" "))
            }
        }
    }

    private suspend fun finishTurn(reply: LiveReply) {
        if (ended) return
        var content = reply.content
        if (content.isBlank()) {
            content = readFinalMessage(reply.messageId) ?: ""
        }
        if (content.isNotBlank()) {
            val clean = VoiceText.sanitize(content)
            if (clean.length < spokenOffset) spokenOffset = 0
            val (sentences, next) = VoiceText.completeSentences(clean, spokenOffset)
            if (sentences.isNotEmpty()) {
                synthesizer?.takeIf { it.isAvailable }?.speak(sentences.joinToString(" "))
            }
            spokenOffset = next
            val rest = clean.substring(spokenOffset.coerceAtMost(clean.length)).trim()
            if (rest.isNotEmpty()) {
                val chunks = VoiceText.splitLongTail(rest)
                chunks.forEach { synthesizer?.takeIf { it.isAvailable }?.speak(it) }
                spokenOffset = clean.length
            }
            addTurn("jarvis", VoiceText.sanitize(content).ifBlank { content })
        } else if (reply.status == "failed" || reply.status == "cancelled") {
            val message = if (reply.status == "cancelled") "已停止回答。" else "抱歉，刚才没有成功。"
            addTurn("jarvis", message)
            synthesizer?.takeIf { it.isAvailable }?.speak(message)
        }
        mutableState.update {
            it.copy(replyDraft = "", phase = VoicePhase.speaking, status = statusFor(reply.status), turnId = null)
        }
        turnFinished = true
        val speech = synthesizer
        if (speech != null && speech.isAvailable) {
            speech.finish()
        } else {
            startListening()
        }
    }

    private fun collectorFailure(error: Exception) {
        val message = if (error is TimeoutCancellationException) "等待回答超时了，再试一次吧。" else "连接暂时中断，请再说一次。"
        addTurn("jarvis", message)
        mutableState.update { it.copy(phase = VoicePhase.speaking, status = message, replyDraft = "") }
        synthesizer?.takeIf { it.isAvailable }?.speak(message)
        turnFinished = true
        if (synthesizer?.isAvailable == true) synthesizer?.finish() else startListening()
    }

    private suspend fun readFinalMessage(messageId: String): String? {
        if (messageId.isEmpty()) return null
        repeat(8) {
            val result = (repo.conversation.value?.get("messages") as? kotlinx.serialization.json.JsonArray)
                ?.mapNotNull { it as? JsonObject }
                ?.firstOrNull { it.str("id") == messageId }
            if (result != null) return result.str("content")
            delay(250)
        }
        return null
    }

    private fun handleSpeechIdle() {
        if (ended) return
        if (turnFinished && mutableState.value.phase == VoicePhase.speaking) {
            turnFinished = false
            if (mutableState.value.muted) {
                mutableState.update { it.copy(phase = VoicePhase.muted, status = "麦克风已静音") }
            } else startListening()
            return
        }
        if (greetingSpeaking) {
            greetingSpeaking = false
            startListening()
            return
        }
        if (greetingPending) {
            speakGreeting()
            return
        }
        if (mutableState.value.phase == VoicePhase.preparing) startListening()
    }

    // ------------------------------------------------------------------
    // Public controls
    // ------------------------------------------------------------------

    fun toggleMute() {
        val muted = !mutableState.value.muted
        mutableState.update { it.copy(muted = muted) }
        if (muted) {
            recognizer?.cancel()
            if (mutableState.value.phase in listOf(VoicePhase.listening, VoicePhase.thinking)) {
                mutableState.update { it.copy(phase = VoicePhase.muted, partial = "", status = "麦克风已静音") }
            }
        } else if (mutableState.value.phase == VoicePhase.muted || mutableState.value.phase == VoicePhase.error) {
            startListening()
        }
    }

    fun toggleSpeaker() {
        val next = !mutableState.value.speaker
        mutableState.update { it.copy(speaker = next) }
        applySpeaker(next)
    }

    fun setRate(value: Float) {
        mutableState.update { it.copy(speakingRate = value.coerceIn(0.7f, 1.4f)) }
    }

    /** Pause the hot microphone while the user is typing. */
    fun setKeyboardMode(open: Boolean) {
        if (open) {
            recognizer?.cancel()
            if (mutableState.value.phase == VoicePhase.listening) {
                mutableState.update { it.copy(phase = VoicePhase.typing, partial = "", status = "键盘输入中") }
            }
        } else if (mutableState.value.phase == VoicePhase.typing) {
            startListening()
        }
    }

    /** Tap while speaking/thinking interrupts; tap while listening submits now. */
    fun tapOrb() {
        when (mutableState.value.phase) {
            VoicePhase.speaking, VoicePhase.thinking -> interrupt()
            VoicePhase.listening -> recognizer?.stop()
            VoicePhase.typing -> startListening()
            VoicePhase.muted -> toggleMute()
            else -> startListening()
        }
    }

    fun interrupt() {
        synthesizer?.stop()
        turnJob?.cancel()
        mutableState.value.turnId?.let { repo.stop(it) }
        val draft = mutableState.value.replyDraft
        if (draft.isNotBlank()) {
            addTurn("jarvis", VoiceText.sanitize(draft).trim().take(1200), interrupted = true)
        }
        mutableState.update { it.copy(replyDraft = "", phase = VoicePhase.listening, status = "我在听", turnId = null) }
        turnFinished = false
        spokenOffset = 0
        startListening()
    }

    fun sendTyped(text: String) {
        val value = text.trim()
        if (value.isEmpty()) return
        synthesizer?.stop()
        recognizer?.cancel()
        mutableState.value.turnId?.let { previous -> repo.stop(previous) }
        addTurn("user", value)
        mutableState.update { it.copy(phase = VoicePhase.thinking, status = "正在思考…", partial = "") }
        send(value)
    }

    fun end() {
        ended = true
        turnJob?.cancel()
        timerJob?.cancel()
        recognizer?.cancel()
        recognizer?.release()
        recognizer = null
        synthesizer?.release()
        synthesizer = null
        abandonAudioFocus()
        applySpeaker(previousSpeaker)
        mutableState.update { it.copy(phase = VoicePhase.ended) }
    }

    private fun addTurn(role: String, text: String, interrupted: Boolean = false) {
        turnCount++
        mutableState.update { it.copy(turns = (it.turns + VoiceTurn(turnCount, role, text, interrupted)).takeLast(60)) }
    }

    private fun statusFor(status: String): String = when (status) {
        "completed" -> "回答完成"
        "failed" -> "回答未完成"
        "cancelled" -> "已停止回答"
        else -> "Jarvis 正在回答"
    }

    private fun requestAudioFocus() {
        val manager = audioManager ?: return
        runCatching {
            focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setOnAudioFocusChangeListener(focusListener)
                .build()
                .also { manager.requestAudioFocus(it) }
        }
    }

    private fun abandonAudioFocus() {
        val manager = audioManager ?: return
        runCatching { focusRequest?.let { manager.abandonAudioFocusRequest(it) } }
        focusRequest = null
    }

    private fun applySpeaker(on: Boolean) {
        val manager = audioManager ?: return
        runCatching {
            manager.mode = AudioManager.MODE_NORMAL
            manager.isSpeakerphoneOn = on
        }
    }
}
