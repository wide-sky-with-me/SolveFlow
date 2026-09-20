package com.solveflow.app

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import java.lang.ref.WeakReference

class SolveBackgroundModule(private val react: ReactApplicationContext) : ReactContextBaseJavaModule(react) {
  companion object {
    private var context = WeakReference<ReactApplicationContext>(null)
    private var pending: Promise? = null
    private var pendingId: String? = null
    private val timerHandler = Handler(Looper.getMainLooper())
    private var timerId = -1
    fun clearTimer() { timerHandler.removeCallbacksAndMessages(null); timerId = -1 }
    fun started(id: String) {
      if (pendingId != id) return
      try {
        val react = context.get() ?: error("REACT_CONTEXT_MISSING")
        check(react.hasActiveReactInstance())
        // Same live React context as the existing Pi job; no new solver, retry or process restart.
        HeadlessJsTaskContext.getInstance(react).startTask(HeadlessJsTaskConfig(
          "SolveFlowActive", Arguments.createMap().apply { putString("runId", id) }, 125_000L, true
        ))
        pending?.resolve(null); pending = null; pendingId = null
      } catch (_: Exception) { failed(id) }
    }
    fun failed(id: String) { if (pendingId == id) { pending?.reject("BACKGROUND_START_FAILED", "无法启动后台解题服务，请保持应用在前台后重试。"); pending = null; pendingId = null } }
    fun expired(id: String) {
      val value = Arguments.createMap().apply { putString("runId", id) }
      context.get()?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit("solveBackgroundExpired", value)
    }
  }
  init { context = WeakReference(react) }
  override fun getName() = "SolveBackground"
  @ReactMethod fun start(id: String, promise: Promise) {
    if (!Regex("^[a-f0-9-]{36}$").matches(id)) { promise.reject("INVALID_RUN", "任务标识无效"); return }
    Handler(Looper.getMainLooper()).post {
      if (pending != null || SolveBackgroundService.activeId != null && SolveBackgroundService.activeId != id) { promise.reject("BUSY", "已有解题任务"); return@post }
      pending = promise; pendingId = id
      try {
        ContextCompat.startForegroundService(react, Intent(react, SolveBackgroundService::class.java).putExtra("runId", id))
        Handler(Looper.getMainLooper()).postDelayed({ failed(id) }, 5000)
      } catch (_: Exception) { failed(id) }
    }
  }
  @ReactMethod fun stop(id: String, promise: Promise) {
    Handler(Looper.getMainLooper()).post {
      if (SolveBackgroundService.activeId == id) react.stopService(Intent(react, SolveBackgroundService::class.java))
      promise.resolve(null)
    }
  }
  @ReactMethod fun armTimer(id: Int, ms: Double) {
    timerHandler.post {
      clearTimer(); timerId = id
      timerHandler.postDelayed({
        if (timerId == id) {
          val value = Arguments.createMap().apply { putInt("timerId", id) }
          context.get()?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit("solvePhaseTimeout", value)
        }
      }, ms.toLong().coerceIn(1, 120000))
    }
  }
  @ReactMethod fun cancelTimer(id: Int) { timerHandler.post { if (timerId == id) clearTimer() } }
  @ReactMethod fun diagnostic(value: String) { if (value.length <= 8192) Log.i("SolveFlowDiagnostic", value) }
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
class SolveBackgroundPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(SolveBackgroundModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
