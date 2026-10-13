// Reads the relic level off in-game portraits (the number on the badge under
// each portrait) with tesseract.js. The badge is turned into a clean picture
// of the number first (shared/scan/badges.mjs); the OCR engine starts on the
// first scan and is reused after that.
const path = require("path");
const { PNG } = require("pngjs");
const { createWorker, PSM } = require("tesseract.js");

// Below this share of white "ink" in the number box there's no relic number
// (units without relics show their level in pale grey; measured: relic
// numbers ~0.05-0.09, level badges ~0.005).
const MIN_INK = 0.02;

let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    const langDir = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
    workerPromise = createWorker("eng", 1, { langPath: langDir, gzip: true, cacheMethod: "none", logger: () => {} })
      .then(async (worker) => {
        await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: PSM.SINGLE_LINE });
        return worker;
      })
      .catch((err) => {
        workerPromise = null;
        throw err;
      });
  }
  return workerPromise;
}

function toPng({ width, height, data }) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  return PNG.sync.write(png);
}

/**
 * Relic level (1-10) of each portrait in `slots`, or null where there's no
 * relic number or it can't be read. Never throws - an unreadable badge just
 * means "level unknown".
 */
async function readRelics(img, slots, badges) {
  const out = [];
  let worker = null;
  for (const slot of slots) {
    const picture = badges.relicNumberImage(img, slot);
    if (picture.ink < MIN_INK) {
      out.push(null);
      continue;
    }
    try {
      worker = worker || (await getWorker());
      const { data } = await worker.recognize(toPng(picture));
      out.push(badges.parseRelic(data.text));
    } catch (err) {
      console.warn(`Couldn't read a relic badge: ${err.message}`);
      out.push(null);
    }
  }
  return out;
}

async function stopBadgeReader() {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  if (worker) await worker.terminate();
}

module.exports = { readRelics, stopBadgeReader };
