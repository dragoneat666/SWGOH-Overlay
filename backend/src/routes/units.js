const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const asyncHandler = require("../asyncHandler");
const { uploadDir } = require("../config");
const { badRequest, notFound, conflict } = require("../httpError");
const { importUnitsFromGameData } = require("../unitImport");

const router = express.Router();

fs.mkdirSync(uploadDir, { recursive: true });

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") &&
      IMAGE_EXTENSIONS.has(path.extname(file.originalname).toLowerCase() || ".png");
    cb(ok ? null : badRequest("image must be a PNG, JPEG, WebP or GIF file"), ok);
  },
});

const UNIT_COLUMNS = "id, definition_id, name, image_path, is_ship";

function parseUnitId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw notFound("unit not found");
  return id;
}

function parseBool(value) {
  return value === true || value === "true" || value === "1" || value === "on";
}

function cleanDefinitionId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim().toUpperCase();
  return trimmed || null;
}

function removeUpload(fileName) {
  if (!fileName) return;
  fs.promises.unlink(path.join(uploadDir, path.basename(fileName))).catch(() => {});
}

// Postgres unique-violation -> 409 with a readable message.
function rethrowUnique(err) {
  if (err.code === "23505") {
    throw conflict("a unit with this name or definition_id already exists");
  }
  throw err;
}

// GET /api/units - list everything, for the squad-builder search field.
// `used_in_counters` lets the admin UI warn before deleting a unit that's
// part of a saved squad.
router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.definition_id, u.name, u.image_path, u.is_ship,
            EXISTS (SELECT 1 FROM squad_members sm WHERE sm.unit_id = u.id) AS used_in_counters,
            (SELECT COUNT(*)::int FROM unit_portraits p WHERE p.unit_id = u.id) AS face_count
     FROM units u
     ORDER BY u.name ASC`
  );
  res.json(rows);
}));

// POST /api/units - register a new unit. name is required; image is optional
// at creation time (you can add it later via /:id/image, e.g. from the
// bulk screenshot-import tool once that's built). Accepts JSON or
// multipart/form-data (when an image is included).
router.post("/", upload.single("image"), asyncHandler(async (req, res) => {
  const { name, definition_id, is_ship } = req.body || {};
  const imagePath = req.file ? req.file.filename : null;

  if (!name || !String(name).trim()) {
    removeUpload(imagePath);
    throw badRequest("name is required");
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO units (name, definition_id, image_path, is_ship)
       VALUES ($1, $2, $3, $4)
       RETURNING ${UNIT_COLUMNS}`,
      [String(name).trim(), cleanDefinitionId(definition_id), imagePath, parseBool(is_ship)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    removeUpload(imagePath);
    rethrowUnique(err);
  }
}));

// POST /api/units/import-game-data - pull every playable character and ship
// from the game's own data (via Comlink) and add/update them here. Safe to
// re-run whenever new units are released; existing portraits and counters
// are untouched.
router.post("/import-game-data", asyncHandler(async (req, res) => {
  res.json(await importUnitsFromGameData());
}));

// PUT /api/units/:id - rename / fix definition_id / ship flag.
router.put("/:id", asyncHandler(async (req, res) => {
  const id = parseUnitId(req.params.id);
  const { name, definition_id, is_ship } = req.body || {};
  if (!name || !String(name).trim()) throw badRequest("name is required");

  try {
    const { rows } = await db.query(
      `UPDATE units SET name = $1, definition_id = $2, is_ship = $3, updated_at = now()
       WHERE id = $4
       RETURNING ${UNIT_COLUMNS}`,
      [String(name).trim(), cleanDefinitionId(definition_id), parseBool(is_ship), id]
    );
    if (rows.length === 0) throw notFound("unit not found");
    res.json(rows[0]);
  } catch (err) {
    rethrowUnique(err);
  }
}));

// DELETE /api/units/:id - refused while the unit is in any saved squad
// (squad_members.unit_id is ON DELETE RESTRICT), so deleting a unit can
// never silently break a counter.
router.delete("/:id", asyncHandler(async (req, res) => {
  const id = parseUnitId(req.params.id);
  try {
    const { rows } = await db.query(
      "DELETE FROM units WHERE id = $1 RETURNING image_path",
      [id]
    );
    if (rows.length === 0) throw notFound("unit not found");
    removeUpload(rows[0].image_path);
    res.status(204).end();
  } catch (err) {
    // 23001 = restrict_violation (ON DELETE RESTRICT), 23503 = plain FK violation
    if (err.code === "23001" || err.code === "23503") {
      throw conflict("this unit is part of a saved counter - remove it from those squads first");
    }
    throw err;
  }
}));

// POST /api/units/:id/image - attach/replace a unit's reference portrait.
// This is where the crop-to-inner-circle + mask-the-badge step belongs
// before saving (see docs/ARCHITECTURE.md) - not yet implemented; right now
// this stores whatever image is uploaded as-is. TODO: run it through the
// identity-crop step before writing to disk.
router.post("/:id/image", upload.single("image"), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest("image file is required");
  let id;
  try {
    id = parseUnitId(req.params.id);
  } catch (err) {
    removeUpload(req.file.filename);
    throw err;
  }

  const { rows: before } = await db.query("SELECT image_path FROM units WHERE id = $1", [id]);
  if (before.length === 0) {
    removeUpload(req.file.filename);
    throw notFound("unit not found");
  }

  const { rows } = await db.query(
    `UPDATE units SET image_path = $1, updated_at = now() WHERE id = $2
     RETURNING ${UNIT_COLUMNS}`,
    [req.file.filename, id]
  );
  removeUpload(before[0].image_path);
  res.json(rows[0]);
}));

module.exports = router;
