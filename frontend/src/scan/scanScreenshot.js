// Browser side of the screenshot importer: image -> rows of faces + stats.
// The pixel work lives in shared/scan (pure, tested in Node); this file
// adds the canvas and OCR (tesseract.js) bits.
import { createWorker, PSM } from "tesseract.js";
import { detectRows } from "../../../shared/scan/layout.mjs";
import { facePicture, pictureFingerprint, RING_SCALE } from "../../../shared/scan/faces.mjs";
import { prepareNumberImage, NUMBER_CHARS, parseCount, parsePercent, parseBanners } from "../../../shared/scan/numbers.mjs";

// The OCR engine is served from our own server (scripts/copy-ocr-assets.mjs)
// and created once, on first use.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    const at = (p) => new URL(p, window.location.origin).href;
    workerPromise = createWorker("eng", 1, {
      workerPath: at("/ocr/worker.min.js"),
      corePath: at("/ocr/"),
      langPath: at("/ocr"),
      gzip: true,
    })
      .then(async (worker) => {
        await worker.setParameters({
          tessedit_char_whitelist: NUMBER_CHARS,
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
        });
        return worker;
      })
      .catch((err) => {
        workerPromise = null;
        throw err;
      });
  }
  return workerPromise;
}

async function toCanvas(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

function imageDataToCanvas({ width, height, data }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

/** A face: its picture (whole portrait, ring included) as a PNG for
 * display/storage, and the fingerprint of exactly that picture - the
 * server recomputes stored fingerprints from the same pictures. */
function face(img, s) {
  const picture = facePicture(img, s.cx, s.cy, s.r, RING_SCALE.swgohgg);
  return {
    empty: false,
    fingerprint: pictureFingerprint(picture, RING_SCALE.swgohgg),
    image: imageDataToCanvas(picture).toDataURL("image/png"),
  };
}

async function readNumber(worker, img, box, parse) {
  if (!box) return { value: null, text: "" };
  const { data } = await worker.recognize(imageDataToCanvas(prepareNumberImage(img, box)));
  const text = data.text.trim();
  return { value: parse(text), text };
}

/**
 * Scans a screenshot (File/Blob). onProgress(message) gets status updates.
 * Returns { rows: [{ left: [slot], right: [slot], stats }] } where
 *   slot  = { empty, fingerprint, image }
 *   stats = { seen_count, win_rate, avg_banners, raw: [texts] }
 */
export async function scanScreenshot(blob, onProgress = () => {}) {
  onProgress("Reading the image…");
  const canvas = await toCanvas(blob);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const detected = detectRows(img);
  if (detected.length === 0) return { rows: [] };

  const toSlot = (s) => (s.empty ? { empty: true } : face(img, s));

  onProgress("Loading the text reader (first time can take a few seconds)…");
  const worker = await getWorker();

  const rows = [];
  for (const [i, row] of detected.entries()) {
    onProgress(`Reading row ${i + 1} of ${detected.length}…`);
    const [seen, win, banners] = [
      await readNumber(worker, img, row.stats[0], parseCount),
      await readNumber(worker, img, row.stats[1], parsePercent),
      await readNumber(worker, img, row.stats[2], parseBanners),
    ];
    rows.push({
      left: row.left.map(toSlot),
      right: row.right.map(toSlot),
      stats: {
        seen_count: seen.value,
        win_rate: win.value,
        avg_banners: banners.value,
        raw: [seen.text, win.text, banners.text],
      },
    });
  }
  return { rows };
}
