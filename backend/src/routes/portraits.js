const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const asyncHandler = require("../asyncHandler");
const { uploadDir } = require("../config");
const { badRequest, notFound } = require("../httpError");

// Face recognition data for the screenshot importer (and later the
// overlay's screen reading). The browser does the image work - cropping
// portraits and computing fingerprints (frontend/src/scan/faces.js) - and
// this stores the results:
//   unit_portraits          faces we know the unit for
//   unidentified_portraits  faces waiting for someone to say who they are
const router = express.Router();

// Same cut-off as frontend/src/scan/faces.js SAME_FACE.
const SAME_FACE = 0.9;
const MAX_IMAGE_BYTES = 300 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function similarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function parseFingerprint(raw, label = "fingerprint") {
  if (!Array.isArray(raw) || raw.length < 100 || raw.length > 4000 || !raw.every((v) => Number.isFinite(v))) {
    throw badRequest(`${label} must be an array of numbers`);
  }
  return raw;
}

// "data:image/png;base64,..." -> saved PNG file name in uploads.
function saveImage(dataUrl, label = "image") {
  const m = typeof dataUrl === "string" && dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw badRequest(`${label} must be a PNG data URL`);
  const bytes = Buffer.from(m[1], "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw badRequest(`${label} is too large`);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw badRequest(`${label} is not a PNG`);
  const name = `face-${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(uploadDir, name), bytes);
  return name;
}

function removeFile(name) {
  if (!name) return;
  fs.promises.unlink(path.join(uploadDir, path.basename(name))).catch(() => {});
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

async function unitExists(queryable, unitId) {
  const { rows } = await queryable.query("SELECT id FROM units WHERE id = $1", [unitId]);
  return rows.length > 0;
}

// Adds a known face; also gives the unit its picture if it has none yet.
async function addKnownFace(client, { unitId, imagePath, fingerprint, source }) {
  const { rows } = await client.query(
    `INSERT INTO unit_portraits (unit_id, image_path, fingerprint, source)
     VALUES ($1, $2, $3, $4) RETURNING id, unit_id, image_path`,
    [unitId, imagePath, JSON.stringify(fingerprint), source || null]
  );
  await client.query(
    "UPDATE units SET image_path = $1, updated_at = now() WHERE id = $2 AND image_path IS NULL",
    [imagePath, unitId]
  );
  return rows[0];
}

// GET /api/portraits/library - every known face's fingerprint, for matching.
router.get("/library", asyncHandler(async (req, res) => {
  const { rows } = await db.query("SELECT id, unit_id, fingerprint FROM unit_portraits ORDER BY id");
  res.json(rows);
}));

// POST /api/portraits - "this face is that unit".
// body: { unit_id, image: "data:image/png;base64,...", fingerprint: [...], source }
router.post("/", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const unitId = Number(body.unit_id);
  const fingerprint = parseFingerprint(body.fingerprint);
  if (!Number.isInteger(unitId) || !(await unitExists(db, unitId))) throw badRequest("unit_id doesn't exist");
  const imagePath = saveImage(body.image);
  try {
    const face = await db.withTransaction((client) =>
      addKnownFace(client, { unitId, imagePath, fingerprint, source: body.source })
    );
    res.status(201).json(face);
  } catch (err) {
    removeFile(imagePath);
    throw err;
  }
}));

router.delete("/:id(\\d+)", asyncHandler(async (req, res) => {
  const { rows } = await db.query("DELETE FROM unit_portraits WHERE id = $1 RETURNING image_path", [
    parseId(req.params.id),
  ]);
  if (rows.length === 0) throw notFound();
  // Keep the file if a unit still uses it as its picture.
  const { rows: users } = await db.query("SELECT 1 FROM units WHERE image_path = $1", [rows[0].image_path]);
  if (users.length === 0) removeFile(rows[0].image_path);
  res.status(204).end();
}));

// GET /api/portraits/unidentified - the "To identify" queue.
router.get("/unidentified", asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, image_path, source, created_at FROM unidentified_portraits ORDER BY created_at, id"
  );
  res.json(rows);
}));

// POST /api/portraits/unidentified - queue faces for later.
// body: { items: [{ image, fingerprint, source }] }
// Skips faces already known, or already waiting in the queue, so importing
// the same screenshot twice doesn't double the queue.
router.post("/unidentified", asyncHandler(async (req, res) => {
  const items = (req.body || {}).items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw badRequest("items must be an array of 1-100 faces");
  }
  const parsed = items.map((item, i) => ({
    fingerprint: parseFingerprint(item && item.fingerprint, `items[${i}].fingerprint`),
    image: item && item.image,
    source: item && typeof item.source === "string" ? item.source.slice(0, 200) : null,
  }));

  const { rows: known } = await db.query(
    "SELECT fingerprint FROM unit_portraits UNION ALL SELECT fingerprint FROM unidentified_portraits"
  );
  const seen = known.map((r) => r.fingerprint);
  let added = 0;
  let skipped = 0;
  for (const [i, item] of parsed.entries()) {
    if (seen.some((fp) => similarity(fp, item.fingerprint) >= SAME_FACE)) {
      skipped++;
      continue;
    }
    const imagePath = saveImage(item.image, `items[${i}].image`);
    await db.query(
      "INSERT INTO unidentified_portraits (image_path, fingerprint, source) VALUES ($1, $2, $3)",
      [imagePath, JSON.stringify(item.fingerprint), item.source]
    );
    seen.push(item.fingerprint);
    added++;
  }
  res.status(201).json({ added, skipped });
}));

// POST /api/portraits/unidentified/:id/identify { unit_id } - answer one
// queued face. Any other queued faces that are the same face are answered
// too.
router.post("/unidentified/:id(\\d+)/identify", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const unitId = Number((req.body || {}).unit_id);
  if (!Number.isInteger(unitId) || !(await unitExists(db, unitId))) throw badRequest("unit_id doesn't exist");

  const resolved = await db.withTransaction(async (client) => {
    const { rows } = await client.query("SELECT * FROM unidentified_portraits WHERE id = $1 FOR UPDATE", [id]);
    if (rows.length === 0) throw notFound();
    const face = rows[0];
    await addKnownFace(client, {
      unitId,
      imagePath: face.image_path,
      fingerprint: face.fingerprint,
      source: face.source,
    });

    const { rows: queued } = await client.query("SELECT id, image_path, fingerprint FROM unidentified_portraits");
    const same = queued.filter((q) => q.id === id || similarity(q.fingerprint, face.fingerprint) >= SAME_FACE);
    await client.query("DELETE FROM unidentified_portraits WHERE id = ANY($1::int[])", [same.map((q) => q.id)]);
    // The first face's image is now the known face's image; the duplicates'
    // images aren't needed.
    same.filter((q) => q.id !== id).forEach((q) => removeFile(q.image_path));
    return same.length;
  });
  res.json({ resolved });
}));

// DELETE /api/portraits/unidentified/:id - "not a unit" / junk crop.
router.delete("/unidentified/:id(\\d+)", asyncHandler(async (req, res) => {
  const { rows } = await db.query("DELETE FROM unidentified_portraits WHERE id = $1 RETURNING image_path", [
    parseId(req.params.id),
  ]);
  if (rows.length === 0) throw notFound();
  removeFile(rows[0].image_path);
  res.status(204).end();
}));

module.exports = router;
