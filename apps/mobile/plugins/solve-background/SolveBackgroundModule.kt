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
    private val pending = mutableMapOf<String, Promise>()
    private val timerHandler = Handler(Looper.getMainLooper())
    private val timers = mutableMapOf<Int, Runnable>()
    fun clearTimer() { timerHandler.removeCallbacksAndMessages(null); timers.clear() }
    fun started(id: String) {
      if (!pending.containsKey(id)) return
      try {
        val react = context.get() ?: error("REACT_CONTEXT_MISSING")
        check(react.hasActiveReactInstance())
        // Same live React context as the existing Pi job; no new solver, retry or process restart.
        HeadlessJsTaskContext.getInstance(react).startTask(HeadlessJsTaskConfig(
          "SolveFlowActive", Arguments.createMap().apply { putString("runId", id) }, SolveRunBudget.JOB_DURATION_MS + 5000L, true
        ))
        pending.remove(id)?.resolve(null)
      } catch (_: Exception) { failed(id) }
    }
    fun failed(id: String) { pending.remove(id)?.reject("BACKGROUND_START_FAILED", "无法启动后台解题服务，请保持应用在前台后重试。") }
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
      if (pending.containsKey(id) || pending.size >= SolveRunBudget.MAX_JOBS) { promise.reject("BUSY", "已有解题任务"); return@post }
      pending[id] = promise
      try {
        ContextCompat.startForegroundService(react, Intent(react, SolveBackgroundService::class.java).putExtra("runId", id))
        Handler(Looper.getMainLooper()).postDelayed({ failed(id) }, 5000)
      } catch (_: Exception) { failed(id) }
    }
  }
  @ReactMethod fun stop(id: String, promise: Promise) {
    Handler(Looper.getMainLooper()).post {
      SolveBackgroundService.instance?.finish(id)
      promise.resolve(null)
    }
  }
  @ReactMethod fun armTimer(id: Int, ms: Double) {
    timerHandler.post {
      timers.remove(id)?.let { timerHandler.removeCallbacks(it) }
      if (timers.size >= SolveRunBudget.MAX_JOBS) {
        val value = Arguments.createMap().apply { putInt("timerId", id) }
        context.get()?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit("solvePhaseTimeout", value)
        return@post
      }
      val timer = Runnable {
        timers.remove(id)
        val value = Arguments.createMap().apply { putInt("timerId", id) }
        context.get()?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit("solvePhaseTimeout", value)
      }
      timers[id] = timer; timerHandler.postDelayed(timer, ms.toLong().coerceIn(1L, SolveRunBudget.PHASE_DURATION_MS))
    }
  }
  @ReactMethod fun cancelTimer(id: Int) { timerHandler.post { timers.remove(id)?.let { timerHandler.removeCallbacks(it) } } }
  @ReactMethod fun diagnostic(value: String) { if (value.length <= 8192) Log.i("SolveFlowDiagnostic", value) }
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
class SolveBackgroundPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(SolveBackgroundModule(context), SolveDocumentModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
