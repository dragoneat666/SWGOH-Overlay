// Tests for the screenshot importer's pixel logic, on synthetic images that
// mimic swgoh.gg's counters list (no real screenshots in the repo - those
// are swgoh.gg's content). Set SAMPLE_SCREENSHOT=path.png to also run
// against a real one locally.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { detectRows } from "./layout.mjs";
import { fingerprint, similarity, identify, groupFaces, SAME_FACE } from "./faces.mjs";
import { prepareNumberImage, parseCount, parsePercent, parseBanners } from "./numbers.mjs";

const PAGE = [5, 14, 34];
const BUBBLE = [21, 33, 59];

function blank(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...color, 255], i * 4);
  return { width, height, data };
}

function fillRect(img, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.data.set([...color, 255], (y * img.width + x) * 4);
}

// A "face": a colored ring around a pattern unique to `seed`.
function drawPortrait(img, cx, cy, r, seed, ringColor = [200, 40, 40], empty = false) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      let color;
      if (d > r - 3) color = empty ? [51, 51, 51] : ringColor;
      else if (empty) color = [17, 17, 17];
      else {
        const u = (x - cx) / r;
        const v = (y - cy) / r;
        color = [
          128 + 120 * Math.sin(seed * 1.7 + u * (3 + seed)),
          128 + 120 * Math.cos(seed * 2.3 + v * (2 + seed)),
          128 + 120 * Math.sin(seed * 0.9 + (u + v) * 4),
        ].map((c) => Math.max(0, Math.min(255, Math.round(c))));
      }
      img.data.set([...color, 255], (y * img.width + x) * 4);
    }
  }
}

// One swgoh.gg-like row: 5 attackers, 3 number blocks, 5 defenders.
function drawRow(img, top, left, right) {
  fillRect(img, 4, top, img.width - 8, 72, BUBBLE);
  const cy = top + 36;
  const drawSquad = (x0, seeds) =>
    seeds.forEach((seed, i) => {
      const r = i === 0 ? 24 : 20;
      const cx = i === 0 ? x0 : x0 + 52 + (i - 1) * 48;
      drawPortrait(img, cx, cy, r, seed ?? 0, i === 0 ? [40, 120, 220] : [200, 40, 40], seed == null);
    });
  drawSquad(60, left);
  [300, 400, 500].forEach((x) => fillRect(img, x, cy + 2, 30, 11, [235, 240, 245]));
  drawSquad(640, right);
}

function sampleImage() {
  const img = blank(900, 4 * 76 + 4, PAGE);
  drawRow(img, 2, [1, 2, 3, 4, 5], [9, 10, 11, 12, 13]);
  drawRow(img, 78, [6, 7, null, null, null], [9, 10, 11, 12, 14]);
  drawRow(img, 154, [1, 3, 2, 4, 5], [9, 10, 11, 12, 13]);
  // Face 3 leads here (big) but is a member (small) in rows 1 and 3.
  drawRow(img, 230, [3, 1, 2, 4, 5], [9, 10, 11, 12, 13]);
  return img;
}

test("finds every row, both squads, empty slots and the three numbers", () => {
  const rows = detectRows(sampleImage());
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.left.length, 5);
    assert.equal(row.right.length, 5);
    assert.equal(row.stats.length, 3);
    assert.ok(row.left[0].r > row.left[1].r, "leader is drawn bigger");
  }
  assert.deepEqual(rows[1].left.map((s) => s.empty), [false, false, true, true, true]);
  assert.deepEqual(rows[0].left.map((s) => s.empty), [false, false, false, false, false]);
});

test("same face matches across rows and sizes; different faces don't", () => {
  const img = sampleImage();
  const rows = detectRows(img);
  const fp = (row, side, i) => {
    const s = rows[row][side][i];
    return fingerprint(img, s.cx, s.cy, s.r);
  };
  // Face 3 is a member in row 1 and a member in another slot in row 3.
  assert.ok(similarity(fp(0, "left", 2), fp(2, "left", 1)) >= SAME_FACE);
  // Face 1 is the leader (bigger) in rows 1 and 3.
  assert.ok(similarity(fp(0, "left", 0), fp(2, "left", 0)) >= SAME_FACE);
  // Face 3 as a leader (row 4) vs as a member (row 1): different sizes.
  assert.ok(similarity(fp(3, "left", 0), fp(0, "left", 2)) >= SAME_FACE);
  assert.ok(similarity(fp(3, "left", 1), fp(0, "left", 0)) >= SAME_FACE);
  // Different faces stay apart.
  assert.ok(similarity(fp(0, "left", 0), fp(0, "left", 1)) < SAME_FACE);
  assert.ok(similarity(fp(0, "right", 4), fp(1, "right", 4)) < SAME_FACE);

  const library = [{ unit_id: 42, fingerprint: fp(0, "left", 1) }];
  assert.equal(identify(fp(2, "left", 2), library).unitId, 42);
  assert.equal(identify(fp(0, "left", 3), library).unitId, null);

  const all = [fp(0, "left", 0), fp(0, "left", 1), fp(2, "left", 0), fp(2, "left", 2)];
  assert.deepEqual(groupFaces(all), [[0, 2], [1, 3]]);
});

test("number images are dark text on white, scaled up", () => {
  const img = sampleImage();
  const box = detectRows(img)[0].stats[0];
  const prepared = prepareNumberImage(img, box);
  assert.ok(prepared.width >= (box.x1 - box.x0 + 1) * 4);
  const values = new Set();
  for (let i = 0; i < prepared.data.length; i += 4) values.add(prepared.data[i]);
  assert.deepEqual([...values].sort((a, b) => a - b), [0, 255]);
  // The corner is background -> white.
  assert.equal(prepared.data[0], 255);
});

test("parses what the OCR reads", () => {
  assert.equal(parseCount("153"), 153);
  assert.equal(parseCount("4,096"), 4096);
  assert.equal(parseCount("4.1K"), 4100);
  assert.equal(parseCount("1O3"), 103, "O read as zero");
  assert.equal(parseCount(""), null);
  assert.equal(parsePercent("100%"), 100);
  assert.equal(parsePercent("87.5%"), 87.5);
  assert.equal(parsePercent("187%"), null);
  assert.equal(parseBanners("64.97"), 64.97);
  assert.equal(parseBanners("64,8"), 64.8);
  assert.equal(parseBanners("abc"), null);
});

// Optional: a real swgoh.gg screenshot kept outside the repo.
const sample = process.env.SAMPLE_SCREENSHOT;
test("real screenshot (SAMPLE_SCREENSHOT)", { skip: !sample || !existsSync(sample) }, () => {
  // pngjs lives in the frontend (or backend) node_modules - resolve it from
  // wherever the tests are run.
  const require = createRequire(process.cwd() + "/package.json");
  const { PNG } = require("pngjs");
  const img = PNG.sync.read(readFileSync(sample));
  const rows = detectRows(img);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.left.length, 5);
    assert.equal(row.right.length, 5);
    assert.equal(row.stats.length, 3);
  }
});
