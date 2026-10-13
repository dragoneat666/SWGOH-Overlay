// The relic badge under an in-game portrait (GAC map): blue (light side),
// red (dark side) or gold (Galactic Legend with its ultimate) with the relic
// level in white. Units without relics show their level (85...) instead, in
// pale grey - not white - so it doesn't count as a relic number here.
//
// This turns the badge into a clean picture of the number for a text reader
// (tesseract, backend/src/badgeReader.js). Pure pixel math on
// { width, height, data } RGBA images, like the rest of shared/scan.

// Where the number sits, in portrait radii from the portrait center.
export const NUMBER_BOX = { x0: -0.3, x1: 0.3, y0: 0.62, y1: 1.06 };
// The game's digits are tall and narrow; a text reader gets them right once
// they're stretched to ordinary proportions (5 reads as 9, 7 as 1 otherwise).
const STRETCH = 2;
const SCALE = 4;
const PAD = 20;

function sample(img, x, y, c) {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const at = (xx, yy) => img.data[(yy * img.width + xx) * 4 + c];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/** 0..1: how much a pixel looks like the white badge digits (bright, unsaturated). */
export function whiteness(r, g, b) {
  const mn = Math.min(r, g, b);
  const mx = Math.max(r, g, b);
  return Math.max(0, Math.min(1, (mn - 110) / 90)) * Math.max(0, Math.min(1, (90 - (mx - mn)) / 50));
}

/**
 * The relic number of the portrait at slot { cx, cy, r }, as a dark-on-white
 * RGBA image ready for a text reader, plus `ink`: the share of the box that
 * is digit (about 0.1-0.3 for a relic number; near 0 when there's none).
 */
export function relicNumberImage(img, slot) {
  const x0 = slot.cx + NUMBER_BOX.x0 * slot.r;
  const y0 = slot.cy + NUMBER_BOX.y0 * slot.r;
  const w = (NUMBER_BOX.x1 - NUMBER_BOX.x0) * slot.r;
  const h = (NUMBER_BOX.y1 - NUMBER_BOX.y0) * slot.r;
  const W = Math.round(w * SCALE * STRETCH);
  const H = Math.round(h * SCALE);
  const width = W + 2 * PAD;
  const height = H + 2 * PAD;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let ink = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x0 + x / (SCALE * STRETCH);
      const sy = y0 + y / SCALE;
      const v = whiteness(sample(img, sx, sy, 0), sample(img, sx, sy, 1), sample(img, sx, sy, 2));
      ink += v;
      const o = ((y + PAD) * width + x + PAD) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(255 * (1 - v));
    }
  }
  return { width, height, data, ink: ink / (W * H) };
}

/** Text read from the badge -> relic level 1-10, or null if it isn't one. */
export function parseRelic(text) {
  const digits = String(text || "").replace(/\s+/g, "");
  if (!/^\d{1,2}$/.test(digits)) return null;
  const n = Number(digits);
  return n >= 1 && n <= 10 ? n : null;
}
