package club.denflix.swgohoverlay

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Parses responses in exactly the shape backend/src/routes return them. */
class ApiJsonTest {

    private val matchResponse = """
        {"matches":[{"score":0.833,"exact":false,"leader_match":true,"overlap":4,
          "defender":{"id":7,"units":[
            {"id":1,"definition_id":"LORDVADER","name":"Lord Vader","image_path":null,"is_ship":false},
            {"id":2,"definition_id":"MAUL","name":"Maul","image_path":"x.png","is_ship":false}]},
          "counters":[{"counter_id":3,"notes":"Very fast","recommended_squads":[
            {"rank":1,"manual_rank":2,"notes":"JML gets it done","seen_count":4096,"win_rate":98.5,"avg_banners":64.8,"score":62.1,"id":9,"units":[
              {"id":5,"definition_id":"GRANDMASTERLUKE","name":"Jedi Master Luke Skywalker","image_path":null,"is_ship":false}]},
            {"rank":2,"notes":null,"id":10,"units":[
              {"id":6,"definition_id":null,"name":"Hand-added","image_path":null,"is_ship":false}]}]}]}]}
    """.trimIndent()

    @Test fun parsesMatches() {
        val m = ApiJson.parseMatches(JSONObject(matchResponse)).single()
        assertEquals(0.833, m.score, 0.0001)
        assertEquals(false, m.exact)
        assertEquals(4, m.overlap)
        assertEquals("Lord Vader", m.defender.leader?.name)
        assertEquals(listOf(1, 2), m.defender.unitIds)
        assertEquals("Very fast", m.counters[0].notes)
        val squads = m.counters[0].squads
        assertEquals("JML gets it done", squads[0].notes)
        assertEquals("GRANDMASTERLUKE", squads[0].squad.units[0].definitionId)
        assertNull(squads[1].notes)
        assertNull(squads[1].squad.units[0].definitionId)
        // Battle stats (only on the first one).
        assertEquals(98.5, squads[0].winRate!!, 0.0001)
        assertEquals(4096, squads[0].seenCount)
        assertEquals("98.5% win · 4.1k seen · 64.8 ⚑", squads[0].statsLabel)
        assertNull(squads[1].winRate)
        assertNull(squads[1].statsLabel)
    }

    @Test fun parsesUnitsAndRoster() {
        val units = ApiJson.parseUnits(JSONArray(
            """[{"id":1,"definition_id":"CAPITALEXECUTOR","name":"Executor","image_path":null,"is_ship":true,"used_in_counters":false}]"""
        ))
        assertEquals(GameUnit(1, "CAPITALEXECUTOR", "Executor", true), units.single())

        val owned = ApiJson.parseOwnedDefinitionIds(JSONObject(
            """{"ally_code":"123456789","units":[{"unit_definition_id":"VADER","gear_tier":13},{"unit_definition_id":"GLREY"}]}"""
        ))
        assertEquals(setOf("VADER", "GLREY"), owned)
    }

    @Test fun emptyResponses() {
        assertEquals(emptyList<TeamMatch>(), ApiJson.parseMatches(JSONObject("""{"matches":[]}""")))
        assertEquals(emptyList<Squad>(), ApiJson.parseDefenderSquads(JSONObject("""{"squads":[]}""")))
    }
}
