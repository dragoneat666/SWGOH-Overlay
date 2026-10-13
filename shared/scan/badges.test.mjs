// Relic badge pictures for the text reader, on synthetic GAC screens. The
// reading itself (tesseract) is checked against real screenshots in
// backend/test/scan.test.mjs when GAC_RELICS is set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectGacSquads } from "./gac.mjs";
import { relicNumberImage, parseRelic, whiteness, NUMBER_BOX } from "./badges.mjs";
import { gacScreen, fillRect } from "./synthetic.mjs";

test("a white number on the badge shows up as ink; a plain badge doesn't", () => {
  const { img } = gacScreen([{ seeds: [1, 2, 3, 4, 5], lit: true, badges: "relic" }]);
  const [squad] = detectGacSquads(img);
  const plain = relicNumberImage(img, squad.slots[0]);
  assert.ok(plain.ink < 0.01, `no number: ink ${plain.ink}`);

  // Paint a white "1" into the second badge's number box.
  const s = squad.slots[1];
  fillRect(img, Math.round(s.cx - 1), Math.round(s.cy + (NUMBER_BOX.y0 + 0.08) * s.r), 3, Math.round(0.3 * s.r), [235, 235, 235]);
  const numbered = relicNumberImage(img, s);
  assert.ok(numbered.ink > 0.02, `number: ink ${numbered.ink}`);
  // Dark on white, stretched sideways (wider than tall, unlike the box).
  assert.ok(numbered.width > numbered.height);
  const darkest = Math.min(...numbered.data.filter((_, i) => i % 4 === 0));
  assert.ok(darkest < 40);
});

test("only bright, unsaturated pixels count as digits", () => {
  assert.equal(whiteness(240, 240, 240), 1);
  assert.equal(whiteness(30, 90, 170), 0, "badge blue");
  assert.equal(whiteness(220, 170, 60), 0, "gold badge");
  assert.ok(whiteness(150, 175, 185) < 0.5, "pale level number (not a relic)");
});

test("what counts as a relic level", () => {
  assert.equal(parseRelic("7\n"), 7);
  assert.equal(parseRelic("10"), 10);
  assert.equal(parseRelic(" 1 "), 1);
  assert.equal(parseRelic("85"), null, "a unit level");
  assert.equal(parseRelic("34"), null);
  assert.equal(parseRelic("0"), null);
  assert.equal(parseRelic(""), null);
  assert.equal(parseRelic("7a"), null);
});
