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
        assertEquals("98.5% win · 64.8 ⚑", squads[0].statsLabel)
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

    @Test fun parsesRoster() {
        val fresh = ApiJson.parseRoster(JSONObject(
            """{"ally_code":"123456789","fetched_at":"2026-10-12T18:00:00.000Z","stale":false,"units":[{"unit_definition_id":"VADER"}]}"""
        ))
        assertEquals(setOf("VADER"), fresh.ownedDefinitionIds)
        assertEquals(java.time.Instant.parse("2026-10-12T18:00:00Z").toEpochMilli(), fresh.fetchedAtMillis)
        assertEquals(false, fresh.stale)
        val cached = ApiJson.parseRoster(JSONObject("""{"stale":true,"error":"Comlink down","units":[]}"""))
        assertEquals(true, cached.stale)
        assertNull(cached.fetchedAtMillis)
        // Fresh pulls count from the phone's own clock; old copies keep their time.
        assertEquals(42L, fresh.pulledAtMillis(42L))
        assertEquals(0L, cached.pulledAtMillis(42L))
        assertEquals(7L, fresh.copy(stale = true, fetchedAtMillis = 7L).pulledAtMillis(42L))
    }

    @Test fun rosterAge() {
        val now = 1_000_000_000_000L
        val min = 60_000L
        assertNull(RosterAge.describe(0, now))
        assertEquals("just now", RosterAge.describe(now - 20_000, now))
        assertEquals("25 min ago", RosterAge.describe(now - 25 * min, now))
        assertEquals("3 h ago", RosterAge.describe(now - 200 * min, now))
        assertEquals("2 days ago", RosterAge.describe(now - 50 * 60 * min, now))
        assertEquals(true, RosterAge.isOld(0, now))
        assertEquals(false, RosterAge.isOld(now - 5 * 60 * min, now))
        assertEquals(true, RosterAge.isOld(now - 7 * 60 * min, now))
    }

    @Test fun parsesScanResults() {
        val scan = ApiJson.parseScan(JSONObject(
            """
            {"width":2404,"height":1080,"beaten":1,"squads":[{"slots":[
              {"unit_id":7,"score":0.998,"candidates":[{"unit_id":7,"name":"Finn","score":0.998}],"image":"data:image/png;base64,AAAA","fingerprint":[0.1,-0.2]},
              {"unit_id":null,"score":0.61,"candidates":[{"unit_id":9,"name":"Rey","score":0.61},{"unit_id":4,"name":null,"score":0.3}],"image":"data:image/png;base64,BBBB","fingerprint":[0.3]}
            ],"matches":null}]}
            """.trimIndent()
        ))
        assertEquals(1, scan.beaten)
        val slots = scan.squads.single().slots
        assertEquals(7, slots[0].unitId)
        assertNull(slots[1].unitId)
        assertEquals(0.61, slots[1].score!!, 0.0001)
        assertEquals(listOf(9, 4), slots[1].candidates.map { it.unitId })
        assertEquals("Rey", slots[1].candidates[0].name)
        assertNull(slots[1].candidates[1].name)
        assertEquals("[0.3]", slots[1].fingerprintJson)
        assertEquals("data:image/png;base64,BBBB", slots[1].image)
        assertEquals(emptyList<ScanSquad>(), ApiJson.parseScan(JSONObject("""{"beaten":0,"squads":[]}""")).squads)
    }

    @Test fun emptyResponses() {
        assertEquals(emptyList<TeamMatch>(), ApiJson.parseMatches(JSONObject("""{"matches":[]}""")))
        assertEquals(emptyList<Squad>(), ApiJson.parseDefenderSquads(JSONObject("""{"squads":[]}""")))
    }
}
