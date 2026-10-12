// In-game GAC screen detection, on synthetic screens. Set GAC_SCREENSHOTS
// to "lit.png,defeated.png" (real phone screenshots kept outside the repo)
// to also check those.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { detectGacSquads } from "./gac.mjs";
import { facePicture, fingerprint, pictureFingerprint, similarity, LENGTH, RING_SCALE, SAME_FACE } from "./faces.mjs";
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
  const fp = (slot) => gameFingerprint(img, slot);
  assert.ok(similarity(fp(a.slots[1]), fp(b.slots[1])) >= SAME_FACE, "face 2 in both squads");
  assert.ok(similarity(fp(a.slots[0]), fp(b.slots[0])) < SAME_FACE);
  assert.ok(similarity(fp(a.slots[2]), fp(a.slots[3])) < SAME_FACE);
});

test("upgrades don't change who a face is: gear/relic/zeta/omicron badges", () => {
  const seeds = [1, 2, 3, 4, 5];
  // A screen fits 3 panels: plain/gear/relic, then plain/maxed out.
  const screens = [
    gacScreen([{ seeds, lit: true }, { seeds, lit: true, badges: "gear" }, { seeds, lit: true, badges: "relic" }]).img,
    gacScreen([{ seeds, lit: true, badges: "maxed" }]).img,
  ];
  const fps = screens.flatMap((img) => detectGacSquads(img).map((s) => s.slots.map((slot) => gameFingerprint(img, slot))));
  assert.equal(fps.length, 4);
  assert.equal(fps[0][0].length, LENGTH);
  for (let k = 0; k < seeds.length; k++) {
    for (const badged of [1, 2, 3]) {
      assert.ok(similarity(fps[0][k], fps[badged][k]) >= 0.99, `face ${k} with badges set ${badged}`);
    }
    for (let other = 0; other < seeds.length; other++) {
      if (other !== k) assert.ok(similarity(fps[3][k], fps[0][other]) < SAME_FACE, `face ${k} vs ${other}`);
    }
  }
});

test("a face's picture fingerprints like the face on screen", () => {
  const { img } = gacScreen([{ seeds: [1, 2, 3, 4, 5], lit: true }]);
  for (const slot of detectGacSquads(img)[0].slots) {
    const picture = facePicture(img, slot.cx, slot.cy, slot.r, RING_SCALE.game);
    assert.equal(picture.width, 72);
    // Measuring the small picture ~ measuring the screenshot itself.
    const fromPicture = pictureFingerprint(picture, RING_SCALE.game);
    assert.ok(similarity(fromPicture, fingerprint(img, slot.cx, slot.cy, slot.r)) >= 0.97);
  }
});

test("nothing that isn't a squad panel", () => {
  const { img } = gacScreen([]);
  assert.deepEqual(detectGacSquads(img), []);
});

function gameFingerprint(img, slot) {
  return pictureFingerprint(facePicture(img, slot.cx, slot.cy, slot.r, RING_SCALE.game), RING_SCALE.game);
}

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
