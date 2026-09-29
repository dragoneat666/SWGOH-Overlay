const express = require("express");
const multer = require("multer");
const path = require("path");
const db = require("../db");
const asyncHandler = require("../asyncHandler");

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: "/app/uploads",
    filename: (req, file, cb) => {
      // unit id isn't known yet on create, so stash under a temp name and
      // rename after insert; for /:id/image it's known up front.
      const ext = path.extname(file.originalname) || ".png";
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// GET /api/units - list everything, for the squad-builder search field
router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, definition_id, name, image_path, is_ship FROM units ORDER BY name ASC"
  );
  res.json(rows);
}));

// POST /api/units - register a new unit. name is required; image is optional
// at creation time (you can add it later via /:id/image, e.g. from the
// bulk screenshot-import tool once that's built).
router.post("/", upload.single("image"), asyncHandler(async (req, res) => {
  const { name, definition_id, is_ship } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  const imagePath = req.file ? req.file.filename : null;

  try {
    const { rows } = await db.query(
      `INSERT INTO units (name, definition_id, image_path, is_ship)
       VALUES ($1, $2, $3, $4)
       RETURNING id, definition_id, name, image_path, is_ship`,
      [name.trim(), definition_id || null, imagePath, is_ship === "true" || is_ship === true]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "a unit with this name or definition_id already exists" });
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
  if (!req.file) {
    return res.status(400).json({ error: "image file is required" });
  }

  const { rows } = await db.query(
    `UPDATE units SET image_path = $1, updated_at = now() WHERE id = $2
     RETURNING id, definition_id, name, image_path, is_ship`,
    [req.file.filename, req.params.id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "unit not found" });
  }

  res.json(rows[0]);
}));

module.exports = router;
