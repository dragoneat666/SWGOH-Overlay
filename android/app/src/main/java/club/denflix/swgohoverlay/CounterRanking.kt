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
 *
 * Usable counters come first in their original rank order; the rest follow,
 * still in rank order, with the reason attached so the overlay can show it.
 */
object CounterRanking {

    enum class Availability { AVAILABLE, ALREADY_USED, NOT_OWNED }

    data class Ranked(
        val counter: CounterSquad,
        val availability: Availability,
        /** Units behind the availability (the used or missing ones). */
        val blockers: List<GameUnit>,
    ) {
        val usable: Boolean get() = availability == Availability.AVAILABLE
    }

    fun rank(entries: List<CounterEntry>, owned: Set<String>?, used: List<UsedSquad>): List<Ranked> {
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
            when {
                usedUnits.isNotEmpty() -> Ranked(c, Availability.ALREADY_USED, usedUnits)
                missing.isNotEmpty() -> Ranked(c, Availability.NOT_OWNED, missing)
                else -> Ranked(c, Availability.AVAILABLE, emptyList())
            }
        }
        return ranked.filter { it.usable } + ranked.filterNot { it.usable }
    }
}
