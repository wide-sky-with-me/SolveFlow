package com.solveflow.app

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.UIManagerHelper

/** Only acknowledges a mounted document's compositor; no file or network access. */
class SolveDocumentModule(private val react: ReactApplicationContext) : ReactContextBaseJavaModule(react) {
  private val handler = Handler(Looper.getMainLooper())
  private data class Pending(val promise: Promise, val timeout: Runnable)
  private val pending = mutableMapOf<Int, Pending>()
  private data class Raster(val view: WebView, val pixels: Long, val previous: Boolean, val release: Runnable)
  private val rasters = mutableMapOf<Int, Raster>()
  private var rasterPixels = 0L
  private fun releaseRaster(id: Int) {
    val item = rasters.remove(id) ?: return
    handler.removeCallbacks(item.release)
    rasterPixels -= item.pixels
    item.view.settings.offscreenPreRaster = item.previous
  }
  override fun getName() = "SolveDocument"
  private fun finish(id: Int, error: String? = null) {
    val item = pending.remove(id) ?: return
    handler.removeCallbacks(item.timeout)
    if (error == null) {
      // Retain tiles through the 240ms slide, then release the pre-raster request.
      rasters[id]?.let { handler.postDelayed(it.release, 1200) }
      item.promise.resolve(null)
    } else {
      releaseRaster(id)
      item.promise.reject(error, "Document rendering unavailable")
    }
  }
  private fun webView(view: View?, depth: Int = 0): WebView? {
    if (view is WebView) return view
    if (view !is ViewGroup || depth >= 4) return null
    for (index in 0 until minOf(view.childCount, 8)) {
      webView(view.getChildAt(index), depth + 1)?.let { return it }
    }
    return null
  }
  @ReactMethod fun waitForPaint(tag: Int, id: Int, promise: Promise) {
    handler.post {
      if (tag <= 0 || id <= 0 || pending.containsKey(id) || pending.size >= 8) {
        promise.reject("DOCUMENT_PAINT_BUSY", "Document rendering unavailable")
        return@post
      }
      val timeout = Runnable { finish(id, "DOCUMENT_PAINT_TIMEOUT") }
      pending[id] = Pending(promise, timeout)
      handler.postDelayed(timeout, 5000)
      try {
        val view = webView(UIManagerHelper.getUIManagerForReactTag(react, tag)?.resolveView(tag))
        check(view != null && view.isAttachedToWindow)
        // Only requested pages reach here. Bound offscreen work for long answers;
        // never ask Chromium to raster an arbitrarily tall document in advance.
        val pixels = view.width.toLong() * view.height.toLong()
        if (pixels in 1..12_000_000L && rasterPixels + pixels <= 24_000_000L) {
          val release = Runnable { releaseRaster(id) }
          rasters[id] = Raster(view, pixels, view.settings.offscreenPreRaster, release)
          rasterPixels += pixels
          view.settings.offscreenPreRaster = true
        }
        view.postVisualStateCallback(id.toLong(), object : WebView.VisualStateCallback() {
          override fun onComplete(requestId: Long) { finish(id) }
        })
      } catch (_: Exception) { finish(id, "DOCUMENT_VIEW_UNAVAILABLE") }
    }
  }
  @ReactMethod fun cancel(id: Int) { handler.post { finish(id, "DOCUMENT_PAINT_CANCELLED"); releaseRaster(id) } }
  override fun invalidate() {
    handler.post {
      pending.keys.toList().forEach { finish(it, "DOCUMENT_PAINT_CANCELLED") }
      rasters.keys.toList().forEach { releaseRaster(it) }
    }
    super.invalidate()
  }
}
