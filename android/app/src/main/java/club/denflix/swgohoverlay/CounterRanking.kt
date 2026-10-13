package club.denflix.swgohoverlay

/**
 * Decides which counter squads you can actually use right now.
 *
 * - In GAC each character can only attack once per round, so a counter is
 *   out as soon as ANY of its units was in a squad already marked used -
 *   not only when the whole squad matches.
 * - A counter needing a unit you don't own is out too. While the roster
 *   hasn't loaded (owned == null) ownership is unknown, so nothing is
 *   hidden for that reason.
 * - When the enemy leader's relic level is known (read off a screen scan),
 *   a counter whose leader is more than MAX_RELIC_GAP levels below it is
 *   "probably too weak" - the leader's kit usually carries the matchup, so
 *   that's where your build matters most. Unknown levels hide nothing.
 *
 * Usable counters come first in their original rank order; then used/not
 * owned ones, then probably-too-weak ones - each in rank order, with the
 * reason attached so the overlay can show it.
 */
object CounterRanking {

    /** How many relic levels your leader may be below theirs. */
    const val MAX_RELIC_GAP = 2

    enum class Availability { AVAILABLE, ALREADY_USED, NOT_OWNED, TOO_WEAK }

    data class Ranked(
        val counter: CounterSquad,
        val availability: Availability,
        /** Units behind the availability (the used or missing ones, or the leader). */
        val blockers: List<GameUnit>,
        /** Your build of the squad's leader, if known. */
        val leaderLevel: UnitLevel? = null,
    ) {
        val usable: Boolean get() = availability == Availability.AVAILABLE
    }

    /** True if your leader at [mine] is more than MAX_RELIC_GAP below an enemy leader at relic [theirRelic]. */
    fun tooWeak(mine: UnitLevel?, theirRelic: Int?): Boolean {
        val myTier = mine?.tier ?: return false
        if (theirRelic == null) return false
        return myTier < UnitLevel.relicTier(theirRelic) - MAX_RELIC_GAP
    }

    fun rank(
        entries: List<CounterEntry>,
        owned: Set<String>?,
        used: List<UsedSquad>,
        levels: Map<String, UnitLevel> = emptyMap(),
        opponentLeaderRelic: Int? = null,
    ): List<Ranked> {
        val usedUnitIds = used.flatMap { it.unitIds }.toSet()

        val seenSquads = mutableSetOf<Int>()
        val counters = entries
            .flatMap { it.squads }
            .sortedBy { it.rank }
            .filter { seenSquads.add(it.squad.id) }

        val ranked = counters.map { c ->
            val usedUnits = c.squad.units.filter { it.id in usedUnitIds }
            val missing = if (owned == null) emptyList() else c.squad.units.filter {
                it.definitionId != null && it.definitionId !in owned
            }
            val leader = c.squad.units.firstOrNull()
            val leaderLevel = leader?.definitionId?.let { levels[it] }
            when {
                usedUnits.isNotEmpty() -> Ranked(c, Availability.ALREADY_USED, usedUnits, leaderLevel)
                missing.isNotEmpty() -> Ranked(c, Availability.NOT_OWNED, missing, leaderLevel)
                tooWeak(leaderLevel, opponentLeaderRelic) -> Ranked(c, Availability.TOO_WEAK, listOfNotNull(leader), leaderLevel)
                else -> Ranked(c, Availability.AVAILABLE, emptyList(), leaderLevel)
            }
        }
        return ranked.filter { it.usable } +
            ranked.filter { !it.usable && it.availability != Availability.TOO_WEAK } +
            ranked.filter { it.availability == Availability.TOO_WEAK }
    }
}
