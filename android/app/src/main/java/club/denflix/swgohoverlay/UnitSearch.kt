package club.denflix.swgohoverlay

import java.text.Normalizer

/**
 * Unit search for the overlay's search box - same rules as the web UI's
 * frontend/src/unitSearch.js: name fragments ("kylo") or initials the way
 * players say them ("SLKR" -> Supreme Leader Kylo Ren, "JMK" -> Jedi Master
 * Kenobi).
 */
object UnitSearch {

    enum class Kind { ALL, CHARACTERS, SHIPS }

    private val accents = Regex("\\p{Mn}+")
    private val initialsSplit = Regex("[\\s\\-()\"'.]+")
    private val wordSplit = Regex("[\\s\\-()]+")

    fun fold(text: String): String =
        Normalizer.normalize(text, Normalizer.Form.NFD).replace(accents, "").lowercase()

    fun initials(name: String): String =
        fold(name).split(initialsSplit).filter { it.isNotEmpty() }.joinToString("") { it.substring(0, 1) }

    /** Lower is better; null = no match. */
    fun matchRank(unit: GameUnit, query: String): Int? {
        val q = fold(query).trim()
        if (q.isEmpty()) return null
        val name = fold(unit.name)
        if (name.startsWith(q)) return 0
        if (!q.contains(' ') && q.length >= 2 && initials(unit.name).startsWith(q)) return 1
        if (name.split(wordSplit).any { it.startsWith(q) }) return 2
        if (name.contains(q)) return 3
        val defId = unit.definitionId
        if (defId != null && fold(defId).contains(q.replace(Regex("\\s+"), ""))) return 4
        return null
    }

    fun search(
        units: List<GameUnit>,
        query: String,
        exclude: Set<Int> = emptySet(),
        kind: Kind = Kind.ALL,
        limit: Int = 8,
    ): List<GameUnit> =
        units.asSequence()
            .filter { it.id !in exclude }
            .filter {
                when (kind) {
                    Kind.ALL -> true
                    Kind.SHIPS -> it.isShip
                    Kind.CHARACTERS -> !it.isShip
                }
            }
            .mapNotNull { u -> matchRank(u, query)?.let { u to it } }
            .sortedWith(compareBy({ it.second }, { it.first.name.length }, { it.first.name }))
            .take(limit)
            .map { it.first }
            .toList()

    /** Squads never mix characters and ships, so once something is picked
     * only that kind is offered. */
    fun kindFor(selected: List<GameUnit>): Kind = when {
        selected.isEmpty() -> Kind.ALL
        selected.first().isShip -> Kind.SHIPS
        else -> Kind.CHARACTERS
    }
}
