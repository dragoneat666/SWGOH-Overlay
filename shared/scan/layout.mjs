// Finds squads in a screenshot of a swgoh.gg GAC counters list.
//
// Works on a plain RGBA image ({ width, height, data }) with no canvas, so
// the exact same code runs in the browser, in Node tests, and can be ported
// to the Android app for in-game screen reading later.
//
// Layout it expects (one "bubble" per row):
//   [5 attacker portraits]  Seen / Win % / Avg ⚑  [5 defender portraits]
// Empty squad slots are dark circles. Rows are found from the gaps between
// bubbles; portraits are the square, full-height blobs in a row; the stats
// are the three text columns between the two portrait groups.

/** Pixel accessor helpers. */
function rgbAt(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function colorDistance(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function bucketColors(img, pixels, count) {
  const buckets = new Map();
  for (const [x, y] of pixels) {
    const [r, g, b] = rgbAt(img, x, y);
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = buckets.get(key);
    if (e) {
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((e) => [e.r / e.n, e.g / e.n, e.b / e.n]);
}

/**
 * Background colors: the most common color overall (the row "bubble") plus
 * the common colors along the image edges (the page between bubbles).
 * Edges never cut through portraits in a sensible crop, whereas the black
 * backdrop inside portraits can rival the page color in raw counts - so
 * it's the edges, not a global top-N, that say what "page" looks like.
 */
export function backgroundColors(img) {
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 200000)));
  const all = [];
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) all.push([x, y]);
  const edge = [];
  for (let x = 0; x < img.width; x++) edge.push([x, 0], [x, img.height - 1]);
  for (let y = 0; y < img.height; y++) edge.push([0, y], [img.width - 1, y]);

  const colors = [];
  for (const c of [...bucketColors(img, all, 1), ...bucketColors(img, edge, 3)]) {
    if (colors.every((k) => colorDistance(k, c) > 12)) colors.push(c);
  }
  return colors;
}

/** The most common colors (by 5-bit buckets), averaged. */
export function dominantColors(img, count = 2) {
  const pixels = [];
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 200000)));
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) pixels.push([x, y]);
  }
  return bucketColors(img, pixels, count);
}

/** Boolean "is this pixel content (not background)" mask. */
export function contentMask(img, backgrounds = backgroundColors(img), threshold = 45) {
  const mask = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = rgbAt(img, x, y);
      let near = false;
      for (const bg of backgrounds) {
        if (colorDistance(c, bg) <= threshold) {
          near = true;
          break;
        }
      }
      if (!near) mask[y * img.width + x] = 1;
    }
  }
  return mask;
}

/** Runs of indexes where pred(i) is true, merging gaps up to maxGap. */
export function runs(length, pred, maxGap = 0) {
  const out = [];
  let start = -1;
  let lastOn = -1;
  for (let i = 0; i < length; i++) {
    if (pred(i)) {
      if (start === -1) start = i;
      else if (i - lastOn - 1 > maxGap) {
        out.push([start, lastOn]);
        start = i;
      }
      lastOn = i;
    }
  }
  if (start !== -1) out.push([start, lastOn]);
  return out;
}

/** Horizontal bands of content = one per squad row. */
export function findRowBands(img, mask) {
  const minPixels = Math.max(3, Math.round(img.width * 0.01));
  const rowCounts = new Array(img.height).fill(0);
  for (let y = 0; y < img.height; y++) {
    let n = 0;
    for (let x = 0; x < img.width; x++) n += mask[y * img.width + x];
    rowCounts[y] = n;
  }
  const bands = runs(img.height, (y) => rowCounts[y] >= minPixels, 2);
  // Portraits are the tallest thing in a row; drop slivers (borders, noise).
  const tallest = Math.max(0, ...bands.map(([a, b]) => b - a + 1));
  return bands.filter(([a, b]) => b - a + 1 >= Math.max(16, tallest * 0.6));
}

function verticalExtent(img, mask, x0, x1, y0, y1) {
  let top = -1;
  let bottom = -1;
  for (let y = y0; y <= y1; y++) {
    let any = false;
    for (let x = x0; x <= x1 && !any; x++) any = mask[y * img.width + x] === 1;
    if (any) {
      if (top === -1) top = y;
      bottom = y;
    }
  }
  return [top, bottom];
}

/** Content segments stacked vertically inside a column range (label, number). */
function verticalSegments(img, mask, x0, x1, y0, y1) {
  return runs(
    y1 - y0 + 1,
    (i) => {
      const y = y0 + i;
      for (let x = x0; x <= x1; x++) if (mask[y * img.width + x]) return true;
      return false;
    },
    1
  ).map(([a, b]) => [y0 + a, y0 + b]);
}

/** Mean luminance and its spread inside a circle (empty slot detection). */
export function circleStats(img, cx, cy, radius) {
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const [r, g, b] = rgbAt(img, x, y);
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      n++;
      sum += l;
      sumSq += l * l;
    }
  }
  const mean = n ? sum / n : 0;
  return { mean, std: n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0 };
}

/**
 * Detects every row. Returns
 *   [{ box: {y0, y1}, left: [slot], right: [slot], stats: [box, box, box] }]
 * where slot = { cx, cy, r, empty } and stats boxes are the number (not
 * label) areas of Seen / Win % / Avg in reading order.
 */
export function detectRows(img) {
  const mask = contentMask(img);
  const rows = [];

  for (const [y0, y1] of findRowBands(img, mask)) {
    const bandH = y1 - y0 + 1;
    const colCount = (x) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) n += mask[y * img.width + x];
      return n;
    };
    const blobs = runs(img.width, (x) => colCount(x) > 0, Math.max(2, Math.round(bandH * 0.12))).map(
      ([x0, x1]) => {
        const [top, bottom] = verticalExtent(img, mask, x0, x1, y0, y1);
        return { x0, x1, top, bottom, w: x1 - x0 + 1, h: bottom - top + 1 };
      }
    );

    // Portraits: about as wide as tall, and most of the band height (the
    // leader is drawn ~20% bigger than the rest of the squad).
    const isPortrait = (b) => b.h >= bandH * 0.7 && b.w / b.h > 0.8 && b.w / b.h < 1.25;
    const portraits = blobs.filter(isPortrait);
    if (portraits.length < 2) continue;

    // Split into the two squads at the widest gap between portraits.
    let splitAt = 1;
    let widest = -1;
    for (let i = 1; i < portraits.length; i++) {
      const gap = portraits[i].x0 - portraits[i - 1].x1;
      if (gap > widest) {
        widest = gap;
        splitAt = i;
      }
    }
    const toSlot = (b) => {
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.top + b.bottom) / 2;
      const r = Math.min(b.w, b.h) / 2;
      const inner = circleStats(img, cx, cy, r * 0.6);
      return { cx, cy, r, empty: inner.mean < 32 && inner.std < 10 };
    };
    const leftGroup = portraits.slice(0, splitAt);
    const rightGroup = portraits.slice(splitAt);

    // Stats: text blobs between the two groups, number = bottom segment.
    const midStart = leftGroup[leftGroup.length - 1].x1;
    const midEnd = rightGroup[0].x0;
    const textBlobs = blobs.filter((b) => b.x0 > midStart && b.x1 < midEnd && !isPortrait(b));
    const stats = textBlobs.map((b) => {
      const segs = verticalSegments(img, mask, b.x0, b.x1, y0, y1);
      const [ny0, ny1] = segs[segs.length - 1];
      const [label0, label1] = segs.length > 1 ? segs[0] : [ny0, ny0 - 1];
      return {
        x0: b.x0,
        x1: b.x1,
        y0: ny0,
        y1: ny1,
        label: label1 >= label0 ? { y0: label0, y1: label1 } : null,
      };
    });

    rows.push({
      box: { y0, y1 },
      left: leftGroup.map(toSlot),
      right: rightGroup.map(toSlot),
      stats,
    });
  }
  return rows;
}
