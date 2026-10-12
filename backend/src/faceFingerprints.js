// Face recognition on the server: loads the shared pixel code (shared/scan,
// ES modules - the same code the web importer runs in the browser) and keeps
// stored fingerprints in step with it.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { PNG } = require("pngjs");
const db = require("./db");
const { uploadDir } = require("./config");

// /app/shared in the Docker image, <repo>/shared in a checkout.
const SHARED_DIRS = [
  path.join(__dirname, "..", "shared", "scan"),
  path.join(__dirname, "..", "..", "shared", "scan"),
];
let scanLib = null;
async function loadScanLib() {
  if (!scanLib) {
    const dir = SHARED_DIRS.find((d) => fs.existsSync(path.join(d, "gac.mjs")));
    if (!dir) throw new Error("shared/scan not found");
    const load = (f) => import(pathToFileURL(path.join(dir, f)).href);
    scanLib = { gac: await load("gac.mjs"), faces: await load("faces.mjs") };
  }
  return scanLib;
}

// How much of a stored picture is the portrait: pictures from overlay scans
// reach further past the ring than the web importer's swgoh.gg ones.
function ringScaleFor(source, faces) {
  return source === "gac screen" ? faces.RING_SCALE.game : faces.RING_SCALE.swgohgg;
}

/**
 * Recomputes, from their stored pictures, the fingerprints made by an older
 * version of the fingerprint code (they have a different length and would
 * never match anything). Runs at startup; a no-op once everything is current.
 */
async function refreshFingerprints() {
  const { faces } = await loadScanLib();
  let updated = 0;
  let failed = 0;
  for (const table of ["unit_portraits", "unidentified_portraits"]) {
    const { rows } = await db.query(
      `SELECT id, image_path, source FROM ${table} WHERE jsonb_array_length(fingerprint) <> $1`,
      [faces.LENGTH]
    );
    for (const row of rows) {
      try {
        const picture = PNG.sync.read(fs.readFileSync(path.join(uploadDir, path.basename(row.image_path))));
        const fingerprint = faces.pictureFingerprint(picture, ringScaleFor(row.source, faces));
        await db.query(`UPDATE ${table} SET fingerprint = $1 WHERE id = $2`, [JSON.stringify(fingerprint), row.id]);
        updated++;
      } catch (err) {
        failed++;
        console.warn(`Couldn't update the fingerprint of ${table} #${row.id} (${row.image_path}): ${err.message}`);
      }
    }
  }
  if (updated || failed) {
    console.log(`Face fingerprints updated: ${updated}${failed ? `, ${failed} failed` : ""}`);
  }
  return { updated, failed };
}

module.exports = { loadScanLib, ringScaleFor, refreshFingerprints };
