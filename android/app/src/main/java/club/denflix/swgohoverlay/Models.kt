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
    /** Relic level read off the portrait's badge (1-10), null if none/unreadable. */
    val relic: Int? = null,
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
                        relic = if (s.isNull("relic")) null else s.optInt("relic").takeIf { it in 1..10 },
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

    /** Gear/relic of every unit in /api/roster/:allyCode, by game id. */
    fun parseUnitLevels(o: JSONObject): Map<String, UnitLevel> {
        val arr = o.optJSONArray("units") ?: return emptyMap()
        val out = mutableMapOf<String, UnitLevel>()
        for (i in 0 until arr.length()) {
            val u = arr.optJSONObject(i) ?: continue
            val id = u.optString("unit_definition_id").takeIf { it.isNotBlank() } ?: continue
            out[id] = UnitLevel(
                gear = if (u.isNull("gear_tier")) null else u.optInt("gear_tier"),
                relic = if (u.isNull("relic_tier")) null else u.optInt("relic_tier"),
            )
        }
        return out
    }

    fun parseRoster(o: JSONObject): Roster = Roster(
        ownedDefinitionIds = parseOwnedDefinitionIds(o),
        levels = parseUnitLevels(o),
        fetchedAtMillis = o.optString("fetched_at").takeIf { it.isNotBlank() }
            ?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() },
        stale = o.optBoolean("stale", false),
    )
}

/** GET /api/roster, reduced to what the app uses. */
data class Roster(
    val ownedDefinitionIds: Set<String>,
    /** Gear/relic per owned unit (game id). */
    val levels: Map<String, UnitLevel> = emptyMap(),
    /** When the server pulled it from the game, or null if it didn't say. */
    val fetchedAtMillis: Long?,
    /** The game couldn't be reached - this is the server's last copy. */
    val stale: Boolean,
) {
    /** When this roster was pulled from the game, on the phone's clock: a
     * fresh pull is from just now (so a server clock that's off doesn't
     * matter); the server's copy is as old as it says (0 = unknown). */
    fun pulledAtMillis(nowMillis: Long): Long = if (stale) fetchedAtMillis ?: 0L else nowMillis
}

/** How built a unit is: gear tier (1-13) and relic level (1-10; 0 or
 * negative/null = no relic yet). */
data class UnitLevel(val gear: Int?, val relic: Int?) {
    private val hasRelic get() = relic != null && relic >= 1

    /** One scale to compare on: gear 1-13, then relics on top (R1 = 14 ... R10 = 23). */
    val tier: Int? get() = if (hasRelic) 13 + relic!! else gear

    /** "R7", "G12", or null if unknown. */
    val label: String? get() = if (hasRelic) "R$relic" else gear?.let { "G$it" }

    companion object {
        /** Tier of an enemy unit whose badge showed relic level [relic]. */
        fun relicTier(relic: Int): Int = 13 + relic
    }
}

/** How old the phone's copy of your roster is, and when to get a new one. */
object RosterAge {
    /** Pull again when opening the panel if the copy is older than this. */
    const val MAX_AGE_MS = 6 * 60 * 60 * 1000L
    /** After a failed pull, wait this long before trying again on its own. */
    const val RETRY_MS = 10 * 60 * 1000L

    fun isOld(fetchedAtMillis: Long, nowMillis: Long): Boolean =
        fetchedAtMillis <= 0 || nowMillis - fetchedAtMillis > MAX_AGE_MS

    /** "just now", "25 min ago", "3 h ago", "2 days ago" - null if unknown. */
    fun describe(fetchedAtMillis: Long, nowMillis: Long): String? {
        if (fetchedAtMillis <= 0) return null
        val minutes = (nowMillis - fetchedAtMillis).coerceAtLeast(0) / 60_000
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "$minutes min ago"
            minutes < 48 * 60 -> "${minutes / 60} h ago"
            else -> "${minutes / (24 * 60)} days ago"
        }
    }
}
