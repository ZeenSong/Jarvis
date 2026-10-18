package cloud.jarvis.app.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import java.util.UUID

interface RecognitionListenerCallback {
    fun onReady()
    fun onSpeechStart()
    fun onPartial(text: String)
    fun onFinal(text: String)
    fun onLevel(level: Float)
    fun onError(code: Int)
    fun onEndOfSpeech()
}

/**
 * Thin wrapper around Android's speech recognizer with a safe restartable
 * lifecycle. Some devices expose no recognizer at all; [available] lets the UI
 * fall back to the keyboard without crashing the call.
 */
class RecognitionEngine(context: Context, private val listener: RecognitionListenerCallback) {
    private val appContext = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    val available: Boolean = runCatching { SpeechRecognizer.isRecognitionAvailable(appContext) }.getOrDefault(false)

    private fun ensureRecognizer(): SpeechRecognizer? {
        if (recognizer != null) return recognizer
        if (!available) return null
        return runCatching {
            val instance = SpeechRecognizer.createSpeechRecognizer(appContext)
            instance.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) { listener.onReady() }
                    override fun onBeginningOfSpeech() { listener.onSpeechStart() }
                    override fun onRmsChanged(rmsdB: Float) { listener.onLevel(((rmsdB + 2f) / 12f).coerceIn(0f, 1f)) }
                    override fun onBufferReceived(buffer: ByteArray?) = Unit
                    override fun onEndOfSpeech() { listening = false; listener.onEndOfSpeech() }
                    override fun onError(error: Int) {
                        listening = false
                        listener.onError(error)
                    }
                    override fun onResults(results: Bundle?) {
                        listening = false
                        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
                        if (text.isNotEmpty()) listener.onFinal(text) else listener.onError(SpeechRecognizer.ERROR_NO_MATCH)
                    }
                    override fun onPartialResults(partialResults: Bundle?) {
                        val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
                        if (text.isNotEmpty()) listener.onPartial(text)
                    }
                    override fun onEvent(eventType: Int, params: Bundle?) = Unit
                })
            recognizer = instance
            instance
        }.getOrNull()
    }

    fun start(languageTag: String = "zh-CN") {
        if (!available || listening) return
        val instance = ensureRecognizer() ?: run { listener.onError(SpeechRecognizer.ERROR_CLIENT); return }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, languageTag)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, appContext.packageName)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1400L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 700L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 900L)
        }
        listening = true
        runCatching { instance.startListening(intent) }.onFailure {
            listening = false
            listener.onError(SpeechRecognizer.ERROR_CLIENT)
        }
    }

    /** Ask for a final result, keeping the current utterance. */
    fun stop() {
        if (!listening) return
        listening = false
        runCatching { recognizer?.stopListening() }
    }

    fun cancel() {
        listening = false
        runCatching { recognizer?.cancel() }
    }

    fun release() {
        listening = false
        main.post {
            runCatching { recognizer?.destroy() }
            recognizer = null
        }
    }
}

/**
 * Sentence queue for streaming TTS. Text that arrives before the engine is
 * initialised is buffered; [finish] triggers [onIdle] once the queue drains.
 */
class SpeechSynthesizer(
    context: Context,
    private val rate: Float,
    private val onReady: () -> Unit,
    private val onIdle: () -> Unit,
    private val onUnavailable: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    private var ready = false
    private var failed = false
    private var queued = 0
    private var flush = false
    private var generation = 0
    private var sequence = 0
    private val pendingBeforeReady = mutableListOf<String>()

    init {
        runCatching {
            engine = TextToSpeech(context.applicationContext) { status ->
                main.post {
                    if (status == TextToSpeech.SUCCESS) {
                        val speech = engine
                        if (speech == null) {
                            failed = true; onUnavailable(); return@post
                        }
                        val language = speech.setLanguage(Locale.SIMPLIFIED_CHINESE)
                        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
                            speech.setLanguage(Locale.getDefault())
                        }
                        speech.setSpeechRate(rate)
                        speech.setPitch(1.02f)
                        speech.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String?) = Unit
                            override fun onDone(utteranceId: String?) { main.post { completeUtterance() } }
                            @Deprecated("Deprecated in Java")
                            override fun onError(utteranceId: String?) { main.post { completeUtterance() } }
                            override fun onError(utteranceId: String?, errorCode: Int) { main.post { completeUtterance() } }
                            override fun onStop(utteranceId: String?, interrupted: Boolean) { main.post { completeUtterance() } }
                        })
                        ready = true
                        onReady()
                        val buffered = pendingBeforeReady.toList()
                        pendingBeforeReady.clear()
                        buffered.forEach { speak(it) }
                        if (flush && queued == 0) {
                            flush = false
                            onIdle()
                        }
                    } else {
                        failed = true
                        onUnavailable()
                    }
                }
            }
        }.onFailure {
            failed = true
            onUnavailable()
        }
    }

    val isAvailable: Boolean get() = !failed
    val isReady: Boolean get() = ready

    fun speak(text: String) {
        val value = text.trim()
        if (value.isEmpty()) return
        if (failed) { onIdle(); return }
        if (!ready) { pendingBeforeReady += value; return }
        val speech = engine ?: run { failed = true; onUnavailable(); return }
        val id = "jarvis-${generation}-${sequence++}"
        queued++
        val result = runCatching { speech.speak(value, TextToSpeech.QUEUE_ADD, null, id) }.getOrDefault(TextToSpeech.ERROR)
        if (result == TextToSpeech.ERROR) {
            queued = (queued - 1).coerceAtLeast(0)
        }
    }

    /** Flush: call [onIdle] when every queued sentence has been spoken. */
    fun finish() {
        flush = true
        if (!ready && pendingBeforeReady.isNotEmpty()) return
        if (queued == 0) {
            flush = false
            onIdle()
        }
    }

    fun stop() {
        generation++
        queued = 0
        flush = false
        pendingBeforeReady.clear()
        runCatching { engine?.stop() }
    }

    fun release() {
        generation++
        queued = 0
        flush = false
        pendingBeforeReady.clear()
        runCatching { engine?.stop() }
        runCatching { engine?.shutdown() }
        engine = null
        ready = false
    }

    private fun completeUtterance() {
        queued = (queued - 1).coerceAtLeast(0)
        if (queued == 0 && flush) {
            flush = false
            onIdle()
        }
    }

    companion object {
        /** Utility for UI previews and tests. */
        fun newUtteranceId(): String = UUID.randomUUID().toString()
    }
}
