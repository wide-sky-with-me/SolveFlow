package com.solveflow.app

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import androidx.core.app.NotificationCompat

/** Keeps the existing Pi/JS job alive; does not start or replay any model request. */
class SolveBackgroundService : Service() {
  companion object { var activeId: String? = null; private const val CHANNEL = "solve_active"; private const val NOTICE = 241 }
  private var wake: PowerManager.WakeLock? = null
  private val handler = Handler(Looper.getMainLooper())
  private val expire = Runnable { activeId?.let { SolveBackgroundModule.expired(it) }; stopSelf() }
  override fun onBind(intent: Intent?) = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra("runId") ?: return START_NOT_STICKY.also { stopSelf() }
    if (activeId == id) { SolveBackgroundModule.started(id); return START_NOT_STICKY }
    if (activeId != null) { SolveBackgroundModule.failed(id); return START_NOT_STICKY }
    try {
      if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "解题进度", NotificationManager.IMPORTANCE_LOW))
      val launch = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val pending = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_edit)
        .setContentTitle("正在解题").setContentText("息屏后继续运行，完成后自动保存")
        .setContentIntent(pending).setOngoing(true).setSilent(true).setOnlyAlertOnce(true)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setCategory(NotificationCompat.CATEGORY_PROGRESS).build()
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTICE, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(NOTICE, notification)
      activeId = id
      wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SolveFlow:activeSolve").apply { setReferenceCounted(false); acquire(125_000) }
      handler.postDelayed(expire, 120_000)
      SolveBackgroundModule.started(id)
    } catch (_: Exception) { SolveBackgroundModule.failed(id); stopSelf() }
    return START_NOT_STICKY
  }
  override fun onTimeout(startId: Int, fgsType: Int) { expire.run() }
  override fun onDestroy() {
    activeId?.let { SolveBackgroundModule.expired(it) }
    handler.removeCallbacksAndMessages(null)
    SolveBackgroundModule.clearTimer()
    wake?.let { if (it.isHeld) it.release() }; wake = null; activeId = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
