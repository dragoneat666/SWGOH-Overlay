const express = require("express");
const db = require("../db");
const asyncHandler = require("../asyncHandler");
const { createSquad, getSquad, findSquadByUnitSet } = require("../squadHelpers");

const router = express.Router();

// POST /api/counters
// body: {
//   defender_unit_ids: [12, 4, 87],           // ordered, leader first
//   counter_squads: [[3,9,14], [22,5,6], ...] // ranked, best first
//   source: "manual" | "ocr" | "import",       // default "manual"
//   submitted_by: "Dennis"
// }
//
// Manual entries (source: "manual", the default) go straight to
// status: "approved" - see docs/ARCHITECTURE.md on why manual entry by a
// trusted submitter skips the review queue. Anything else defaults to
// "pending" and needs an explicit approve call below.
router.post("/", asyncHandler(async (req, res) => {
  const { defender_unit_ids, counter_squads, source, submitted_by, notes } = req.body;

  if (!Array.isArray(defender_unit_ids) || defender_unit_ids.length === 0) {
    return res.status(400).json({ error: "defender_unit_ids is required" });
  }
  if (!Array.isArray(counter_squads) || counter_squads.length === 0) {
    return res.status(400).json({ error: "counter_squads (array of unit-id arrays) is required" });
  }

  const resolvedSource = source || "manual";
  const status = resolvedSource === "manual" ? "approved" : "pending";

  let defenderSquadId = await findSquadByUnitSet(defender_unit_ids);
  if (!defenderSquadId) {
    defenderSquadId = await createSquad(defender_unit_ids);
  }

  const { rows } = await db.query(
    `INSERT INTO counters (defender_squad_id, status, source, submitted_by, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [defenderSquadId, status, resolvedSource, submitted_by || null, notes || null]
  );
  const counterId = rows[0].id;

  for (let rank = 0; rank < counter_squads.length; rank++) {
    let squadId = await findSquadByUnitSet(counter_squads[rank]);
    if (!squadId) {
      squadId = await createSquad(counter_squads[rank]);
    }
    await db.query(
      `INSERT INTO counter_recommendations (counter_id, counter_squad_id, rank)
       VALUES ($1, $2, $3)`,
      [counterId, squadId, rank + 1]
    );
  }

  res.status(201).json({ id: counterId, status });
}));

// GET /api/counters/lookup?defender_unit_ids=12,4,87
// The core "what beats this team" query the overlay actually calls.
// Only returns approved counters. NOTE: route order matters here - this
// has to be registered before "/:id/approve" etc. so "lookup" and "pending"
// aren't swallowed by an "/:id" pattern; there is no bare "/:id" route here,
// but keep that in mind if one gets added later.
router.get("/lookup", asyncHandler(async (req, res) => {
  const raw = req.query.defender_unit_ids;
  if (!raw) {
    return res.status(400).json({ error: "defender_unit_ids query param is required (comma-separated unit ids)" });
  }
  const unitIds = raw.split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);

  const squadId = await findSquadByUnitSet(unitIds);
  if (!squadId) {
    return res.json({ found: false, counters: [] });
  }

  const { rows: counterRows } = await db.query(
    `SELECT id, notes FROM counters WHERE defender_squad_id = $1 AND status = 'approved'
     ORDER BY created_at DESC`,
    [squadId]
  );

  const results = [];
  for (const counter of counterRows) {
    const { rows: recs } = await db.query(
      `SELECT counter_squad_id, rank FROM counter_recommendations
       WHERE counter_id = $1 ORDER BY rank ASC`,
      [counter.id]
    );
    const squads = [];
    for (const rec of recs) {
      squads.push({ rank: rec.rank, ...(await getSquad(rec.counter_squad_id)) });
    }
    results.push({ counter_id: counter.id, notes: counter.notes, recommended_squads: squads });
  }

  res.json({ found: results.length > 0, counters: results });
}));

// GET /api/counters/pending - the review queue for OCR/import submissions
router.get("/pending", asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, defender_squad_id, source, submitted_by, notes, created_at
     FROM counters WHERE status = 'pending' ORDER BY created_at ASC`
  );
  res.json(rows);
}));

router.post("/:id/approve", asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `UPDATE counters SET status = 'approved', reviewed_at = now(), reviewed_by = $1
     WHERE id = $2 RETURNING id, status`,
    [req.body.reviewed_by || null, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
}));

router.post("/:id/reject", asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `UPDATE counters SET status = 'rejected', reviewed_at = now(), reviewed_by = $1
     WHERE id = $2 RETURNING id, status`,
    [req.body.reviewed_by || null, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
}));

module.exports = router;
