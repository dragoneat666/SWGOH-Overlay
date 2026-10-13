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

    @Test fun leaderTooFarBelowTheirsIsSetAside() {
        val levels = mapOf(
            "GRANDMASTERLUKE" to UnitLevel(13, 5), // R5
            "GLREY" to UnitLevel(13, 4), // R4
            "JABBATHEHUTT" to UnitLevel(8, -1), // G8, no relics
        )
        // Their leader R7: R5 is exactly 2 below (shown), R4 and G8 aren't.
        val ranked = CounterRanking.rank(listOf(entry), ownsEverything, emptyList(), levels, opponentLeaderRelic = 7)
        assertEquals(listOf(1, 2, 3), ranked.map { it.counter.rank })
        assertEquals(
            listOf(Availability.AVAILABLE, Availability.TOO_WEAK, Availability.TOO_WEAK),
            ranked.map { it.availability },
        )
        assertEquals(listOf(rey), ranked[1].blockers)
        assertEquals("R5", ranked[0].leaderLevel?.label)
        assertEquals("G8", ranked[2].leaderLevel?.label)

        // Too weak goes after used / not owned.
        val used = listOf(UsedSquad("JML team", listOf(jml.id)))
        val withUsed = CounterRanking.rank(listOf(entry), ownsEverything, used, levels, opponentLeaderRelic = 7)
        assertEquals(listOf(1, 2, 3), withUsed.map { it.counter.rank })
        assertEquals(Availability.ALREADY_USED, withUsed[0].availability)

        // Their level unknown, or ours unknown: nothing set aside.
        assertTrue(CounterRanking.rank(listOf(entry), ownsEverything, emptyList(), levels, null).all { it.usable })
        assertTrue(CounterRanking.rank(listOf(entry), ownsEverything, emptyList(), emptyMap(), 7).all { it.usable })
    }

    @Test fun unitLevelScale() {
        assertEquals(21, UnitLevel(13, 8).tier)
        assertEquals(13, UnitLevel(13, 0).tier)
        assertEquals(12, UnitLevel(12, -1).tier)
        assertEquals("G13", UnitLevel(13, 0).label)
        assertEquals(false, CounterRanking.tooWeak(UnitLevel(13, 5), 7))
        assertEquals(true, CounterRanking.tooWeak(UnitLevel(13, 4), 7))
        assertEquals("G12 vs R1: exactly 2 below, still shown", false, CounterRanking.tooWeak(UnitLevel(12, null), 1))
        assertEquals(true, CounterRanking.tooWeak(UnitLevel(11, null), 1))
        assertEquals(false, CounterRanking.tooWeak(UnitLevel(13, 0), 2))
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
