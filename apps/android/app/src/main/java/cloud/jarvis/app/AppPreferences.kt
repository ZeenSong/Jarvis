package cloud.jarvis.app

import android.content.Context
import cloud.jarvis.app.designsystem.JarvisStyle

/**
 * Small, synchronous preferences that must be available before the first frame:
 * appearance, developer surfaces and voice-call defaults. Credentials live in
 * the encrypted DataStore instead.
 */
class AppPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("jarvis-appearance", Context.MODE_PRIVATE)

    var style: JarvisStyle
        get() = JarvisStyle.fromId(prefs.getString("style", null))
        set(value) { prefs.edit().putString("style", value.id).apply() }

    var light: Boolean
        get() = prefs.getBoolean("light", false)
        set(value) { prefs.edit().putBoolean("light", value).apply() }

    var developer: Boolean
        get() = prefs.getBoolean("developer", false)
        set(value) { prefs.edit().putBoolean("developer", value).apply() }

    var voiceAutoStart: Boolean
        get() = prefs.getBoolean("voice_auto_start", true)
        set(value) { prefs.edit().putBoolean("voice_auto_start", value).apply() }

    var voiceSpeaker: Boolean
        get() = prefs.getBoolean("voice_speaker", true)
        set(value) { prefs.edit().putBoolean("voice_speaker", value).apply() }

    var voiceRate: Float
        get() = prefs.getFloat("voice_rate", 1.0f).coerceIn(0.7f, 1.4f)
        set(value) { prefs.edit().putFloat("voice_rate", value.coerceIn(0.7f, 1.4f)).apply() }

    var lastServer: String
        get() = prefs.getString("last_server", "") ?: ""
        set(value) { prefs.edit().putString("last_server", value).apply() }

    var lastUsername: String
        get() = prefs.getString("last_username", "") ?: ""
        set(value) { prefs.edit().putString("last_username", value).apply() }
}
