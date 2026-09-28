package com.solveflow.app

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import androidx.core.app.NotificationCompat

/** One service, bounded existing jobs with separate deadlines; no replay or model dispatch. */
class SolveBackgroundService : Service() {
  companion object { var instance: SolveBackgroundService? = null; private const val CHANNEL = "solve_active"; private const val NOTICE = 241 }
  private val jobs = mutableMapOf<String, Runnable>()
  private var wake: PowerManager.WakeLock? = null
  private val handler = Handler(Looper.getMainLooper())
  private val idle = Runnable { if (jobs.isEmpty()) stopSelf() }
  override fun onCreate() { super.onCreate(); instance = this }
  override fun onBind(intent: Intent?) = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra("runId") ?: return START_NOT_STICKY.also { if (jobs.isEmpty()) stopSelf() }
    if (jobs.containsKey(id)) { SolveBackgroundModule.started(id); return START_NOT_STICKY }
    if (jobs.size >= 4) { SolveBackgroundModule.failed(id); return START_NOT_STICKY }
    try {
      handler.removeCallbacks(idle)
      val expire = Runnable { SolveBackgroundModule.expired(id); finish(id) }
      jobs[id] = expire; handler.postDelayed(expire, 120_000)
      notifyProgress()
      if (wake == null) wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SolveFlow:activeSolve").apply { setReferenceCounted(false) }
      wake?.acquire(125_000)
      SolveBackgroundModule.started(id)
    } catch (_: Exception) { SolveBackgroundModule.failed(id); finish(id) }
    return START_NOT_STICKY
  }
  private fun notifyProgress() {
    if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "解题进度", NotificationManager.IMPORTANCE_LOW))
    val launch = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val pending = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_edit)
      .setContentTitle("正在处理 ${jobs.size} 个解题任务").setContentText("息屏后继续解题与核验，完成后自动保存")
      .setContentIntent(pending).setOngoing(true).setSilent(true).setOnlyAlertOnce(true)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setCategory(NotificationCompat.CATEGORY_PROGRESS).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTICE, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(NOTICE, notification)
  }
  fun finish(id: String) {
    jobs.remove(id)?.let { handler.removeCallbacks(it) }
    if (jobs.isEmpty()) { handler.removeCallbacks(idle); handler.postDelayed(idle, 5000) }
    else notifyProgress()
  }
  override fun onTimeout(startId: Int, fgsType: Int) { jobs.keys.toList().forEach { SolveBackgroundModule.expired(it) }; stopSelf() }
  override fun onDestroy() {
    jobs.keys.toList().forEach { SolveBackgroundModule.expired(it) }; jobs.clear()
    handler.removeCallbacksAndMessages(null); SolveBackgroundModule.clearTimer()
    wake?.let { if (it.isHeld) it.release() }; wake = null; instance = null
    stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy()
  }
}
