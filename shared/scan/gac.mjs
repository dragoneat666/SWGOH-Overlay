// Finds enemy squads on the in-game GAC territory screen ("ENEMY SQUADS
// n/m": one panel per defending squad, "Power: ... / Battles: ..." on
// top, portraits in a row, stars and a bar under each).
//
// Pure pixel code on { width, height, data } RGBA - the server runs it on
// screenshots sent by the phone. Calibrated on 2404x1080 phone screenshots;
// everything is measured relative to the panels, so other resolutions
// scale.
//
//   - Panels: rows where most of the screen is the panels' dark blue.
//   - Portraits: the content columns inside a panel's portrait band. Each
//     portrait's ring (+glow) is the same width, which sets the scale.
//   - Lit vs beaten: a squad that's still standing has bright yellow stars
//     under its portraits; beaten squads are dimmed (stars too). Only lit
//     squads are reported as targets.
//   - Face: the portrait art sits a bit above the ring's middle. The
//     fingerprint radius (faces.mjs keeps the inner 70% of it) stays clear
//     of the relic/gear number at the bottom and the zeta/omicron and
//     datacron badges at the lower corners.

// Ratios measured on real screenshots: portraits are 195 px apart
// (center to center), the face center is 155 px below the panel's top
// edge, and the matching radius is 50 px. Spacing sets the scale because
// it's the same for every ring color - the red (dark side) ring glow is
// wider than the blue one, so column width isn't.
const FACE_CY_PER_PITCH = 155 / 195;
const FACE_R_PER_PITCH = 50 / 195;
// Spacing relative to panel height, for a squad with a single portrait.
const PITCH_PER_PANEL_H = 195 / 279;

function lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function pixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** The dark blue inside a squad panel (lit or dimmed). */
export function isPanelBlue([r, g, b]) {
  return b >= 40 && b > r + 20 && b > g + 10 && lum(r, g, b) < 90;
}

/** A lit star: saturated yellow. Beaten squads' stars are a dull olive. */
export function isLitStar([r, g, b]) {
  return r > 150 && g > 110 && b < 90 && r - b > 90;
}

/** Vertical bands where at least half of the middle of the screen is panel-blue. */
export function findPanels(img) {
  const x0 = Math.round(img.width * 0.1);
  const x1 = Math.round(img.width * 0.9);
  const step = Math.max(1, Math.round(img.width / 600));
  const bands = [];
  let start = -1;
  for (let y = 0; y <= img.height; y++) {
    let on = false;
    if (y < img.height) {
      let n = 0;
      let t = 0;
      for (let x = x0; x < x1; x += step) {
        t++;
        if (isPanelBlue(pixel(img, x, y))) n++;
      }
      on = n / t > 0.5;
    }
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      if (y - start >= img.height * 0.12) bands.push({ top: start, bottom: y - 1 });
      start = -1;
    }
  }
  return bands;
}

function panelEdges(img, top, bottom) {
  const midY = Math.round((top + bottom) / 2);
  let left = 0;
  while (left < img.width - 1 && !isPanelBlue(pixel(img, left, midY))) left++;
  let right = img.width - 1;
  while (right > left && !isPanelBlue(pixel(img, right, midY))) right--;
  return { left, right };
}

/**
 * Every squad panel on screen:
 *   [{ top, bottom, lit, slots: [{ cx, cy, r }] }]
 * slots are left to right (leader first). Use faces.mjs fingerprint(img,
 * cx, cy, r) on each slot.
 */
export function detectGacSquads(img) {
  const squads = [];
  for (const { top, bottom } of findPanels(img)) {
    const h = bottom - top + 1;
    const { left, right } = panelEdges(img, top, bottom);
    const zoneTop = Math.round(top + h * 0.3);
    const zoneBottom = Math.round(top + h * 0.72);

    // Content columns (anything not panel-blue) in the portrait band.
    const hasContent = (x) => {
      let n = 0;
      for (let y = zoneTop; y <= zoneBottom; y++) if (!isPanelBlue(pixel(img, x, y))) n++;
      return n > 3;
    };
    const runs = [];
    let rs = -1;
    let last = -1;
    const maxGap = Math.max(4, Math.round(h * 0.04));
    for (let x = left; x <= right; x++) {
      if (!hasContent(x)) continue;
      if (rs < 0) rs = x;
      else if (x - last > maxGap) {
        runs.push([rs, last]);
        rs = x;
      }
      last = x;
    }
    if (rs >= 0) runs.push([rs, last]);

    // Portrait columns are about half the panel height wide.
    const columns = runs.filter(([a, b]) => {
      const w = b - a + 1;
      return w > h * 0.35 && w < h * 0.65;
    });
    if (columns.length === 0) continue;

    const widths = columns.map(([a, b]) => b - a + 1).sort((p, q) => p - q);
    const w = widths[Math.floor(widths.length / 2)];
    const centers = columns.map(([a, b]) => (a + b) / 2);
    const gaps = centers.slice(1).map((c, i) => c - centers[i]).sort((p, q) => p - q);
    const pitch = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : h * PITCH_PER_PANEL_H;

    // Lit check: bright stars under the portraits.
    const starTop = Math.round(top + h * 0.7);
    const starBottom = Math.min(img.height - 1, Math.round(top + h * 0.9));
    let litColumns = 0;
    for (const [a, b] of columns) {
      let stars = 0;
      for (let y = starTop; y <= starBottom; y++) for (let x = a; x <= b; x++) if (isLitStar(pixel(img, x, y))) stars++;
      if (stars > w * w * 0.02) litColumns++;
    }

    squads.push({
      top,
      bottom,
      lit: litColumns * 2 > columns.length,
      slots: centers.map((cx) => ({
        cx,
        cy: top + pitch * FACE_CY_PER_PITCH,
        r: pitch * FACE_R_PER_PITCH,
      })),
    });
  }
  return squads;
}
