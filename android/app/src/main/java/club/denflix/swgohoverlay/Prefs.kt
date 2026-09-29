package club.denflix.swgohoverlay

import android.content.Context
import android.content.SharedPreferences

/**
 * Everything the app needs to remember locally: connection settings, bubble
 * position, and the per-round "used squads" list. Deliberately all local -
 * see docs/ARCHITECTURE.md ("Used-squad tracking") for why that list isn't
 * server-side.
 */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("swgoh_overlay_prefs", Context.MODE_PRIVATE)

    var allyCode: String
        get() = sp.getString("ally_code", "") ?: ""
        set(value) = sp.edit().putString("ally_code", value).apply()

    var apiBaseUrl: String
        get() = sp.getString("api_base_url", "") ?: ""
        set(value) = sp.edit().putString("api_base_url", value.trimEnd('/')).apply()

    var apiToken: String
        get() = sp.getString("api_token", "") ?: ""
        set(value) = sp.edit().putString("api_token", value).apply()

    var bubbleX: Int
        get() = sp.getInt("bubble_x", 0)
        set(value) = sp.edit().putInt("bubble_x", value).apply()

    var bubbleY: Int
        get() = sp.getInt("bubble_y", 100)
        set(value) = sp.edit().putInt("bubble_y", value).apply()

    // Used-squad tracking for the current GAC round. Stored as a
    // comma-joined string of unit-id-lists (simplest thing that works for a
    // v0.1 - revisit if this needs to be queryable/structured later).
    var usedSquadsRaw: String
        get() = sp.getString("used_squads", "") ?: ""
        set(value) = sp.edit().putString("used_squads", value).apply()

    var lastOpenedAtMillis: Long
        get() = sp.getLong("last_opened_at", 0L)
        set(value) = sp.edit().putLong("last_opened_at", value).apply()

    fun clearUsedSquads() {
        usedSquadsRaw = ""
    }

    fun isConfigured(): Boolean =
        allyCode.isNotBlank() && apiBaseUrl.isNotBlank() && apiToken.isNotBlank()
}
