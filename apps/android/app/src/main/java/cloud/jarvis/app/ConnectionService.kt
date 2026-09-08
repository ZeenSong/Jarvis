package cloud.jarvis.app

import android.app.*
import android.content.Intent
import android.os.IBinder

/** User-visible foreground service; Android still controls Doze and force-stop. */
class ConnectionService : Service() {
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("connection", "后台连接", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(this, "connection")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim).setContentTitle("Jarvis 后台连接")
            .setContentText("正在维护私人云连接；可在 Home 页面关闭")
            .setContentIntent(open).setOngoing(true).build()
        startForeground(1, notification)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
}
