package club.denflix.swgohoverlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UnitSearchTest {

    private val units = listOf(
        GameUnit(1, "SUPREMELEADERKYLOREN", "Supreme Leader Kylo Ren", false),
        GameUnit(2, "KYLOREN", "Kylo Ren", false),
        GameUnit(3, "KYLORENUNMASKED", "Kylo Ren (Unmasked)", false),
        GameUnit(4, "JEDIMASTERKENOBI", "Jedi Master Kenobi", false),
        GameUnit(5, "GRANDMASTERLUKE", "Jedi Master Luke Skywalker", false),
        GameUnit(6, "PADMEAMIDALA", "Padmé Amidala", false),
        GameUnit(7, "CAPITALEXECUTOR", "Executor", true),
        GameUnit(8, "CC2224", "CC-2224 \"Cody\"", false),
    )

    private fun ids(query: String, exclude: Set<Int> = emptySet(), kind: UnitSearch.Kind = UnitSearch.Kind.ALL) =
        UnitSearch.search(units, query, exclude, kind).map { it.id }

    @Test fun initials() {
        assertEquals("slkr", UnitSearch.initials("Supreme Leader Kylo Ren"))
        assertEquals("c2c", UnitSearch.initials("CC-2224 \"Cody\""))
    }

    @Test fun prefixBeatsWordBeatsSubstring() {
        assertEquals(listOf(2, 3, 1), ids("kylo"))
    }

    @Test fun initialsTheWayPlayersSayThem() {
        assertEquals(listOf(1), ids("SLKR"))
        assertEquals(listOf(4), ids("jmk"))
        assertEquals(listOf(5), ids("JML"))
    }

    @Test fun accentsAndGameIds() {
        assertEquals(listOf(6), ids("padme"))
        assertEquals(listOf(7), ids("capitalexec"))
        assertEquals(listOf(8), ids("cody"))
    }

    @Test fun excludeAndKind() {
        assertEquals(listOf(3, 1), ids("kylo", exclude = setOf(2)))
        assertEquals(listOf(7), ids("e", kind = UnitSearch.Kind.SHIPS))
        assertTrue(ids("   ").isEmpty())
    }

    @Test fun kindFollowsWhatIsPicked() {
        assertEquals(UnitSearch.Kind.ALL, UnitSearch.kindFor(emptyList()))
        assertEquals(UnitSearch.Kind.SHIPS, UnitSearch.kindFor(listOf(units[6])))
        assertEquals(UnitSearch.Kind.CHARACTERS, UnitSearch.kindFor(listOf(units[0])))
    }
}
