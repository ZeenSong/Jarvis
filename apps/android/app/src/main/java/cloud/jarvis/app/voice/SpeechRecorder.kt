package cloud.jarvis.app.voice

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Records a short 16 kHz mono PCM clip and returns a WAV file. WAV is accepted
 * by Whisper, faster-whisper and every OpenAI-compatible transcription API,
 * and avoids the licensing/compatibility questions of an Android encoder.
 */
class SpeechRecorder(private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val output = ByteArrayOutputStream()
    private var recorder: AudioRecord? = null
    private var job: Job? = null

    @Volatile
    var isRecording: Boolean = false
        private set

    val available: Boolean
        get() = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission") // `available` checks RECORD_AUDIO before every start.
    fun start(): Boolean {
        if (isRecording) return true
        if (!available) return false
        val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (minimum <= 0) return false
        val bufferSize = maxOf(minimum, SAMPLE_RATE / 10 * 2)
        val created = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                            .build(),
                    )
                    .setBufferSizeInBytes(bufferSize * 2)
                    .build()
            } else {
                AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize * 2,
                )
            }
        }.getOrNull() ?: return false
        if (created.state != AudioRecord.STATE_INITIALIZED) {
            runCatching { created.release() }
            return false
        }
        output.reset()
        val started = runCatching { created.startRecording() }.isSuccess
        if (!started) {
            runCatching { created.release() }
            return false
        }
        recorder = created
        isRecording = true
        job = scope.launch {
            val buffer = ByteArray(bufferSize)
            while (isActive && isRecording) {
                val read = runCatching { created.read(buffer, 0, buffer.size) }.getOrDefault(-1)
                if (read > 0) {
                    synchronized(output) {
                        if (output.size() + read <= MAX_PCM_BYTES) output.write(buffer, 0, read)
                    }
                    if (output.size() >= MAX_PCM_BYTES) break
                } else if (read < 0) break
            }
        }
        return true
    }

    /** Stop and return a WAV file, or null when nothing useful was captured. */
    fun stop(): ByteArray? {
        if (!isRecording && recorder == null) return null
        isRecording = false
        val current = recorder
        recorder = null
        runCatching { current?.stop() }
        runCatching { current?.release() }
        job?.cancel()
        job = null
        val pcm = synchronized(output) { output.toByteArray() }
        output.reset()
        if (pcm.size < 1_600) return null
        return wav(pcm)
    }

    fun cancel() {
        isRecording = false
        val current = recorder
        recorder = null
        runCatching { current?.stop() }
        runCatching { current?.release() }
        job?.cancel()
        job = null
        synchronized(output) { output.reset() }
    }

    fun release() = cancel()

    private fun wav(pcm: ByteArray): ByteArray {
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        val dataSize = pcm.size
        val byteRate = SAMPLE_RATE * 2
        header.put("RIFF".toByteArray(Charsets.US_ASCII))
        header.putInt(36 + dataSize)
        header.put("WAVE".toByteArray(Charsets.US_ASCII))
        header.put("fmt ".toByteArray(Charsets.US_ASCII))
        header.putInt(16)
        header.putShort(1.toShort())
        header.putShort(1.toShort())
        header.putInt(SAMPLE_RATE)
        header.putInt(byteRate)
        header.putShort(2.toShort())
        header.putShort(16.toShort())
        header.put("data".toByteArray(Charsets.US_ASCII))
        header.putInt(dataSize)
        val bytes = ByteArrayOutputStream(44 + dataSize)
        bytes.write(header.array())
        bytes.write(pcm)
        return bytes.toByteArray()
    }

    companion object {
        const val SAMPLE_RATE = 16_000
        private const val MAX_SECONDS = 30
        private const val MAX_PCM_BYTES = SAMPLE_RATE * 2 * MAX_SECONDS
    }
}
