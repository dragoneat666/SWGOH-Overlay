import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { startTestEnv } from "./helpers.mjs";

let env;
let api;

before(async () => {
  env = await startTestEnv();
  api = env.api;
});

after(async () => {
  await env.stop();
});

// Creates units by name, returns { name: id }.
async function makeUnits(...names) {
  const ids = {};
  for (const name of names) {
    const res = await api("POST", "/api/units", { body: { name } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ids[name] = res.body.id;
  }
  return ids;
}

function pngBlob() {
  // 1x1 transparent PNG
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
  return new Blob([bytes], { type: "image/png" });
}

describe("auth", () => {
  test("health is public", async () => {
    const res = await api("GET", "/health", { token: null });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  test("api rejects missing and wrong tokens", async () => {
    assert.equal((await api("GET", "/api/units", { token: null })).status, 401);
    assert.equal((await api("GET", "/api/units", { token: "nope" })).status, 401);
  });

  test("auth/check accepts the right token", async () => {
    const res = await api("GET", "/api/auth/check");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  test("unknown api path is a JSON 404", async () => {
    const res = await api("GET", "/api/nope");
    assert.equal(res.status, 404);
  });

  test("malformed JSON body is a 400", async () => {
    const res = await api("POST", "/api/units", { body: "{not json" });
    assert.equal(res.status, 400);
  });
});

describe("units", () => {
  test("create, list, rename, delete", async () => {
    const created = await api("POST", "/api/units", {
      body: { name: "  Test Unit A ", definition_id: "test_a", is_ship: false },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, "Test Unit A");
    assert.equal(created.body.definition_id, "TEST_A");
    assert.equal(created.body.is_ship, false);

    const dupe = await api("POST", "/api/units", { body: { name: "test unit a" } });
    assert.equal(dupe.status, 201, "names are case-sensitive unique in the DB; only exact dupes conflict");
    const exactDupe = await api("POST", "/api/units", { body: { name: "Test Unit A" } });
    assert.equal(exactDupe.status, 409);

    const noName = await api("POST", "/api/units", { body: { name: "  " } });
    assert.equal(noName.status, 400);

    const renamed = await api("PUT", `/api/units/${created.body.id}`, {
      body: { name: "Test Unit A2", definition_id: "TEST_A", is_ship: true },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, "Test Unit A2");
    assert.equal(renamed.body.is_ship, true);

    const list = await api("GET", "/api/units");
    const listed = list.body.find((u) => u.id === created.body.id);
    assert.equal(listed.name, "Test Unit A2");
    assert.equal(listed.used_in_counters, false);

    assert.equal((await api("DELETE", `/api/units/${created.body.id}`)).status, 204);
    assert.equal((await api("DELETE", `/api/units/${created.body.id}`)).status, 404);
    assert.equal((await api("DELETE", `/api/units/${dupe.body.id}`)).status, 204);
    assert.equal((await api("PUT", "/api/units/999999", { body: { name: "x" } })).status, 404);
    assert.equal((await api("PUT", "/api/units/abc", { body: { name: "x" } })).status, 404);
  });

  test("image upload, replace, and cleanup", async () => {
    const { "Portrait Unit": id } = await makeUnits("Portrait Unit");

    const form = new FormData();
    form.append("image", pngBlob(), "first.png");
    const first = await api("POST", `/api/units/${id}/image`, { form });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const firstFile = path.join(env.uploadDir, first.body.image_path);
    assert.ok(existsSync(firstFile));

    // Served publicly (no token) under /uploads
    const served = await fetch(`${env.baseUrl}/uploads/${first.body.image_path}`);
    assert.equal(served.status, 200);

    const form2 = new FormData();
    form2.append("image", pngBlob(), "second.png");
    const second = await api("POST", `/api/units/${id}/image`, { form: form2 });
    assert.equal(second.status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!existsSync(firstFile), "old portrait file is removed when replaced");

    const bad = new FormData();
    bad.append("image", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
    assert.equal((await api("POST", `/api/units/${id}/image`, { form: bad })).status, 400);

    const missing = new FormData();
    missing.append("image", pngBlob(), "x.png");
    assert.equal((await api("POST", "/api/units/999999/image", { form: missing })).status, 404);

    // Create with an image in one multipart request
    const withImage = new FormData();
    withImage.append("name", "Unit With Picture");
    withImage.append("is_ship", "true");
    withImage.append("image", pngBlob(), "pic.png");
    const created = await api("POST", "/api/units", { form: withImage });
    assert.equal(created.status, 201);
    assert.equal(created.body.is_ship, true);
    assert.ok(created.body.image_path);

    const secondFile = path.join(env.uploadDir, second.body.image_path);
    assert.equal((await api("DELETE", `/api/units/${id}`)).status, 204);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!existsSync(secondFile), "portrait file is removed with the unit");
  });
});

describe("game data import", () => {
  test("imports playable units from Comlink and is safe to re-run", async () => {
    const now = Date.now();
    const unitsData = [
      // Each unit appears once per star level in the real data
      { id: "VADER:ONE_STAR", baseId: "VADER", nameKey: "UNIT_VADER_NAME", rarity: 1, combatType: 1, obtainable: true, obtainableTime: "0" },
      { id: "VADER:SEVEN_STAR", baseId: "VADER", nameKey: "UNIT_VADER_NAME", rarity: 7, combatType: 1, obtainable: true, obtainableTime: "0" },
      { id: "TIEADVANCED:SEVEN_STAR", baseId: "TIEADVANCED", nameKey: "UNIT_TIEADVANCED_NAME", rarity: 7, combatType: 2, obtainable: true, obtainableTime: "0" },
      { id: "GRANDMASTERYODA:SEVEN_STAR", baseId: "GRANDMASTERYODA", nameKey: "UNIT_GMY_NAME", rarity: 7, combatType: 1, obtainable: true, obtainableTime: "0" },
      // Released recently - obtainableTime in the past still counts
      { id: "NEWGUY:SEVEN_STAR", baseId: "NEWGUY", nameKey: "UNIT_NEWGUY_NAME", rarity: 7, combatType: 1, obtainable: true, obtainableTime: String(now - 86400000) },
      // Not released yet
      { id: "FUTURE:SEVEN_STAR", baseId: "FUTURE", nameKey: "UNIT_FUTURE_NAME", rarity: 7, combatType: 1, obtainable: true, obtainableTime: String(now + 86400000 * 30) },
      // Never obtainable
      { id: "NPC:SEVEN_STAR", baseId: "NPC", nameKey: "UNIT_NPC_NAME", rarity: 7, combatType: 1, obtainable: false, obtainableTime: "0" },
      // No English name
      { id: "MYSTERY:SEVEN_STAR", baseId: "MYSTERY", nameKey: "UNIT_MYSTERY_NAME", rarity: 7, combatType: 1, obtainable: true, obtainableTime: "0" },
      // Same display name as Vader - must not clash
      { id: "VADER2:SEVEN_STAR", baseId: "VADERDUPE", nameKey: "UNIT_VADER_NAME", rarity: 7, combatType: 1, obtainable: true, obtainableTime: "0" },
    ];
    const loc = [
      "# localization",
      "UNIT_VADER_NAME|Darth Vader",
      "UNIT_TIEADVANCED_NAME|TIE Advanced x1",
      "UNIT_GMY_NAME|Grand Master Yoda",
      "UNIT_NEWGUY_NAME|New Guy",
      "UNIT_FUTURE_NAME|Future Guy",
      "UNIT_NPC_NAME|Some NPC",
      "SOMETHING_ELSE|has a | pipe in it",
    ].join("\n");

    env.comlinkState.routes = {
      "/metadata": () => ({ body: { latestGamedataVersion: "0.99.1:abc", latestLocalizationBundleVersion: "LOCV1" } }),
      "/data": () => ({ body: { units: unitsData, relicTierDefinition: [] } }),
      "/localization": () => ({ body: { "Loc_ENG_US.txt": loc } }),
    };
    env.comlinkState.requests.length = 0;

    // A unit added by hand before the import gets its definition_id attached
    // instead of being duplicated.
    const manual = await api("POST", "/api/units", { body: { name: "Grand Master Yoda" } });

    const res = await api("POST", "/api/units/import-game-data");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.total, 5);
    assert.equal(res.body.ships, 1);
    assert.equal(res.body.characters, 4);
    assert.equal(res.body.created, 4);
    assert.equal(res.body.updated, 1);
    assert.equal(res.body.skipped_without_name, 1);

    const dataReq = env.comlinkState.requests.find((r) => r.path === "/data");
    assert.equal(dataReq.body.payload.version, "0.99.1:abc");
    assert.equal(dataReq.body.payload.includePveUnits, false);
    const locReq = env.comlinkState.requests.find((r) => r.path === "/localization");
    assert.equal(locReq.body.payload.id, "LOCV1:ENG_US");
    assert.equal(locReq.body.unzip, true);

    const units = (await api("GET", "/api/units")).body;
    const byDef = Object.fromEntries(units.filter((u) => u.definition_id).map((u) => [u.definition_id, u]));
    assert.equal(byDef.VADER.name, "Darth Vader");
    assert.equal(byDef.VADERDUPE.name, "Darth Vader (VADERDUPE)");
    assert.equal(byDef.TIEADVANCED.is_ship, true);
    assert.equal(byDef.GRANDMASTERYODA.id, manual.body.id);
    assert.ok(!byDef.FUTURE && !byDef.NPC && !byDef.MYSTERY);

    const again = await api("POST", "/api/units/import-game-data");
    assert.equal(again.status, 200);
    assert.equal(again.body.created, 0);
    assert.equal(again.body.updated, 0);
    assert.equal(again.body.unchanged, 5);
  });

  test("reports a readable error when Comlink is unhappy", async () => {
    env.comlinkState.routes = {
      "/metadata": () => ({ status: 503, body: { message: "maintenance" } }),
    };
    const res = await api("POST", "/api/units/import-game-data");
    assert.equal(res.status, 500);
    assert.match(res.body.message, /Comlink \/metadata failed \(503\)/);
  });
});

describe("counters", () => {
  let u;

  before(async () => {
    u = await makeUnits(
      "Lord Vader", "Darth Sidious", "Maul", "Darth Malak", "Sith Empire Trooper",
      "Jedi Master Kenobi", "Commander Ahsoka", "Mace Windu", "Cal Kestis", "Cere Junda",
      "Supreme Leader Kylo Ren", "General Hux", "Sith Trooper", "First Order Officer", "Kylo Ren"
    );
  });

  test("validates input", async () => {
    const empty = await api("POST", "/api/counters", { body: {} });
    assert.equal(empty.status, 400);

    const noCounters = await api("POST", "/api/counters", {
      body: { defender_unit_ids: [u["Lord Vader"]], counter_squads: [] },
    });
    assert.equal(noCounters.status, 400);

    const repeated = await api("POST", "/api/counters", {
      body: { defender_unit_ids: [u["Lord Vader"], u["Lord Vader"]], counter_squads: [[u.Maul]] },
    });
    assert.equal(repeated.status, 400);
    assert.match(repeated.body.error, /more than once/);

    const unknown = await api("POST", "/api/counters", {
      body: { defender_unit_ids: [999999], counter_squads: [[u.Maul]] },
    });
    assert.equal(unknown.status, 400);

    const sameSquadTwice = await api("POST", "/api/counters", {
      body: {
        defender_unit_ids: [u["Lord Vader"]],
        counter_squads: [[u.Maul, u["Darth Malak"]], [u.Maul, u["Darth Malak"]]],
      },
    });
    assert.equal(sameSquadTwice.status, 400);

    const tooBig = await api("POST", "/api/counters", {
      body: { defender_unit_ids: Object.values(u).slice(0, 9), counter_squads: [[u.Maul]] },
    });
    assert.equal(tooBig.status, 400);

    const badSource = await api("POST", "/api/counters", {
      body: { defender_unit_ids: [u["Lord Vader"]], counter_squads: [[u.Maul]], source: "magic" },
    });
    assert.equal(badSource.status, 400);

    // Nothing half-written by the failed attempts
    assert.deepEqual((await api("GET", "/api/counters")).body, []);
  });

  let lvCounterId;

  test("create, read, lookup, and list", async () => {
    const lvTeam = [u["Lord Vader"], u["Darth Sidious"], u.Maul, u["Darth Malak"], u["Sith Empire Trooper"]];
    const created = await api("POST", "/api/counters", {
      body: {
        defender_unit_ids: lvTeam,
        counter_squads: [
          { unit_ids: [u["Jedi Master Kenobi"], u["Commander Ahsoka"], u["Mace Windu"]], notes: "Kill Malak first" },
          [u["Cal Kestis"], u["Cere Junda"]],
        ],
        notes: "  LV with Malak  ",
        submitted_by: "Tester",
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, "approved");
    assert.equal(created.body.source, "manual");
    assert.equal(created.body.notes, "LV with Malak");
    assert.deepEqual(created.body.defender.units.map((x) => x.id), lvTeam);
    assert.equal(created.body.recommended_squads.length, 2);
    assert.equal(created.body.recommended_squads[0].rank, 1);
    assert.equal(created.body.recommended_squads[0].notes, "Kill Malak first");
    assert.equal(created.body.recommended_squads[0].units[0].name, "Jedi Master Kenobi");
    assert.equal(created.body.recommended_squads[1].notes, null);
    lvCounterId = created.body.id;

    const fetched = await api("GET", `/api/counters/${lvCounterId}`);
    assert.deepEqual(fetched.body, created.body);
    assert.equal((await api("GET", "/api/counters/999999")).status, 404);
    assert.equal((await api("GET", "/api/counters/abc")).status, 404);

    // Same leader, members in a different order -> same team
    const shuffled = [lvTeam[0], lvTeam[3], lvTeam[1], lvTeam[4], lvTeam[2]];
    const lookup = await api("GET", `/api/counters/lookup?defender_unit_ids=${shuffled.join(",")}`);
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.found, true);
    assert.equal(lookup.body.counters[0].counter_id, lvCounterId);
    assert.equal(lookup.body.counters[0].recommended_squads[0].units.length, 3);
    assert.ok("definition_id" in lookup.body.counters[0].recommended_squads[0].units[0]);

    // Same members, different leader -> a different team
    const otherLeader = [lvTeam[1], lvTeam[0], lvTeam[2], lvTeam[3], lvTeam[4]];
    const miss = await api("GET", `/api/counters/lookup?defender_unit_ids=${otherLeader.join(",")}`);
    assert.deepEqual(miss.body, { found: false, counters: [] });

    assert.equal((await api("GET", "/api/counters/lookup")).status, 400);

    const dupe = await api("POST", "/api/counters", {
      body: { defender_unit_ids: shuffled, counter_squads: [[u["Cal Kestis"]]] },
    });
    assert.equal(dupe.status, 409);
    assert.equal(dupe.body.existing_id, lvCounterId);

    // Different leader is allowed as its own entry
    const sidiousLead = await api("POST", "/api/counters", {
      body: { defender_unit_ids: otherLeader, counter_squads: [[u["Cal Kestis"], u["Cere Junda"]]] },
    });
    assert.equal(sidiousLead.status, 201);

    const list = await api("GET", "/api/counters");
    assert.equal(list.body.length, 2);
    assert.equal(list.body[0].id, sidiousLead.body.id, "newest first");
    assert.equal((await api("GET", "/api/counters?status=approved")).body.length, 2);
    assert.equal((await api("GET", "/api/counters?status=pending")).body.length, 0);
    assert.equal((await api("GET", "/api/counters?status=weird")).status, 400);

    const units = (await api("GET", "/api/units")).body;
    assert.equal(units.find((x) => x.id === u["Cal Kestis"]).used_in_counters, true);
    assert.equal((await api("DELETE", `/api/units/${u["Cal Kestis"]}`)).status, 409);

    const defenders = await api("GET", "/api/counters/defender-squads");
    assert.deepEqual(
      defenders.body.squads.map((s) => s.units[0].name),
      ["Darth Sidious", "Lord Vader"],
      "sorted by leader name"
    );
  });

  test("match finds the closest team even when it's not exact", async () => {
    const slkr = await api("POST", "/api/counters", {
      body: {
        defender_unit_ids: [
          u["Supreme Leader Kylo Ren"], u["General Hux"], u["Sith Trooper"], u["First Order Officer"], u["Kylo Ren"],
        ],
        counter_squads: [[u["Lord Vader"], u.Maul]],
      },
    });
    assert.equal(slkr.status, 201);

    // Exact team
    const exact = await api(
      "GET",
      `/api/counters/match?unit_ids=${[u["Supreme Leader Kylo Ren"], u["Kylo Ren"], u["General Hux"], u["Sith Trooper"], u["First Order Officer"]].join(",")}`
    );
    assert.equal(exact.body.matches[0].defender.id, slkr.body.defender.id);
    assert.equal(exact.body.matches[0].exact, true);
    assert.equal(exact.body.matches[0].score, 1);
    assert.equal(exact.body.matches[0].counters[0].recommended_squads[0].units[0].name, "Lord Vader");

    // Opponent swapped one member out
    const swapped = await api(
      "GET",
      `/api/counters/match?unit_ids=${[u["Supreme Leader Kylo Ren"], u["General Hux"], u["Sith Trooper"], u["First Order Officer"], u["Mace Windu"]].join(",")}`
    );
    const best = swapped.body.matches[0];
    assert.equal(best.defender.id, slkr.body.defender.id);
    assert.equal(best.exact, false);
    assert.equal(best.leader_match, true);
    assert.equal(best.overlap, 4);
    assert.ok(best.score > 0.8 && best.score < 1);

    // Leader alone lists that leader's teams
    const leaderOnly = await api("GET", `/api/counters/match?unit_ids=${u["Lord Vader"]}`);
    assert.equal(leaderOnly.body.matches.length, 1);
    assert.equal(leaderOnly.body.matches[0].defender.units[0].name, "Lord Vader");

    // Unrelated units -> nothing
    const none = await api("GET", `/api/counters/match?unit_ids=${u["Cere Junda"]},${u["Mace Windu"]}`);
    assert.deepEqual(none.body.matches, []);

    // LV team members but no leader: both LV-member teams rank, LV-led one
    // and Sidious-led one tie on coverage
    const partial = await api(
      "GET",
      `/api/counters/match?unit_ids=${[u.Maul, u["Darth Malak"], u["Sith Empire Trooper"]].join(",")}&limit=1`
    );
    assert.equal(partial.body.matches.length, 1);
  });

  test("edit replaces squads and cleans up unused ones", async () => {
    const before = (await env.db.query("SELECT COUNT(*)::int AS n FROM squads")).rows[0].n;

    const edited = await api("PUT", `/api/counters/${lvCounterId}`, {
      body: {
        defender_unit_ids: [u["Lord Vader"], u["Darth Sidious"], u.Maul, u["Darth Malak"], u["Sith Empire Trooper"]],
        counter_squads: [
          { unit_ids: [u["Cal Kestis"], u["Cere Junda"]], notes: "now the best option" },
          { unit_ids: [u["Mace Windu"], u["Commander Ahsoka"]], notes: "" },
        ],
        notes: "",
      },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.notes, null);
    assert.deepEqual(edited.body.recommended_squads.map((s) => s.rank), [1, 2]);
    assert.equal(edited.body.recommended_squads[0].notes, "now the best option");
    assert.equal(edited.body.recommended_squads[1].notes, null);

    // Kenobi/Ahsoka/Mace squad was only used by this counter -> removed;
    // Mace/Ahsoka is new. Net zero.
    const afterCount = (await env.db.query("SELECT COUNT(*)::int AS n FROM squads")).rows[0].n;
    assert.equal(afterCount, before);
    const units = (await api("GET", "/api/units")).body;
    assert.equal(units.find((x) => x.id === u["Jedi Master Kenobi"]).used_in_counters, false);

    // Editing into a defender team that already has its own entry -> 409
    const list = (await api("GET", "/api/counters")).body;
    const sidiousEntry = list.find((c) => c.defender.units[0].name === "Darth Sidious");
    const clash = await api("PUT", `/api/counters/${lvCounterId}`, {
      body: {
        defender_unit_ids: sidiousEntry.defender.units.map((x) => x.id),
        counter_squads: [[u["Cal Kestis"]]],
      },
    });
    assert.equal(clash.status, 409);

    assert.equal(
      (await api("PUT", "/api/counters/999999", { body: { defender_unit_ids: [u.Maul], counter_squads: [[u["Cal Kestis"]]] } })).status,
      404
    );
  });

  test("pending review flow", async () => {
    const pending = await api("POST", "/api/counters", {
      body: {
        defender_unit_ids: [u["Commander Ahsoka"], u["Jedi Master Kenobi"]],
        counter_squads: [[u["Lord Vader"]]],
        source: "ocr",
        submitted_by: "scanner",
      },
    });
    assert.equal(pending.status, 201);
    assert.equal(pending.body.status, "pending");

    const lookupIds = `${u["Commander Ahsoka"]},${u["Jedi Master Kenobi"]}`;
    assert.equal((await api("GET", `/api/counters/lookup?defender_unit_ids=${lookupIds}`)).body.found, false);

    const queue = await api("GET", "/api/counters/pending");
    assert.equal(queue.body.length, 1);
    assert.equal(queue.body[0].defender.units[0].name, "Commander Ahsoka");

    const approved = await api("POST", `/api/counters/${pending.body.id}/approve`, { body: { reviewed_by: "Me" } });
    assert.deepEqual(approved.body, { id: pending.body.id, status: "approved" });
    assert.equal((await api("GET", `/api/counters/lookup?defender_unit_ids=${lookupIds}`)).body.found, true);

    const rejected = await api("POST", `/api/counters/${pending.body.id}/reject`);
    assert.equal(rejected.body.status, "rejected");
    assert.equal((await api("POST", "/api/counters/999999/approve")).status, 404);
  });

  test("delete removes the entry and its now-unused squads", async () => {
    const all = (await api("GET", "/api/counters")).body;
    for (const c of all) {
      assert.equal((await api("DELETE", `/api/counters/${c.id}`)).status, 204);
    }
    assert.equal((await api("DELETE", `/api/counters/${all[0].id}`)).status, 404);
    assert.deepEqual((await api("GET", "/api/counters")).body, []);
    const squads = (await env.db.query("SELECT COUNT(*)::int AS n FROM squads")).rows[0].n;
    assert.equal(squads, 0);
    assert.equal((await api("DELETE", `/api/units/${u["Cal Kestis"]}`)).status, 204);
  });
});

describe("roster", () => {
  const ALLY = "123-456-789";

  test("pulls, archives, and normalizes a roster", async () => {
    env.comlinkState.routes = {
      "/player": (body) => ({
        body: {
          name: "Test Player",
          allyCode: body.payload.allyCode,
          rosterUnit: [
            { definitionId: "VADER:SEVEN_STAR", currentTier: 13, relic: { currentTier: 9 }, purchasedAbilityId: [] },
            { definitionId: "GLREY:SEVEN_STAR", currentTier: 13, relic: { currentTier: 11 }, purchasedAbilityId: ["ultimateability_glrey"] },
            { definitionId: "TIEADVANCED:SEVEN_STAR", currentTier: 1 },
          ],
        },
      }),
    };
    env.comlinkState.requests.length = 0;

    const res = await api("GET", `/api/roster/${ALLY}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ally_code, "123456789");
    assert.equal(res.body.player_name, "Test Player");
    assert.equal(res.body.unit_count, 3);
    const vader = res.body.units.find((x) => x.unit_definition_id === "VADER");
    assert.equal(vader.relic_tier, 7);
    assert.equal(vader.gear_tier, 13);
    const rey = res.body.units.find((x) => x.unit_definition_id === "GLREY");
    assert.deepEqual(rey.purchased_ability_ids, ["ultimateability_glrey"]);
    assert.equal(res.body.units.find((x) => x.unit_definition_id === "TIEADVANCED").relic_tier, null);

    assert.equal(env.comlinkState.requests[0].body.payload.allyCode, "123456789");

    // Second pull upserts rather than duplicating
    await api("GET", `/api/roster/${ALLY}`);
    const { rows } = await env.db.query(
      "SELECT COUNT(*)::int AS n FROM roster_units WHERE ally_code = '123456789'"
    );
    assert.equal(rows[0].n, 3);
    const snaps = await env.db.query(
      "SELECT COUNT(*)::int AS n FROM roster_snapshots WHERE ally_code = '123456789'"
    );
    assert.equal(snaps.rows[0].n, 2, "raw snapshots are append-only");
  });

  test("rejects bad ally codes", async () => {
    assert.equal((await api("GET", "/api/roster/12345")).status, 400);
    assert.equal((await api("GET", "/api/roster/abcdefghi")).status, 400);
  });
});
