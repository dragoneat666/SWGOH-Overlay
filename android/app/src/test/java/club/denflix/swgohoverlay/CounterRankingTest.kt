package club.denflix.swgohoverlay

import club.denflix.swgohoverlay.CounterRanking.Availability
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CounterRankingTest {

    private val jml = GameUnit(1, "GRANDMASTERLUKE", "Jedi Master Luke Skywalker", false)
    private val jkl = GameUnit(2, "JEDIKNIGHTLUKE", "Jedi Knight Luke Skywalker", false)
    private val rey = GameUnit(3, "GLREY", "Rey", false)
    private val cal = GameUnit(4, "CALKESTIS", "Cal Kestis", false)
    private val jabba = GameUnit(5, "JABBATHEHUTT", "Jabba the Hutt", false)
    private val handAdded = GameUnit(6, null, "Hand-added unit", false)

    private fun counter(rank: Int, squadId: Int, vararg units: GameUnit) =
        CounterSquad(rank, null, Squad(squadId, units.toList()))

    private val entry = CounterEntry(
        counterId = 1, notes = null,
        squads = listOf(
            counter(1, 10, jml, jkl),
            counter(2, 11, rey, cal),
            counter(3, 12, jabba),
        ),
    )

    private val ownsEverything = setOf("GRANDMASTERLUKE", "JEDIKNIGHTLUKE", "GLREY", "CALKESTIS", "JABBATHEHUTT")

    @Test fun everythingAvailableKeepsRankOrder() {
        val ranked = CounterRanking.rank(listOf(entry), ownsEverything, emptyList())
        assertEquals(listOf(1, 2, 3), ranked.map { it.counter.rank })
        assertTrue(ranked.all { it.usable })
    }

    @Test fun anyUsedUnitBlocksTheSquad() {
        // The used squad shares only JKL with counter #1 - that still blocks it.
        val used = listOf(UsedSquad("JKL team", listOf(jkl.id, 99)))
        val ranked = CounterRanking.rank(listOf(entry), ownsEverything, used)
        assertEquals(listOf(2, 3, 1), ranked.map { it.counter.rank })
        assertEquals(Availability.ALREADY_USED, ranked.last().availability)
        assertEquals(listOf(jkl), ranked.last().blockers)
    }

    @Test fun missingUnitsBlockWhenRosterKnown() {
        val ranked = CounterRanking.rank(listOf(entry), ownsEverything - "GLREY", emptyList())
        assertEquals(listOf(1, 3, 2), ranked.map { it.counter.rank })
        assertEquals(Availability.NOT_OWNED, ranked.last().availability)
        assertEquals(listOf(rey), ranked.last().blockers)
    }

    @Test fun unknownRosterHidesNothing() {
        assertTrue(CounterRanking.rank(listOf(entry), null, emptyList()).all { it.usable })
    }

    @Test fun unitsWithoutGameIdCountAsOwned() {
        val e = CounterEntry(2, null, listOf(counter(1, 20, handAdded)))
        assertEquals(Availability.AVAILABLE, CounterRanking.rank(listOf(e), emptySet(), emptyList()).single().availability)
    }

    @Test fun usedWinsOverNotOwnedAndDuplicatesCollapse() {
        val dupe = CounterEntry(3, null, listOf(counter(1, 10, jml, jkl)))
        val used = listOf(UsedSquad("JML", listOf(jml.id)))
        val ranked = CounterRanking.rank(listOf(entry, dupe), emptySet(), used)
        assertEquals(3, ranked.size)
        assertEquals(Availability.ALREADY_USED, ranked.first { it.counter.squad.id == 10 }.availability)
    }
}
