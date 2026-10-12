// Synthetic test images (tests only). Real screenshots stay out of the repo
// (it's public; they're game/site content).

export function blank(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...color, 255], i * 4);
  return { width, height, data };
}

export function fillRect(img, x0, y0, w, h, color) {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) img.data.set([...color, 255], (y * img.width + x) * 4);
  }
}

/** A recognizable "face" pattern unique to `seed`, filling a disk. */
export function drawFace(img, cx, cy, radius, seed, dim = 1) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      const u = (x - cx) / radius;
      const v = (y - cy) / radius;
      const color = [
        128 + 120 * Math.sin(seed * 1.7 + u * (3 + seed)),
        128 + 120 * Math.cos(seed * 2.3 + v * (2 + seed)),
        128 + 120 * Math.sin(seed * 0.9 + (u + v) * 4),
      ].map((c) => Math.max(0, Math.min(255, Math.round(c * dim))));
      img.data.set([...color, 255], (y * img.width + x) * 4);
    }
  }
}

function fillDisk(img, cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (Math.hypot(x - cx, y - cy) <= radius) img.data.set([...color, 255], (y * img.width + x) * 4);
    }
  }
}

// In-game badges over the bottom of a portrait, like the real ones: the
// gear/relic badge at the bottom, zetas lower left, omicrons lower right.
// [x, y, radius] in portrait radii from its center, and a color.
const BADGES = {
  gear: [[0, 0.75, 0.28, [40, 90, 160]]],
  relic: [[0, 0.75, 0.3, [200, 160, 40]], [-0.72, 0.6, 0.27, [120, 40, 170]]],
  maxed: [[0, 0.75, 0.3, [190, 40, 40]], [-0.72, 0.6, 0.27, [120, 40, 170]], [0.72, 0.6, 0.27, [150, 150, 150]]],
};

/** Draws one of the BADGES sets ("gear", "relic", "maxed") on a portrait. */
export function drawBadges(img, cx, cy, r, kind) {
  for (const [x, y, radius, color] of BADGES[kind]) fillDisk(img, cx + x * r, cy + y * r, radius * r, color);
}

function drawRing(img, cx, cy, outer, inner, color) {
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= outer && d >= inner) img.data.set([...color, 255], (y * img.width + x) * 4);
    }
  }
}

/**
 * An in-game GAC territory screen at half phone resolution (1202x540):
 * one panel per entry of `squads` = [{ seeds: [5 face seeds], lit, badges }]
 * (badges: optional drawBadges kind for every portrait in the squad).
 * Geometry matches the real screen's proportions (panel 140 px tall,
 * portraits ~97.5 px apart).
 * Returns { img, faces: [[{ cx, cy }]] } with each squad's face centers.
 */
export function gacScreen(squads) {
  const img = blank(1202, 540, [20, 22, 24]);
  const faces = [];
  squads.forEach((squad, si) => {
    const top = 119 + si * 146;
    const h = 140;
    fillRect(img, 105, top, 983, h, [15, 30, 56]);
    const pitch = 97.5;
    const cy = top + pitch * (155 / 195);
    const centers = [];
    squad.seeds.forEach((seed, k) => {
      const cx = 151 + k * pitch;
      const dim = squad.lit ? 1 : 0.45;
      drawRing(img, cx, cy, 33.5, 29, squad.lit ? [90, 170, 255] : [45, 85, 128]);
      drawFace(img, cx, cy, 28, seed, dim);
      // Portrait radius as the detector measures it (shared/scan/gac.mjs).
      if (squad.badges) drawBadges(img, cx, cy, pitch * (50 / 195), squad.badges);
      // Star row under the portrait: bright yellow when lit, dull when beaten.
      fillRect(img, Math.round(cx - 27), Math.round(top + h * 0.8), 55, 6, squad.lit ? [255, 210, 40] : [110, 100, 50]);
      centers.push({ cx, cy });
    });
    faces.push(centers);
  });
  return { img, faces };
}
