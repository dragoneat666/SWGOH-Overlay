package club.denflix.swgohoverlay

import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper

/**
 * Grabs single frames of the screen for "Scan screen". Wraps one
 * MediaProjection (the user's screen-capture consent, valid until the
 * overlay stops or Android revokes it) and a mirror of the display that
 * keeps only the newest frame around.
 */
class ScreenCapturer(
    projection: MediaProjection,
    private val onStopped: () -> Unit,
) {
    private val thread = HandlerThread("swgoh-screen-capture").apply { start() }
    private val handler = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())
    private var projection: MediaProjection? = projection

    private var reader: ImageReader? = null
    private var display: VirtualDisplay? = null
    private var width = 0
    private var height = 0
    @Volatile private var latest: Image? = null

    init {
        // Required before creating the virtual display (Android 14+), and how
        // we hear that the user or the system ended the capture.
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                handler.post { releaseOnThread() }
                main.post(onStopped)
            }
        }, handler)
    }

    /** Make sure the mirror matches the current screen size (rotation). */
    private fun ensureDisplay(w: Int, h: Int, dpi: Int) {
        val proj = projection ?: return
        if (display != null && w == width && h == height) return
        val newReader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3)
        newReader.setOnImageAvailableListener({ r ->
            val img = runCatching { r.acquireLatestImage() }.getOrNull() ?: return@setOnImageAvailableListener
            latest?.close()
            latest = img
        }, handler)
        val old = reader
        latest?.close()
        latest = null
        if (display == null) {
            display = proj.createVirtualDisplay(
                "swgoh-overlay-scan", w, h, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                newReader.surface, null, handler
            )
        } else {
            // Android only allows one virtual display per consent - resize it.
            display?.resize(w, h, dpi)
            display?.surface = newReader.surface
        }
        old?.close()
        reader = newReader
        width = w
        height = h
    }

    /**
     * Captures the screen as it looks [delayMs] from now (time for the
     * overlay to hide itself and the next frame to be drawn). [onResult] runs
     * on the main thread with the frame, or null if none arrived.
     */
    fun capture(w: Int, h: Int, dpi: Int, delayMs: Long = 350, onResult: (Bitmap?) -> Unit) {
        handler.post {
            try {
                ensureDisplay(w, h, dpi)
            } catch (e: Exception) {
                main.post { onResult(null) }
                return@post
            }
            handler.postDelayed({
                val frame = latest?.let { toBitmap(it) }
                main.post { onResult(frame) }
            }, delayMs)
        }
    }

    private fun toBitmap(image: Image): Bitmap? = runCatching {
        val plane = image.planes[0]
        val buffer = plane.buffer.duplicate().also { it.rewind() }
        val rowPixels = plane.rowStride / plane.pixelStride
        val padded = Bitmap.createBitmap(rowPixels, image.height, Bitmap.Config.ARGB_8888)
        padded.copyPixelsFromBuffer(buffer)
        if (rowPixels == image.width) padded
        else Bitmap.createBitmap(padded, 0, 0, image.width, image.height).also { padded.recycle() }
    }.getOrNull()

    private fun releaseOnThread() {
        latest?.close()
        latest = null
        display?.release()
        display = null
        reader?.close()
        reader = null
    }

    fun release() {
        val proj = projection
        projection = null
        handler.post {
            releaseOnThread()
            runCatching { proj?.stop() }
            thread.quitSafely()
        }
    }
}
