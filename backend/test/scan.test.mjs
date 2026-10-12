import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startTestEnv } from "./helpers.mjs";
import { gacScreen } from "../../shared/scan/synthetic.mjs";
import { detectGacSquads } from "../../shared/scan/gac.mjs";
import { fingerprint } from "../../shared/scan/faces.mjs";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const jpeg = require("jpeg-js");

let env;
let u;

before(async () => {
  env = await startTestEnv();
  u = {};
  for (const name of ["Rey", "Finn", "Poe", "Rose", "Holdo", "Vader", "Counter Lead", "Counter Two"]) {
    u[name] = (await env.api("POST", "/api/units", { body: { name } })).body.id;
  }
});

after(async () => {
  await env.stop();
});

const toPng = (img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  return PNG.sync.write(png);
};
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function scan(body, contentType = "image/png") {
  const res = await fetch(`${env.baseUrl}/api/scan/gac`, {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": contentType },
    body,
  });
  return { status: res.status, body: await res.json() };
}

test("scans a GAC screen: known faces, an unknown one, then a full match", async () => {
  // Screen: the squad we're attacking (lit) and one already beaten.
  const seeds = [1, 2, 3, 4, 5];
  const { img } = gacScreen([
    { seeds, lit: true },
    { seeds: [6, 7, 8, 9, 10], lit: false },
  ]);

  // Teach the server 4 of the 5 faces (as if identified earlier).
  const [squad] = detectGacSquads(img);
  const names = ["Rey", "Finn", "Poe", "Rose"];
  for (let i = 0; i < 4; i++) {
    const s = squad.slots[i];
    const res = await env.api("POST", "/api/portraits", {
      body: { unit_id: u[names[i]], image: PNG_1PX, fingerprint: fingerprint(img, s.cx, s.cy, s.r), source: "gac screen" },
    });
    assert.equal(res.status, 201);
  }
  // A saved defense team for this exact squad, with a counter.
  const defense = [u.Rey, u.Finn, u.Poe, u.Rose, u.Holdo];
  await env.api("POST", "/api/counters", {
    body: { defender_unit_ids: defense, counter_squads: [{ unit_ids: [u["Counter Lead"], u["Counter Two"]], win_rate: 97, avg_banners: 64 }] },
  });

  const first = await scan(toPng(img));
  assert.equal(first.status, 200, JSON.stringify(first.body).slice(0, 300));
  assert.equal(first.body.beaten, 1);
  assert.equal(first.body.squads.length, 1, "only the lit squad");
  const slots = first.body.squads[0].slots;
  assert.deepEqual(slots.slice(0, 4).map((s) => s.unit_id), [u.Rey, u.Finn, u.Poe, u.Rose]);
  assert.ok(slots.slice(0, 4).every((s) => s.score >= 0.9));
  assert.equal(slots[4].unit_id, null, "Holdo isn't known yet");
  assert.ok(Array.isArray(slots[4].candidates));
  assert.ok(slots[4].candidates.length <= 3);
  assert.match(slots[4].image, /^data:image\/png;base64,/);
  assert.ok(slots[4].fingerprint.length > 100);
  assert.equal(first.body.squads[0].matches, null, "no lookup until every face is known");

  // The phone answers "who is this?" with the returned image + fingerprint.
  const taught = await env.api("POST", "/api/portraits", {
    body: { unit_id: u.Holdo, image: slots[4].image, fingerprint: slots[4].fingerprint, source: "gac screen" },
  });
  assert.equal(taught.status, 201, JSON.stringify(taught.body));

  // Next scan: all known, matched to the saved defense team with its counter.
  const second = await scan(toPng(img));
  const s2 = second.body.squads[0];
  assert.deepEqual(s2.slots.map((s) => s.unit_id), defense);
  assert.ok(s2.matches.length >= 1);
  assert.equal(s2.matches[0].exact, true);
  assert.equal(s2.matches[0].counters[0].recommended_squads[0].units[0].name, "Counter Lead");
  assert.equal(s2.matches[0].counters[0].recommended_squads[0].win_rate, 97);

  // JPEG works too (what the phone sends).
  const jpg = jpeg.encode({ data: Buffer.from(img.data), width: img.width, height: img.height }, 92).data;
  const third = await scan(jpg, "image/jpeg");
  assert.equal(third.status, 200);
  assert.deepEqual(third.body.squads[0].slots.map((s) => s.unit_id), defense, "JPEG compression doesn't break matching");
});

test("rejects things that aren't a screenshot", async () => {
  assert.equal((await scan(Buffer.from("hello"), "image/png")).status, 400);
  assert.equal((await scan(Buffer.alloc(0), "image/png")).status, 400);
  const wrongType = await scan(Buffer.from("{}"), "application/json");
  assert.equal(wrongType.status, 400);
  const noAuth = await fetch(`${env.baseUrl}/api/scan/gac`, { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.from("x") });
  assert.equal(noAuth.status, 401);
});

test("a screen with no squads finds nothing", async () => {
  const { img } = gacScreen([]);
  const res = await scan(toPng(img));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.squads, []);
  assert.equal(res.body.beaten, 0);
});
