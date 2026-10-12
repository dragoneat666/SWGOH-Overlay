// Copies the OCR engine (tesseract.js worker + WebAssembly core + English
// data) into public/ocr/ so the screenshot importer is served entirely by
// your own server - no CDN, works over Netbird with no internet. Runs
// before `npm run dev` / `npm run build`; the output is git-ignored.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = path.join(root, "node_modules");
const out = path.join(root, "public", "ocr");
mkdirSync(out, { recursive: true });

const files = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  // Only the LSTM builds - the importer runs the LSTM engine. The worker
  // picks one of these three depending on what the browser supports.
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
];

for (const [from, to] of files) {
  const src = path.join(modules, from);
  if (!existsSync(src)) {
    console.error(`OCR asset missing: ${src} - run npm install`);
    process.exit(1);
  }
  copyFileSync(src, path.join(out, to));
}
console.log(`OCR assets copied to ${path.relative(root, out)}`);
