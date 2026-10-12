import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { startTestEnv } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { counterScore, rankRecommendations } = require("../src/ranking");

let env;
let api;
let u;

before(async () => {
  env = await startTestEnv();
  api = env.api;
  u = {};
  for (const name of ["Darth Malgus", "Sith Trooper A", "Sith Trooper B", "Maz Kanata", "Hunter", "Dooku", "Sidious", "Wrecker"]) {
    const res = await api("POST", "/api/units", { body: { name } });
    u[name] = res.body.id;
  }
});

after(async () => {
  await env.stop();
});

// A 1x1 PNG as a data URL, and fake fingerprints: unit-length vectors
// where "same face" means the same seed.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
function fingerprint(seed, noise = 0) {
  const v = [];
  let x = seed * 9301 + 49297;
  for (let i = 0; i < 600; i++) {
    x = (x * 9301 + 49297) % 233280;
    v.push(x / 233280 - 0.5 + (noise ? (Math.sin(i * 7.3) * noise) : 0));
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return v.map((a) => a / n);
}

describe("ranking", () => {
  test("expected banners, with small samples pulled toward 75%", () => {
    assert.equal(counterScore({ win_rate: null, seen_count: 10, avg_banners: 60 }), null);
    const lucky = counterScore({ win_rate: 100, seen_count: 3, avg_banners: 65 });
    const proven = counterScore({ win_rate: 98, seen_count: 4000, avg_banners: 64 });
    assert.ok(proven > lucky, `${proven} should beat ${lucky}`);
    // Same win rate and sample: more banners wins.
    assert.ok(
      counterScore({ win_rate: 95, seen_count: 500, avg_banners: 66 }) >
        counterScore({ win_rate: 95, seen_count: 500, avg_banners: 60 })
    );
  });

  test("stats first, then entered order", () => {
    const ranked = rankRecommendations([
      { rank: 1, id: "a" },
      { rank: 2, id: "b", win_rate: 90, seen_count: 100, avg_banners: 60 },
      { rank: 3, id: "c", win_rate: 99, seen_count: 1000, avg_banners: 64 },
      { rank: 4, id: "d" },
    ]);
    assert.deepEqual(ranked.map((r) => r.id), ["c", "b", "a", "d"]);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4]);
    assert.deepEqual(ranked.map((r) => r.manual_rank), [3, 2, 1, 4]);
  });
});

describe("counters with stats", () => {
  test("saved stats come back and decide the order", async () => {
    const created = await api("POST", "/api/counters", {
      body: {
        defender_unit_ids: [u["Darth Malgus"], u["Sith Trooper A"]],
        counter_squads: [
          { unit_ids: [u["Dooku"], u["Sidious"]], notes: "entered first", seen_count: 20, win_rate: 80, avg_banners: 60 },
          { unit_ids: [u["Maz Kanata"], u["Hunter"]], seen_count: 3000, win_rate: 99, avg_banners: 64.5 },
          [u["Wrecker"]],
        ],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const recs = created.body.recommended_squads;
    assert.deepEqual(recs.map((r) => r.units[0].name), ["Maz Kanata", "Dooku", "Wrecker"]);
    assert.deepEqual(recs.map((r) => r.rank), [1, 2, 3]);
    assert.deepEqual(recs.map((r) => r.manual_rank), [2, 1, 3]);
    assert.equal(recs[0].win_rate, 99);
    assert.equal(recs[0].seen_count, 3000);
    assert.equal(recs[0].avg_banners, 64.5);
    assert.ok(recs[0].score > recs[1].score);
    assert.equal(recs[2].score, null);
    assert.ok(recs[0].stats_updated_at);
    assert.equal(recs[2].stats_updated_at, null);

    // The overlay's lookup gets the same best-first order.
    const lookup = await api("GET", `/api/counters/lookup?defender_unit_ids=${u["Darth Malgus"]},${u["Sith Trooper A"]}`);
    assert.equal(lookup.body.counters[0].recommended_squads[0].units[0].name, "Maz Kanata");

    const bad = await api("POST", "/api/counters", {
      body: { defender_unit_ids: [u["Wrecker"]], counter_squads: [{ unit_ids: [u["Hunter"]], win_rate: 140 }] },
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /win_rate/);

    assert.equal((await api("DELETE", `/api/counters/${created.body.id}`)).status, 204);
  });
});

describe("screenshot import", () => {
  test("creates teams, adds counters, refreshes stats on re-import", async () => {
    const malgusA = [u["Darth Malgus"], u["Sith Trooper A"]];
    const malgusB = [u["Darth Malgus"], u["Sith Trooper B"]];
    const rows = [
      { defender_unit_ids: malgusA, counter_unit_ids: [u["Maz Kanata"], u["Hunter"]], seen_count: 153, win_rate: 100, avg_banners: 64.8 },
      { defender_unit_ids: malgusA, counter_unit_ids: [u["Dooku"], u["Sidious"]], seen_count: 144, win_rate: 100, avg_banners: 64.97 },
      { defender_unit_ids: malgusB, counter_unit_ids: [u["Maz Kanata"], u["Hunter"]], seen_count: 96, win_rate: 100, avg_banners: 64.93 },
    ];
    const first = await api("POST", "/api/counters/import", { body: { rows } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.defense_teams_created, 2);
    assert.equal(first.body.counters_added, 3);
    assert.equal(first.body.counters_updated, 0);

    const list = (await api("GET", "/api/counters")).body;
    assert.equal(list.length, 2);
    const a = list.find((c) => c.defender.units[1].name === "Sith Trooper A");
    assert.equal(a.source, "import");
    assert.equal(a.status, "approved");
    assert.deepEqual(a.recommended_squads.map((r) => r.units[0].name), ["Dooku", "Maz Kanata"], "64.97 > 64.8 banners");

    // Same screenshot later with newer numbers: no duplicates, stats updated.
    const again = await api("POST", "/api/counters/import", {
      body: { rows: [{ ...rows[0], seen_count: 400, win_rate: 97.5, avg_banners: 63 }] },
    });
    assert.equal(again.body.counters_added, 0);
    assert.equal(again.body.counters_updated, 1);
    const after = (await api("GET", `/api/counters/${a.id}`)).body;
    assert.equal(after.recommended_squads.length, 2);
    const maz = after.recommended_squads.find((r) => r.units[0].name === "Maz Kanata");
    assert.equal(maz.seen_count, 400);
    assert.equal(maz.win_rate, 97.5);

    // Importing into a team that was entered by hand reuses that entry.
    const manual = await api("POST", "/api/counters", {
      body: { defender_unit_ids: [u["Wrecker"]], counter_squads: [[u["Hunter"]]] },
    });
    const into = await api("POST", "/api/counters/import", {
      body: { rows: [{ defender_unit_ids: [u["Wrecker"]], counter_unit_ids: [u["Dooku"]], seen_count: 10, win_rate: 90 }] },
    });
    assert.equal(into.body.defense_teams_created, 0);
    assert.deepEqual(into.body.counter_ids, [manual.body.id]);
    const merged = (await api("GET", `/api/counters/${manual.body.id}`)).body;
    assert.equal(merged.recommended_squads.length, 2);
    assert.equal(merged.recommended_squads[0].units[0].name, "Dooku", "the squad with stats ranks first");
  });

  test("validates rows", async () => {
    assert.equal((await api("POST", "/api/counters/import", { body: { rows: [] } })).status, 400);
    const bad = await api("POST", "/api/counters/import", {
      body: { rows: [{ defender_unit_ids: [u["Wrecker"]], counter_unit_ids: [] }] },
    });
    assert.equal(bad.status, 400);
    const unknownUnit = await api("POST", "/api/counters/import", {
      body: { rows: [{ defender_unit_ids: [999999], counter_unit_ids: [u["Dooku"]] }] },
    });
    assert.equal(unknownUnit.status, 400);
  });
});

describe("offense", () => {
  test("what a squad beats, and the most-used squads", async () => {
    const o = {};
    for (const name of ["O Lead", "O Two", "O Three", "O Alt", "Def One", "Def Two", "Def Three", "Other Lead"]) {
      o[name] = (await api("POST", "/api/units", { body: { name } })).body.id;
    }
    const full = [o["O Lead"], o["O Two"], o["O Three"]];
    const variant = [o["O Lead"], o["O Two"], o["O Alt"]];
    const imported = await api("POST", "/api/counters/import", {
      body: {
        rows: [
          { defender_unit_ids: [o["Def One"]], counter_unit_ids: full, seen_count: 40, win_rate: 95, avg_banners: 63 },
          { defender_unit_ids: [o["Def Two"]], counter_unit_ids: full, seen_count: 40, win_rate: 99, avg_banners: 62 },
          { defender_unit_ids: [o["Def Three"]], counter_unit_ids: variant, seen_count: 40, win_rate: 80, avg_banners: 60 },
          { defender_unit_ids: [o["Def Three"]], counter_unit_ids: [o["Other Lead"]], seen_count: 40, win_rate: 100, avg_banners: 65 },
        ],
      },
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));

    // Exact squad: the two defenses it beat, best win rate first.
    const exact = await api("GET", `/api/counters/offense?unit_ids=${full.join(",")}`);
    assert.equal(exact.status, 200);
    assert.deepEqual(exact.body.results.map((r) => r.defender.units[0].name), ["Def Two", "Def One"]);
    assert.ok(exact.body.results.every((r) => r.exact));
    assert.equal(exact.body.results[0].win_rate, 99);

    // Leader + one member: finds both full squads that include them.
    const partial = await api("GET", `/api/counters/offense?unit_ids=${o["O Lead"]},${o["O Two"]}`);
    assert.equal(partial.body.results.length, 3);
    assert.ok(partial.body.results.every((r) => !r.exact));
    assert.equal(partial.body.results[2].squad.units[2].name, "O Alt");

    // Same units but a different leader is a different squad.
    const wrongLead = await api("GET", `/api/counters/offense?unit_ids=${o["O Two"]},${o["O Lead"]}`);
    assert.deepEqual(wrongLead.body.results, []);
    assert.equal((await api("GET", "/api/counters/offense")).status, 400);

    // Popular: the full squad beats 2 defense teams - more than the others.
    const popular = await api("GET", "/api/counters/offense/popular?limit=50");
    assert.equal(popular.status, 200);
    const top = popular.body.squads.find((s) => s.units[0].name === "O Lead" && s.units.length === 3 && s.units[2].name === "O Three");
    assert.equal(top.defense_teams, 2);
    assert.equal(top.avg_win_rate, 97);
    assert.equal(top.avg_banners, 62.5);
    const iTop = popular.body.squads.indexOf(top);
    const iOther = popular.body.squads.findIndex((s) => s.units[0].name === "Other Lead");
    assert.ok(iTop < iOther, "beating more defense teams ranks higher");
  });
});

describe("faces", () => {
  test("identify a face, then it's in the library and the unit has a picture", async () => {
    const res = await api("POST", "/api/portraits", {
      body: { unit_id: u["Maz Kanata"], image: PNG_DATA_URL, fingerprint: fingerprint(1), source: "test" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(existsSync(path.join(env.uploadDir, res.body.image_path)));

    const library = (await api("GET", "/api/portraits/library")).body;
    assert.equal(library.length, 1);
    assert.equal(library[0].unit_id, u["Maz Kanata"]);
    assert.equal(library[0].fingerprint.length, 600);

    const units = (await api("GET", "/api/units")).body;
    assert.equal(units.find((x) => x.id === u["Maz Kanata"]).image_path, res.body.image_path);

    // A second face for the same unit doesn't replace its picture.
    const second = await api("POST", "/api/portraits", {
      body: { unit_id: u["Maz Kanata"], image: PNG_DATA_URL, fingerprint: fingerprint(2) },
    });
    const units2 = (await api("GET", "/api/units")).body;
    assert.equal(units2.find((x) => x.id === u["Maz Kanata"]).image_path, res.body.image_path);
    assert.equal((await api("DELETE", `/api/portraits/${second.body.id}`)).status, 204);

    assert.equal(
      (await api("POST", "/api/portraits", { body: { unit_id: 999999, image: PNG_DATA_URL, fingerprint: fingerprint(3) } })).status,
      400
    );
    assert.equal(
      (await api("POST", "/api/portraits", { body: { unit_id: u["Hunter"], image: "data:image/png;base64,AAAA", fingerprint: fingerprint(3) } })).status,
      400
    );
    assert.equal(
      (await api("POST", "/api/portraits", { body: { unit_id: u["Hunter"], image: PNG_DATA_URL, fingerprint: [1, 2] } })).status,
      400
    );
  });

  test("fix a wrong match: move a face to the right unit, or remove it", async () => {
    // Two faces saved as Dooku - the first by mistake (it's really Sidious).
    const wrong = (await api("POST", "/api/portraits", {
      body: { unit_id: u["Dooku"], image: PNG_DATA_URL, fingerprint: fingerprint(20) },
    })).body;
    const right = (await api("POST", "/api/portraits", {
      body: { unit_id: u["Dooku"], image: PNG_DATA_URL, fingerprint: fingerprint(21) },
    })).body;
    const unitPic = async (name) => (await api("GET", "/api/units")).body.find((x) => x.id === u[name]);
    assert.equal((await unitPic("Dooku")).image_path, wrong.image_path, "first face became the picture");
    assert.equal((await unitPic("Dooku")).face_count, 2);

    const listed = (await api("GET", `/api/portraits?unit_id=${u["Dooku"]}`)).body;
    assert.deepEqual(listed.map((f) => f.id), [wrong.id, right.id]);
    assert.ok(!("fingerprint" in listed[0]), "list stays small");
    assert.equal((await api("GET", "/api/portraits")).status, 400);

    const moved = await api("PATCH", `/api/portraits/${wrong.id}`, { body: { unit_id: u["Sidious"] } });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.unit_id, u["Sidious"]);
    assert.equal((await unitPic("Dooku")).image_path, right.image_path, "Dooku's picture switched to his real face");
    assert.equal((await unitPic("Sidious")).image_path, wrong.image_path, "Sidious had none, gets this one");
    const library = (await api("GET", "/api/portraits/library")).body;
    assert.equal(library.find((f) => f.id === wrong.id).unit_id, u["Sidious"], "future matches use the fix");

    // Removing Dooku's only face clears his picture and deletes the file.
    assert.equal((await api("DELETE", `/api/portraits/${right.id}`)).status, 204);
    assert.equal((await unitPic("Dooku")).image_path, null);
    assert.equal((await unitPic("Dooku")).face_count, 0);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!existsSync(path.join(env.uploadDir, right.image_path)));

    assert.equal((await api("PATCH", "/api/portraits/999999", { body: { unit_id: u["Dooku"] } })).status, 404);
    assert.equal((await api("PATCH", `/api/portraits/${wrong.id}`, { body: { unit_id: 999999 } })).status, 400);
  });

  test("queue: dedupes, identifies (with look-alikes), and dismisses", async () => {
    const queued = await api("POST", "/api/portraits/unidentified", {
      body: {
        items: [
          { image: PNG_DATA_URL, fingerprint: fingerprint(10), source: "screenshot" },
          { image: PNG_DATA_URL, fingerprint: fingerprint(10, 0.0005) }, // same face again
          { image: PNG_DATA_URL, fingerprint: fingerprint(11) },
          { image: PNG_DATA_URL, fingerprint: fingerprint(1) }, // already known (Maz)
        ],
      },
    });
    assert.equal(queued.status, 201, JSON.stringify(queued.body));
    assert.deepEqual(queued.body, { added: 2, skipped: 2 });

    let queue = (await api("GET", "/api/portraits/unidentified")).body;
    assert.equal(queue.length, 2);

    // Re-uploading the same screenshot adds nothing.
    const again = await api("POST", "/api/portraits/unidentified", {
      body: { items: [{ image: PNG_DATA_URL, fingerprint: fingerprint(10) }] },
    });
    assert.deepEqual(again.body, { added: 0, skipped: 1 });

    const ident = await api("POST", `/api/portraits/unidentified/${queue[0].id}/identify`, {
      body: { unit_id: u["Hunter"] },
    });
    assert.equal(ident.status, 200, JSON.stringify(ident.body));
    assert.equal(ident.body.resolved, 1);
    const library = (await api("GET", "/api/portraits/library")).body;
    assert.ok(library.some((f) => f.unit_id === u["Hunter"]));

    queue = (await api("GET", "/api/portraits/unidentified")).body;
    assert.equal(queue.length, 1);
    assert.equal((await api("DELETE", `/api/portraits/unidentified/${queue[0].id}`)).status, 204);
    assert.equal((await api("GET", "/api/portraits/unidentified")).body.length, 0);
    assert.equal((await api("DELETE", `/api/portraits/unidentified/${queue[0].id}`)).status, 404);
    assert.equal((await api("POST", "/api/portraits/unidentified/999/identify", { body: { unit_id: u["Hunter"] } })).status, 404);
  });
});
