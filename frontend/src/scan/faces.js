// Portrait "fingerprints" for recognizing units, plus grouping of unknown
// faces so the same face is only asked about once.
//
// Fingerprint: the inside of the portrait circle (ring excluded - its color
// shows gear/relic/alignment, not who the unit is), resampled to a 16x16
// grid, circle-masked, as RGB values normalized to zero mean / unit length.
// Two faces compare by dot product (cosine similarity, 1 = identical). The
// normalization makes it tolerant of brightness/contrast differences
// between sources; resampling relative to the circle size makes it
// tolerant of scale (leader portraits are drawn bigger than members).
//
// Pure math on { width, height, data } RGBA images - no canvas - so the
// same numbers come out in the browser, in tests, and (ported) on Android.

export const GRID = 16;
// Fraction of the portrait radius kept: inside the colored ring and the
// dark shadow just inside it.
export const INNER = 0.7;
/** Cosine similarity at or above which two faces are the same unit. */
export const SAME_FACE = 0.9;

function sample(img, x, y, c) {
  // Bilinear sample of channel c at a fractional position, clamped to the image.
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const at = (xx, yy) => img.data[(yy * img.width + xx) * 4 + c];
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Grid cells that fall inside the circle (same for every fingerprint). */
const MASK = (() => {
  const cells = [];
  const c = (GRID - 1) / 2;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      if ((gx - c) ** 2 + (gy - c) ** 2 <= (GRID / 2) ** 2) cells.push([gx, gy]);
    }
  }
  return cells;
})();

/**
 * Fingerprint of the portrait centered at (cx, cy) with outer radius r.
 * Each grid cell averages a 3x3 set of bilinear samples so small
 * misalignments don't matter.
 */
export function fingerprint(img, cx, cy, r) {
  const ri = r * INNER;
  const cell = (2 * ri) / GRID;
  const values = [];
  for (const [gx, gy] of MASK) {
    const baseX = cx - ri + (gx + 0.5) * cell;
    const baseY = cy - ri + (gy + 0.5) * cell;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (const dy of [-1 / 3, 0, 1 / 3]) {
        for (const dx of [-1 / 3, 0, 1 / 3]) sum += sample(img, baseX + dx * cell, baseY + dy * cell, c);
      }
      values.push(sum / 9);
    }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let norm = 0;
  for (let i = 0; i < values.length; i++) {
    values[i] -= mean;
    norm += values[i] * values[i];
  }
  norm = Math.sqrt(norm) || 1;
  // Rounded so fingerprints stay compact when stored as JSON.
  return values.map((v) => Math.round((v / norm) * 10000) / 10000);
}

export function similarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Best library match for a fingerprint.
 * library: [{ unit_id, fingerprint }] (several entries per unit are fine).
 * Returns { unitId, score } - unitId null when nothing is close enough.
 */
export function identify(fp, library, threshold = SAME_FACE) {
  let best = null;
  let bestScore = -1;
  for (const entry of library) {
    const s = similarity(fp, entry.fingerprint);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }
  return bestScore >= threshold && best ? { unitId: best.unit_id, score: bestScore } : { unitId: null, score: bestScore };
}

/**
 * Groups fingerprints that are the same face (greedy: each joins the first
 * group whose first member it matches). Returns arrays of input indexes.
 */
export function groupFaces(fps, threshold = SAME_FACE) {
  const groups = [];
  fps.forEach((fp, i) => {
    const g = groups.find((grp) => similarity(fps[grp[0]], fp) >= threshold);
    if (g) g.push(i);
    else groups.push([i]);
  });
  return groups;
}
