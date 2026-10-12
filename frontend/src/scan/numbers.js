// Turning the Seen / Win % / Avg banner numbers into values.
//
// prepareNumberImage() makes an OCR-friendly image from one number's box
// (pure pixels, works anywhere); parse*() clean up what the OCR read.

const SCALE = 4;
const PAD = 6; // px of margin (before scaling) - OCR dislikes text touching the edge

/**
 * Crops `box` ({x0, x1, y0, y1}) out of `img`, scales it up, and turns it
 * into dark text on white, thresholded - light-on-dark small text OCRs
 * badly as-is.
 */
export function prepareNumberImage(img, box) {
  const x0 = Math.max(0, box.x0 - PAD);
  const y0 = Math.max(0, box.y0 - PAD);
  const x1 = Math.min(img.width - 1, box.x1 + PAD);
  const y1 = Math.min(img.height - 1, box.y1 + PAD);
  const w = (x1 - x0 + 1) * SCALE;
  const h = (y1 - y0 + 1) * SCALE;
  const data = new Uint8ClampedArray(w * h * 4);

  // Luminance range of the crop decides the threshold (text vs background).
  let lo = 255;
  let hi = 0;
  const lum = (x, y) => {
    const i = (y * img.width + x) * 4;
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const l = lum(x, y);
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
  }
  const threshold = lo + (hi - lo) * 0.45;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Bilinear sample for smooth upscaled edges, then threshold.
      const sx = x0 + (x + 0.5) / SCALE - 0.5;
      const sy = y0 + (y + 0.5) / SCALE - 0.5;
      const ax = Math.max(x0, Math.min(x1, Math.floor(sx)));
      const ay = Math.max(y0, Math.min(y1, Math.floor(sy)));
      const bx = Math.min(x1, ax + 1);
      const by = Math.min(y1, ay + 1);
      const fx = Math.max(0, Math.min(1, sx - ax));
      const fy = Math.max(0, Math.min(1, sy - ay));
      const l =
        (lum(ax, ay) * (1 - fx) + lum(bx, ay) * fx) * (1 - fy) + (lum(ax, by) * (1 - fx) + lum(bx, by) * fx) * fy;
      const v = l >= threshold ? 0 : 255; // light text -> black
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Characters the OCR is allowed to output. */
export const NUMBER_CHARS = "0123456789.,%kKmM";

function clean(text) {
  return String(text || "").replace(/\s+/g, "").replace(/[Oo]/g, "0").replace(/[lI|]/g, "1");
}

/** "153" / "4,096" / "4.1K" -> 153 / 4096 / 4100. null if unreadable. */
export function parseCount(text) {
  const t = clean(text).replace(/,/g, "");
  const m = t.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2].toLowerCase() === "k" ? 1000 : m[2].toLowerCase() === "m" ? 1e6 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** "100%" / "87.5%" -> 100 / 87.5 (0-100). null if unreadable or out of range. */
export function parsePercent(text) {
  const t = clean(text).replace(/%$/, "").replace(/,/g, ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = parseFloat(t);
  return n >= 0 && n <= 100 ? n : null;
}

/** "64.97" -> 64.97. null if unreadable or implausible for GAC banners. */
export function parseBanners(text) {
  const t = clean(text).replace(/,/g, ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = parseFloat(t);
  return n >= 0 && n <= 100 ? n : null;
}
