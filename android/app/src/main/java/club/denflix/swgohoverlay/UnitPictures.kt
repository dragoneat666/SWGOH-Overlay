package club.denflix.swgohoverlay

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit

/**
 * Unit pictures (the faces in your web app's library, served from the
 * backend's /uploads/). Each is downloaded once, then kept on disk in the
 * app's cache and in memory, so the overlay can show faces instead of names.
 */
class UnitPictures(context: Context, private val prefs: Prefs, private val executor: ExecutorService) {

    private val dir = File(context.cacheDir, "unit-pictures").apply { mkdirs() }
    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val memory = object : LruCache<String, Bitmap>(8 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    /** Pictures that couldn't be loaded this session (don't keep retrying). */
    private val missing = mutableSetOf<String>()
    /** Callbacks waiting on a download that's already running. */
    private val waiting = mutableMapOf<String, MutableList<(Bitmap?) -> Unit>>()

    /** The picture if it's already in memory. */
    fun cached(path: String): Bitmap? = memory.get(path)

    /** Calls [onLoaded] on the main thread with the picture, or null if there isn't one. */
    fun load(path: String, onLoaded: (Bitmap?) -> Unit) {
        memory.get(path)?.let { return onLoaded(it) }
        if (path in missing) return onLoaded(null)
        waiting[path]?.let { it += onLoaded; return }
        waiting[path] = mutableListOf(onLoaded)
        executor.execute {
            val bitmap = runCatching { fromDisk(path) ?: download(path) }.getOrNull()
            main.post {
                if (bitmap != null) memory.put(path, bitmap) else missing += path
                waiting.remove(path)?.forEach { it(bitmap) }
            }
        }
    }

    private fun file(path: String) = File(dir, path.substringAfterLast('/'))

    private fun fromDisk(path: String): Bitmap? {
        val f = file(path)
        return if (f.exists()) BitmapFactory.decodeFile(f.path) else null
    }

    private fun download(path: String): Bitmap? {
        val base = prefs.apiBaseUrl
        if (base.isBlank()) return null
        val request = Request.Builder()
            .url("$base/uploads/${path.substringAfterLast('/')}")
            .addHeader("Authorization", "Bearer ${prefs.apiToken}")
            .build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) return null
            val bytes = resp.body?.bytes() ?: return null
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
            runCatching { file(path).writeBytes(bytes) }
            return bitmap
        }
    }
}
