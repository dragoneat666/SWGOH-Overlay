// In-game GAC screen detection, on synthetic screens. Set GAC_SCREENSHOTS
// to "lit.png,defeated.png" (real phone screenshots kept outside the repo)
// to also check those.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { detectGacSquads } from "./gac.mjs";
import { fingerprint, similarity, SAME_FACE } from "./faces.mjs";
import { gacScreen } from "./synthetic.mjs";

test("finds each panel, its portraits, and whether it's still standing", () => {
  const { img, faces } = gacScreen([
    { seeds: [1, 2, 3, 4, 5], lit: true },
    { seeds: [6, 7, 8, 9, 10], lit: false },
    { seeds: [11, 2, 12, 13, 14], lit: true },
  ]);
  const squads = detectGacSquads(img);
  assert.equal(squads.length, 3);
  assert.deepEqual(squads.map((s) => s.lit), [true, false, true]);
  squads.forEach((s, i) => {
    assert.equal(s.slots.length, 5);
    s.slots.forEach((slot, k) => {
      assert.ok(Math.abs(slot.cx - faces[i][k].cx) <= 2, `x of ${i}/${k}`);
      assert.ok(Math.abs(slot.cy - faces[i][k].cy) <= 2, `y of ${i}/${k}`);
    });
  });
});

test("the same face in two squads matches, different faces don't", () => {
  const { img } = gacScreen([
    { seeds: [1, 2, 3, 4, 5], lit: true },
    { seeds: [11, 2, 12, 13, 14], lit: true },
  ]);
  const [a, b] = detectGacSquads(img);
  const fp = (slot) => fingerprint(img, slot.cx, slot.cy, slot.r);
  assert.ok(similarity(fp(a.slots[1]), fp(b.slots[1])) >= SAME_FACE, "face 2 in both squads");
  assert.ok(similarity(fp(a.slots[0]), fp(b.slots[0])) < SAME_FACE);
  assert.ok(similarity(fp(a.slots[2]), fp(a.slots[3])) < SAME_FACE);
});

test("nothing that isn't a squad panel", () => {
  const { img } = gacScreen([]);
  assert.deepEqual(detectGacSquads(img), []);
});

const real = (process.env.GAC_SCREENSHOTS || "").split(",").filter(Boolean);
test("real screenshots (GAC_SCREENSHOTS)", { skip: real.length === 0 || !real.every(existsSync) }, () => {
  const require = createRequire(process.cwd() + "/package.json");
  const { PNG } = require("pngjs");
  for (const file of real) {
    const squads = detectGacSquads(PNG.sync.read(readFileSync(file)));
    assert.ok(squads.length > 0, file);
    for (const s of squads.filter((q) => q.lit)) assert.ok(s.slots.length >= 1 && s.slots.length <= 5, file);
  }
});
