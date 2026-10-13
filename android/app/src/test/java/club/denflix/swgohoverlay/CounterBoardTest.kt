package club.denflix.swgohoverlay

import club.denflix.swgohoverlay.CounterRanking.Availability
import org.junit.Assert.assertEquals
import org.junit.Test

class CounterBoardTest {

    private fun unit(id: Int, def: String) = GameUnit(id, def, def, false)

    // Enemy units: Hera team variants.
    private val hera = unit(1, "HERA")
    private val rex = unit(2, "REX")
    private val ezra = unit(3, "EZRA")
    private val sabine = unit(4, "SABINE")
    private val zeb = unit(5, "ZEB")
    private val kanan = unit(6, "KANAN")
    private val chopper = unit(7, "CHOPPER")
    private val other = unit(8, "OTHERLEAD")

    // Your units.
    private val tusken = unit(20, "TUSKEN")
    private val gas = unit(21, "GAS")
    private val jmk = unit(22, "JMK")
    private val luke = unit(23, "CLS")
    private val vader = unit(24, "VADER")

    private val levels = mapOf(
        "TUSKEN" to UnitLevel(8, -1),
        "GAS" to UnitLevel(13, 9),
        "JMK" to UnitLevel(13, 10),
        "CLS" to UnitLevel(13, 4),
    )
    private val owned = setOf("TUSKEN", "GAS", "JMK", "CLS")

    private var squadIds = 100
    private fun counters(vararg squads: Pair<GameUnit, Double>) = listOf(
        CounterEntry(squadIds, null, squads.map { (lead, win) -> CounterSquad(1, null, Squad(squadIds++, listOf(lead)), winRate = win) })
    )
    private fun team(score: Double, units: List<GameUnit>, picked: Set<GameUnit>, cs: List<CounterEntry>) = TeamMatch(
        score = score,
        exact = score == 1.0,
        leaderMatch = units.first() == hera,
        overlap = units.count { it in picked },
        defender = Squad(units.hashCode(), units),
        counters = cs,
    )

    @Test fun closeTeamsInOrderUsableOnlyWithTheRestSetAside() {
        val picked = setOf(hera, rex, ezra, sabine, zeb)
        val matches = listOf(
            // Exact team: only the Tuskens, too weak vs R6.
            team(1.0, listOf(hera, rex, ezra, sabine, zeb), picked, counters(tusken to 100.0)),
            // 4 shared: GAS, plus a Commander Luke with a 14% win rate.
            team(0.83, listOf(hera, rex, kanan, sabine, zeb), picked, counters(gas to 100.0, luke to 14.0)),
            // 3 shared: JMK (and Vader, not owned).
            team(0.67, listOf(hera, rex, chopper, kanan, zeb), picked, counters(jmk to 100.0, vader to 100.0)),
            // Only 2 shared - too far.
            team(0.5, listOf(hera, chopper, kanan, rex, unit(9, "X")), setOf(hera, rex), counters(gas to 100.0)),
            // Someone else's team.
            team(0.6, listOf(other, rex, ezra, sabine, zeb), picked, counters(gas to 90.0)),
        )
        val board = CounterBoard.build(matches, 5, owned, emptyList(), levels, opponentLeaderRelic = 6)

        // The exact team has nothing usable, so it isn't listed; GAS team, then JMK team.
        assertEquals(listOf(0.83, 0.67), board.teams.map { it.match.score })
        assertEquals(listOf(gas), board.teams[0].counters.map { it.counter.squad.leader })
        assertEquals(listOf(jmk), board.teams[1].counters.map { it.counter.squad.leader })
        // Set aside, closest team first: Tuskens (too weak), Luke (14%), Vader (not owned).
        assertEquals(
            listOf(Availability.TOO_WEAK, Availability.LOW_WIN_RATE, Availability.NOT_OWNED),
            board.setAside.map { it.ranked.availability },
        )
        assertEquals(listOf(tusken, luke, vader), board.setAside.map { it.ranked.counter.squad.leader })
    }

    @Test fun aSquadIsListedOnceUnderTheClosestTeam() {
        val picked = setOf(hera, rex, ezra, sabine, zeb)
        val gasSquad = Squad(500, listOf(gas))
        val entry = { id: Int -> listOf(CounterEntry(id, null, listOf(CounterSquad(1, null, gasSquad, winRate = 99.0)))) }
        val board = CounterBoard.build(
            listOf(
                team(0.83, listOf(hera, rex, ezra, sabine, kanan), picked, entry(1)),
                team(0.83, listOf(hera, rex, ezra, zeb, kanan), picked, entry(2)),
            ),
            5, owned, emptyList(), levels,
        )
        assertEquals(1, board.teams.size)
        assertEquals(0, board.setAside.size)
    }

    @Test fun fewUnitsPickedAndNoLeaderMatch() {
        // Leader + 1 picked: teams sharing both count.
        val picked = setOf(hera, rex)
        val board = CounterBoard.build(
            listOf(team(0.5, listOf(hera, rex, chopper, kanan, zeb), picked, counters(gas to 100.0))),
            2, owned, emptyList(), levels,
        )
        assertEquals(1, board.teams.size)

        // No saved team led by the picked leader: whatever the server matched.
        val noLead = CounterBoard.build(
            listOf(team(0.6, listOf(other, rex, ezra, sabine, zeb), setOf(rex, ezra, sabine, zeb), counters(gas to 100.0))),
            4, owned, emptyList(), levels,
        )
        assertEquals(1, noLead.teams.size)
    }
}
