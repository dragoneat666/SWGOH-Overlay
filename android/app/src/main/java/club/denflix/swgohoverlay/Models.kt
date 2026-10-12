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

/** One recommended counter squad, rank 1 = best. */
data class CounterSquad(val rank: Int, val notes: String?, val squad: Squad)

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

object ApiJson {

    private fun JSONObject.optStringOrNull(key: String): String? =
        if (!has(key) || isNull(key)) null else getString(key).takeIf { it.isNotBlank() }

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
            CounterSquad(rank = r.optInt("rank", i + 1), notes = r.optStringOrNull("notes"), squad = parseSquad(r))
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

    /** Owned game ids from /api/roster/:allyCode. */
    fun parseOwnedDefinitionIds(o: JSONObject): Set<String> {
        val arr = o.optJSONArray("units") ?: return emptySet()
        return (0 until arr.length())
            .mapNotNull { arr.optJSONObject(it)?.optString("unit_definition_id")?.takeIf { s -> s.isNotBlank() } }
            .toSet()
    }
}
