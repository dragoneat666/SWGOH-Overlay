package club.denflix.swgohoverlay

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Thin client for the backend in backend/. All calls are synchronous -
 * callers must run them off the main thread (OverlayService.runAsync,
 * SettingsActivity's background thread).
 */
class ApiClient(private val prefs: Prefs) {

    /** Error with a message that's fine to show the user as-is. */
    class ApiException(message: String) : Exception(message)

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        // Roster pulls go out to the game's servers via Comlink - give them time.
        .readTimeout(45, TimeUnit.SECONDS)
        .build()

    private fun get(path: String): String = send(path, null)

    private fun send(path: String, body: RequestBody?): String {
        val base = prefs.apiBaseUrl
        if (base.isBlank()) throw ApiException("Set the backend URL in Settings first.")
        val request = try {
            Request.Builder()
                .url("$base$path")
                .addHeader("Authorization", "Bearer ${prefs.apiToken}")
                .apply { if (body == null) get() else post(body) }
                .build()
        } catch (e: IllegalArgumentException) {
            throw ApiException("Backend URL isn't valid - it should look like http://100.x.x.x:4001")
        }
        try {
            client.newCall(request).execute().use { resp ->
                val text = resp.body?.string() ?: ""
                if (resp.code == 401) throw ApiException("The server rejected the API token.")
                if (!resp.isSuccessful) {
                    val msg = runCatching { JSONObject(text).optString("error") }.getOrNull()
                    throw ApiException("Server error ${resp.code}${if (msg.isNullOrBlank()) "" else ": $msg"}")
                }
                return text
            }
        } catch (e: IOException) {
            throw ApiException("Can't reach the server at $base (${e.message ?: e.javaClass.simpleName})")
        }
    }

    /** POST /api/scan/gac - the server reads the enemy squads off a screenshot. */
    fun scanGac(jpeg: ByteArray): ScanResult =
        ApiJson.parseScan(JSONObject(send("/api/scan/gac", jpeg.toRequestBody("image/jpeg".toMediaType()))))

    /** POST /api/portraits - "this face is that unit" (taught from a scan). */
    fun addFace(unitId: Int, imageDataUrl: String, fingerprintJson: String) {
        val body = JSONObject()
            .put("unit_id", unitId)
            .put("image", imageDataUrl)
            .put("fingerprint", JSONArray(fingerprintJson))
            .put("source", "gac screen")
        send("/api/portraits", body.toString().toRequestBody("application/json".toMediaType()))
    }

    /** GET /api/auth/check - true if the URL + token work. */
    fun checkAuth() {
        get("/api/auth/check")
    }

    /** GET /api/units - the whole units library (also cached in Prefs). */
    fun fetchUnits(): Pair<List<GameUnit>, String> {
        val body = get("/api/units")
        return ApiJson.parseUnits(JSONArray(body)) to body
    }

    /** GET /api/counters/match - known defense teams closest to the units
     * seen on the enemy team (leader first), each with its counters. */
    fun match(unitIds: List<Int>, limit: Int = 4): List<TeamMatch> =
        ApiJson.parseMatches(JSONObject(get("/api/counters/match?unit_ids=${unitIds.joinToString(",")}&limit=$limit")))

    /** GET /api/roster/:allyCode - game ids of every unit you own (the server
     * pulls them from the game, or gives its last copy if the game is down). */
    fun fetchRoster(allyCode: String): Roster =
        ApiJson.parseRoster(JSONObject(get("/api/roster/$allyCode")))
}
