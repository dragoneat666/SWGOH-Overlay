// Portrait "fingerprints" for recognizing units, plus grouping of unknown
// faces so the same face is only asked about once.
//
// Fingerprint: the inside of the portrait circle (ring excluded - its color
// shows gear/relic/alignment, not who the unit is) down to just below the
// center (the in-game level/relic/zeta/omicron badges cover the bottom),
// resampled to a 16x16 grid, masked to that area, as RGB values normalized
// to zero mean / unit length.
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
// Lowest part kept, as a fraction of the radius below the center. In game
// the gear/relic badge, zetas and omicrons sit over the bottom of the
// portrait (from ~0.3 r down) and change as the unit is upgraded, so only
// the part above that identifies the unit - one saved face per unit then
// covers every relic level.
export const CUT = 0.2;
/** Size (px) of the stored face pictures - fingerprints are taken from them. */
export const PICTURE_SIZE = 72;
// How far around the portrait center the pictures reach, in radii: game
// pictures (overlay scans) include the ring and a little glow, swgoh.gg
// pictures (web importer) stop at the ring.
export const RING_SCALE = { game: 1.3, swgohgg: 1 };
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

/** Grid cells that are used (same for every fingerprint): inside the
 * circle and no lower than CUT. */
const MASK = (() => {
  const cells = [];
  const c = (GRID - 1) / 2;
  for (let gy = 0; gy < GRID; gy++) {
    // Cell center's distance below the portrait center, in radii.
    const below = ((gy + 0.5) * 2 / GRID - 1) * INNER;
    if (below > CUT) continue;
    for (let gx = 0; gx < GRID; gx++) {
      if ((gx - c) ** 2 + (gy - c) ** 2 <= (GRID / 2) ** 2) cells.push([gx, gy]);
    }
  }
  return cells;
})();

/** Numbers in a fingerprint. Stored fingerprints of another length were
 * made by an older version and are recomputed from their pictures. */
export const LENGTH = MASK.length * 3;

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

/**
 * The portrait centered at (cx, cy), outer radius r, as a PICTURE_SIZE
 * square covering ringScale * r around the center. Each picture pixel is
 * the average of the screenshot pixels under it (a plain resize would skip
 * pixels and make fingerprints jumpy).
 */
export function facePicture(img, cx, cy, r, ringScale) {
  const size = PICTURE_SIZE;
  const half = r * ringScale;
  const step = (2 * half) / size;
  const data = new Uint8ClampedArray(size * size * 4);
  const clampX = (x) => Math.max(0, Math.min(img.width - 1, x));
  const clampY = (y) => Math.max(0, Math.min(img.height - 1, y));
  for (let y = 0; y < size; y++) {
    const y0 = cy - half + y * step;
    for (let x = 0; x < size; x++) {
      const x0 = cx - half + x * step;
      const sum = [0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y0); yy < y0 + step; yy++) {
        for (let xx = Math.floor(x0); xx < x0 + step; xx++) {
          const i = (clampY(yy) * img.width + clampX(xx)) * 4;
          sum[0] += img.data[i];
          sum[1] += img.data[i + 1];
          sum[2] += img.data[i + 2];
          n++;
        }
      }
      const o = (y * size + x) * 4;
      data[o] = Math.round(sum[0] / n);
      data[o + 1] = Math.round(sum[1] / n);
      data[o + 2] = Math.round(sum[2] / n);
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Fingerprint of a face picture (facePicture, or a stored one decoded). */
export function pictureFingerprint(picture, ringScale) {
  const c = picture.width / 2;
  return fingerprint(picture, c, c, c / ringScale);
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
