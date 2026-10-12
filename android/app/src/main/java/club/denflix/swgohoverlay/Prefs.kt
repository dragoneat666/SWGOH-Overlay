package club.denflix.swgohoverlay

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** A counter squad you've already attacked with this GAC round. Every unit
 * in it is used up for the round - see CounterRanking. */
data class UsedSquad(val label: String, val unitIds: List<Int>)

/**
 * Everything the app needs to remember locally: connection settings, bubble
 * position, the per-round "used squads" list, and caches of the units
 * library and your roster so the overlay works instantly on the next start.
 * Deliberately all local - see docs/ARCHITECTURE.md ("Used-squad tracking")
 * for why that list isn't server-side.
 */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("swgoh_overlay_prefs", Context.MODE_PRIVATE)

    var allyCode: String
        get() = sp.getString("ally_code", "") ?: ""
        set(value) = sp.edit().putString("ally_code", value.filter { it.isDigit() }).apply()

    var apiBaseUrl: String
        get() = sp.getString("api_base_url", "") ?: ""
        set(value) = sp.edit().putString("api_base_url", value.trim().trimEnd('/')).apply()

    var apiToken: String
        get() = sp.getString("api_token", "") ?: ""
        set(value) = sp.edit().putString("api_token", value.trim()).apply()

    var bubbleX: Int
        get() = sp.getInt("bubble_x", 0)
        set(value) = sp.edit().putInt("bubble_x", value).apply()

    var bubbleY: Int
        get() = sp.getInt("bubble_y", 200)
        set(value) = sp.edit().putInt("bubble_y", value).apply()

    var lastOpenedAtMillis: Long
        get() = sp.getLong("last_opened_at", 0L)
        set(value) = sp.edit().putLong("last_opened_at", value).apply()

    /** Raw JSON of the last /api/units response. */
    var unitsCacheJson: String
        get() = sp.getString("units_cache", "") ?: ""
        set(value) = sp.edit().putString("units_cache", value).apply()

    /** Game ids you own, from the last successful roster pull (null = never pulled). */
    var ownedDefinitionIds: Set<String>?
        get() = if (sp.contains("owned_ids")) sp.getStringSet("owned_ids", emptySet())?.toSet() else null
        set(value) {
            if (value == null) sp.edit().remove("owned_ids").apply()
            else sp.edit().putStringSet("owned_ids", value).apply()
        }

    // Used-squad tracking for the current GAC round, stored as a JSON array
    // of {label, unit_ids} objects - see UsedSquad above.
    private var usedSquadsJson: String
        get() = sp.getString("used_squads_json", "[]") ?: "[]"
        set(value) = sp.edit().putString("used_squads_json", value).apply()

    fun getUsedSquads(): List<UsedSquad> {
        val arr = runCatching { JSONArray(usedSquadsJson) }.getOrElse { JSONArray() }
        val result = mutableListOf<UsedSquad>()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            val idsArr = obj.getJSONArray("unit_ids")
            val ids = (0 until idsArr.length()).map { idsArr.getInt(it) }
            result.add(UsedSquad(obj.getString("label"), ids))
        }
        return result
    }

    private fun saveUsedSquads(squads: List<UsedSquad>) {
        val arr = JSONArray()
        squads.forEach { squad ->
            arr.put(JSONObject().put("label", squad.label).put("unit_ids", JSONArray(squad.unitIds)))
        }
        usedSquadsJson = arr.toString()
    }

    fun addUsedSquad(squad: UsedSquad) {
        saveUsedSquads(getUsedSquads() + squad)
    }

    fun removeUsedSquad(index: Int) {
        saveUsedSquads(getUsedSquads().filterIndexed { i, _ -> i != index })
    }

    fun clearUsedSquads() {
        usedSquadsJson = "[]"
    }

    fun isConfigured(): Boolean =
        allyCode.isNotBlank() && apiBaseUrl.isNotBlank() && apiToken.isNotBlank()
}
