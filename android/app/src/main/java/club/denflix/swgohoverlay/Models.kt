package club.denflix.swgohoverlay

import org.json.JSONArray
import org.json.JSONObject

// Shapes of the backend's JSON (see backend/src/routes/*.js), parsed once in
// ApiJson so the rest of the app works with plain data classes.

/** A unit from the backend library. definitionId is the game's own id
 * (e.g. "GRANDMASTERYODA") - what roster ownership is keyed by. */
data class GameUnit(
    val id: Int,
    val definitionId: String?,
    val name: String,
    val isShip: Boolean,
)

/** Ordered squad - index 0 is the leader. */
data class Squad(val id: Int, val units: List<GameUnit>) {
    val leader: GameUnit? get() = units.firstOrNull()
    val unitIds: List<Int> get() = units.map { it.id }
    val label: String get() = units.joinToString(", ") { it.name }
}

/** One recommended counter squad, rank 1 = best (the server ranks them
 * from their battle stats - backend/src/ranking.js). */
data class CounterSquad(
    val rank: Int,
    val notes: String?,
    val squad: Squad,
    val winRate: Double? = null,
    val seenCount: Int? = null,
    val avgBanners: Double? = null,
) {
    /** "100% win · 64.8 ⚑", or null when there are no stats. ("Seen" is a
     * per-season number that goes stale, so it's not shown - it still
     * weighs the server's ranking.) */
    val statsLabel: String?
        get() {
            val parts = mutableListOf<String>()
            winRate?.let { parts += "${trimNumber(it)}% win" }
            avgBanners?.let { parts += "${trimNumber(it)} ⚑" }
            return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
        }

    private fun trimNumber(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()
}

/** A counter entry for one defense team (normally exactly one per team). */
data class CounterEntry(val counterId: Int, val notes: String?, val squads: List<CounterSquad>)

/** One result from /api/counters/match. */
data class TeamMatch(
    val score: Double,
    val exact: Boolean,
    val leaderMatch: Boolean,
    val overlap: Int,
    val defender: Squad,
    val counters: List<CounterEntry>,
)

/** A suggestion for an unrecognized face (from POST /api/scan/gac). */
data class ScanCandidate(val unitId: Int, val name: String?, val score: Double)

/** One portrait read off the screen. unitId is null until it's identified. */
data class ScanSlot(
    val unitId: Int?,
    val score: Double?,
    val candidates: List<ScanCandidate>,
    /** "data:image/png;base64,..." crop of the face. */
    val image: String,
    /** The face's fingerprint as JSON, sent back when identifying it. */
    val fingerprintJson: String,
)

data class ScanSquad(val slots: List<ScanSlot>)

/** Result of scanning the GAC territory screen: the squads still standing. */
data class ScanResult(val beaten: Int, val squads: List<ScanSquad>)

object ApiJson {

    private fun JSONObject.optStringOrNull(key: String): String? =
        if (!has(key) || isNull(key)) null else getString(key).takeIf { it.isNotBlank() }

    private fun JSONObject.optDoubleOrNull(key: String): Double? =
        if (!has(key) || isNull(key)) null else getDouble(key)

    fun parseUnit(o: JSONObject) = GameUnit(
        id = o.getInt("id"),
        definitionId = o.optStringOrNull("definition_id"),
        name = o.optString("name", "Unknown unit"),
        isShip = o.optBoolean("is_ship", false),
    )

    fun parseUnits(arr: JSONArray): List<GameUnit> =
        (0 until arr.length()).map { parseUnit(arr.getJSONObject(it)) }

    fun parseSquad(o: JSONObject): Squad {
        val units = o.optJSONArray("units") ?: JSONArray()
        return Squad(o.getInt("id"), parseUnits(units))
    }

    fun parseCounterEntry(o: JSONObject): CounterEntry {
        val recs = o.optJSONArray("recommended_squads") ?: JSONArray()
        val squads = (0 until recs.length()).map { i ->
            val r = recs.getJSONObject(i)
            CounterSquad(
                rank = r.optInt("rank", i + 1),
                notes = r.optStringOrNull("notes"),
                squad = parseSquad(r),
                winRate = r.optDoubleOrNull("win_rate"),
                seenCount = if (r.has("seen_count") && !r.isNull("seen_count")) r.getInt("seen_count") else null,
                avgBanners = r.optDoubleOrNull("avg_banners"),
            )
        }
        return CounterEntry(o.getInt("counter_id"), o.optStringOrNull("notes"), squads)
    }

    fun parseMatches(o: JSONObject): List<TeamMatch> {
        val arr = o.optJSONArray("matches") ?: return emptyList()
        return (0 until arr.length()).map { i ->
            val m = arr.getJSONObject(i)
            val counters = m.optJSONArray("counters") ?: JSONArray()
            TeamMatch(
                score = m.optDouble("score", 0.0),
                exact = m.optBoolean("exact", false),
                leaderMatch = m.optBoolean("leader_match", false),
                overlap = m.optInt("overlap", 0),
                defender = parseSquad(m.getJSONObject("defender")),
                counters = (0 until counters.length()).map { parseCounterEntry(counters.getJSONObject(it)) },
            )
        }
    }

    fun parseDefenderSquads(o: JSONObject): List<Squad> {
        val arr = o.optJSONArray("squads") ?: return emptyList()
        return (0 until arr.length()).map { parseSquad(arr.getJSONObject(it)) }
    }

    fun parseScan(o: JSONObject): ScanResult {
        val squads = o.optJSONArray("squads") ?: JSONArray()
        return ScanResult(
            beaten = o.optInt("beaten", 0),
            squads = (0 until squads.length()).map { i ->
                val slots = squads.getJSONObject(i).optJSONArray("slots") ?: JSONArray()
                ScanSquad((0 until slots.length()).map { k ->
                    val s = slots.getJSONObject(k)
                    val cands = s.optJSONArray("candidates") ?: JSONArray()
                    ScanSlot(
                        unitId = if (s.isNull("unit_id")) null else s.getInt("unit_id"),
                        score = if (s.isNull("score")) null else s.getDouble("score"),
                        candidates = (0 until cands.length()).map { c ->
                            val cand = cands.getJSONObject(c)
                            ScanCandidate(cand.getInt("unit_id"), cand.optStringOrNull("name"), cand.optDouble("score", 0.0))
                        },
                        image = s.optString("image", ""),
                        fingerprintJson = (s.optJSONArray("fingerprint") ?: JSONArray()).toString(),
                    )
                })
            },
        )
    }

    /** Owned game ids from /api/roster/:allyCode. */
    fun parseOwnedDefinitionIds(o: JSONObject): Set<String> {
        val arr = o.optJSONArray("units") ?: return emptySet()
        return (0 until arr.length())
            .mapNotNull { arr.optJSONObject(it)?.optString("unit_definition_id")?.takeIf { s -> s.isNotBlank() } }
            .toSet()
    }
}
