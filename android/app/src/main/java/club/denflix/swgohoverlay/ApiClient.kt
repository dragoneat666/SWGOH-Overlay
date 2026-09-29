package club.denflix.swgohoverlay

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Thin client for the backend in backend/. All calls are synchronous -
 * callers are expected to run this off the main thread (a background
 * thread/coroutine), which isn't wired up yet in this first pass. See
 * OverlayService.kt TODOs for where this gets called from.
 */
class ApiClient(private val prefs: Prefs) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json".toMediaType()

    private fun authedRequest(path: String): Request.Builder {
        return Request.Builder()
            .url("${prefs.apiBaseUrl}$path")
            .addHeader("Authorization", "Bearer ${prefs.apiToken}")
    }

    /** GET /api/roster/:allyCode - your own roster + gear/relic/ultimate state */
    fun fetchRoster(allyCode: String): JSONObject {
        val req = authedRequest("/api/roster/$allyCode").get().build()
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string() ?: "{}"
            if (!resp.isSuccessful) throw RuntimeException("roster fetch failed: ${resp.code} $body")
            return JSONObject(body)
        }
    }

    /** GET /api/counters/lookup?defender_unit_ids=... */
    fun lookupCounters(defenderUnitIds: List<Int>): JSONObject {
        val ids = defenderUnitIds.joinToString(",")
        val req = authedRequest("/api/counters/lookup?defender_unit_ids=$ids").get().build()
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string() ?: "{}"
            if (!resp.isSuccessful) throw RuntimeException("counters lookup failed: ${resp.code} $body")
            return JSONObject(body)
        }
    }

    /** GET /api/units - full units library, for name/id lookups client-side */
    fun fetchUnits(): JSONObject {
        val req = authedRequest("/api/units").get().build()
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string() ?: "[]"
            if (!resp.isSuccessful) throw RuntimeException("units fetch failed: ${resp.code} $body")
            // API returns a bare array; wrap it so callers have one shape to deal with.
            return JSONObject().put("units", org.json.JSONArray(body))
        }
    }
}
