package cloud.jarvis.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

internal fun JsonObject.notificationString(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

class JarvisNotificationDispatcher(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    init {
        manager.createNotificationChannel(NotificationChannel(CHANNEL_TASKS, "Jarvis 任务", NotificationManager.IMPORTANCE_DEFAULT))
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ACTIONS, "等待处理", NotificationManager.IMPORTANCE_HIGH))
    }

    fun show(value: JsonObject) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val id = value.notificationString("id")
        if (id.isBlank()) return
        val kind = value.notificationString("kind")
        val reference = value.notificationString("reference_id")
        val target = when (kind) {
            "task_completed", "task_failed", "task_question" -> "jarvis://task/$reference"
            "question" -> "jarvis://conversation/$reference"
            "approval" -> if (reference.isBlank()) "jarvis://notification/$id" else "jarvis://notification/$id"
            else -> "jarvis://notification/$id"
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(target), context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, id.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(context, if (kind in listOf("approval", "question", "task_question")) CHANNEL_ACTIONS else CHANNEL_TASKS)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(value.notificationString("title").ifBlank { "Jarvis" })
            .setContentText(value.notificationString("body"))
            .setStyle(Notification.BigTextStyle().bigText(value.notificationString("body")))
            .setContentIntent(pending).setAutoCancel(true).build()
        manager.notify(id.hashCode(), notification)
    }

    companion object {
        const val CHANNEL_TASKS = "jarvis_tasks"
        const val CHANNEL_ACTIONS = "jarvis_actions"
    }
}
