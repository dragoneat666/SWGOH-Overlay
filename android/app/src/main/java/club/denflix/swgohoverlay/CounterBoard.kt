package club.denflix.swgohoverlay

/**
 * What the overlay lists for the enemy team you picked: the closest saved
 * defense teams one after another, each with the counters you can use
 * against it, and everything you can't use collected at the bottom.
 *
 * - Teams: the ones led by the same unit as yours with at least
 *   MIN_SHARED units in common (all of them when fewer are picked) - the
 *   last slots of a team vary, and the counters recorded against a close
 *   variant usually work on yours too. If no saved team has your leader,
 *   every returned match is used, closest first.
 * - A counter squad is listed once, under the closest team it was recorded
 *   against.
 * - Usable counters stay under their team; used, not owned, probably too
 *   weak and low-win-rate ones go to [setAside]. Teams left with nothing
 *   usable aren't listed (their counters are still in [setAside]).
 */
object CounterBoard {

    const val MIN_SHARED = 3

    data class Team(val match: TeamMatch, val counters: List<CounterRanking.Ranked>)

    data class SetAside(val ranked: CounterRanking.Ranked, val team: TeamMatch)

    data class Board(val teams: List<Team>, val setAside: List<SetAside>)

    fun build(
        matches: List<TeamMatch>,
        pickedCount: Int,
        owned: Set<String>?,
        used: List<UsedSquad>,
        levels: Map<String, UnitLevel> = emptyMap(),
        opponentLeaderRelic: Int? = null,
    ): Board {
        val minShared = minOf(pickedCount, MIN_SHARED)
        val candidates = if (matches.any { it.leaderMatch }) {
            matches.filter { it.leaderMatch && it.overlap >= minShared }
        } else {
            matches
        }
        val seen = mutableSetOf<Int>()
        val teams = mutableListOf<Team>()
        val setAside = mutableListOf<SetAside>()
        for (match in candidates) {
            val ranked = CounterRanking.rank(match.counters, owned, used, levels, opponentLeaderRelic)
                .filter { seen.add(it.counter.squad.id) }
            val usable = ranked.filter { it.usable }
            if (usable.isNotEmpty()) teams += Team(match, usable)
            ranked.filterNot { it.usable }.forEach { setAside += SetAside(it, match) }
        }
        return Board(teams, setAside)
    }
}
