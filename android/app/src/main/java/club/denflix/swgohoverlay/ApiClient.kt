package club.denflix.swgohoverlay

import okhttp3.OkHttpClient
import okhttp3.Request
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

    private fun get(path: String): String {
        val base = prefs.apiBaseUrl
        if (base.isBlank()) throw ApiException("Set the backend URL in Settings first.")
        val request = try {
            Request.Builder()
                .url("$base$path")
                .addHeader("Authorization", "Bearer ${prefs.apiToken}")
                .get()
                .build()
        } catch (e: IllegalArgumentException) {
            throw ApiException("Backend URL isn't valid - it should look like http://100.x.x.x:4001")
        }
        try {
            client.newCall(request).execute().use { resp ->
                val body = resp.body?.string() ?: ""
                if (resp.code == 401) throw ApiException("The server rejected the API token.")
                if (!resp.isSuccessful) {
                    val msg = runCatching { JSONObject(body).optString("error") }.getOrNull()
                    throw ApiException("Server error ${resp.code}${if (msg.isNullOrBlank()) "" else ": $msg"}")
                }
                return body
            }
        } catch (e: IOException) {
            throw ApiException("Can't reach the server at $base (${e.message ?: e.javaClass.simpleName})")
        }
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

    /** GET /api/counters/defender-squads - every defense team with counters on file. */
    fun fetchDefenderSquads(): List<Squad> =
        ApiJson.parseDefenderSquads(JSONObject(get("/api/counters/defender-squads")))

    /** GET /api/counters/match - known defense teams closest to the units
     * seen on the enemy team (leader first), each with its counters. */
    fun match(unitIds: List<Int>, limit: Int = 4): List<TeamMatch> =
        ApiJson.parseMatches(JSONObject(get("/api/counters/match?unit_ids=${unitIds.joinToString(",")}&limit=$limit")))

    /** GET /api/roster/:allyCode - game ids of every unit you own. */
    fun fetchOwnedDefinitionIds(allyCode: String): Set<String> =
        ApiJson.parseOwnedDefinitionIds(JSONObject(get("/api/roster/$allyCode")))
}
