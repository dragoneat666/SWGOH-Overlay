const express = require("express");
const db = require("../db");
const asyncHandler = require("../asyncHandler");
const { badRequest, notFound, conflict } = require("../httpError");
const {
  parseUnitIds,
  findSquad,
  findOrCreateSquad,
  deleteOrphanSquads,
  getSquads,
} = require("../squadHelpers");

const router = express.Router();

const STATUSES = ["pending", "approved", "rejected"];
const SOURCES = ["manual", "ocr", "import"];

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseCounterId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

// "12,4,87" -> [12, 4, 87], validated like a request body's unit id list.
function parseUnitIdQuery(raw, label) {
  if (!raw) throw badRequest(`${label} query param is required (comma-separated unit ids)`);
  return parseUnitIds(String(raw).split(",").map((s) => s.trim()).filter(Boolean), label);
}

// counter_squads entries are either a bare unit-id array (leader first) or
// { unit_ids: [...], notes: "..." }. Order = rank, best first.
function parseCounterSquads(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("counter_squads must be a non-empty array of squads");
  }
  const squads = raw.map((entry, i) => {
    const isObject = entry && typeof entry === "object" && !Array.isArray(entry);
    return {
      unitIds: parseUnitIds(isObject ? entry.unit_ids : entry, `counter_squads[${i}]`),
      notes: isObject ? cleanText(entry.notes) : null,
    };
  });
  const keys = squads.map(
    ({ unitIds }) => `${unitIds[0]}|${[...unitIds].sort((a, b) => a - b).join(",")}`
  );
  if (new Set(keys).size !== keys.length) {
    throw badRequest("counter_squads lists the same squad more than once");
  }
  return squads;
}

// Loads counters plus their defender squad and ranked recommended squads in
// a fixed number of queries. Each counter comes back as
// { id, status, source, submitted_by, notes, created_at, reviewed_at,
//   reviewed_by, defender: {id, units}, recommended_squads: [{rank, notes, id, units}] }
async function loadCounters(whereSql, params) {
  const { rows: counters } = await db.query(
    `SELECT id, defender_squad_id, status, source, submitted_by, notes,
            created_at, reviewed_at, reviewed_by
     FROM counters ${whereSql}
     ORDER BY created_at DESC, id DESC`,
    params
  );
  if (counters.length === 0) return [];

  const { rows: recs } = await db.query(
    `SELECT counter_id, counter_squad_id, rank, notes
     FROM counter_recommendations
     WHERE counter_id = ANY($1::int[])
     ORDER BY counter_id, rank ASC`,
    [counters.map((c) => c.id)]
  );

  const squadIds = new Set(counters.map((c) => c.defender_squad_id));
  for (const rec of recs) squadIds.add(rec.counter_squad_id);
  const squads = await getSquads([...squadIds]);

  const recsByCounter = new Map();
  for (const rec of recs) {
    if (!recsByCounter.has(rec.counter_id)) recsByCounter.set(rec.counter_id, []);
    recsByCounter.get(rec.counter_id).push({
      rank: rec.rank,
      notes: rec.notes,
      ...squads.get(rec.counter_squad_id),
    });
  }

  return counters.map(({ defender_squad_id, ...counter }) => ({
    ...counter,
    defender: squads.get(defender_squad_id),
    recommended_squads: recsByCounter.get(counter.id) || [],
  }));
}

async function loadCounter(id) {
  const [counter] = await loadCounters("WHERE id = $1", [id]);
  if (!counter) throw notFound();
  return counter;
}

// The shape /lookup has always returned, which the Android app reads.
function toLookupShape(counter) {
  return {
    counter_id: counter.id,
    notes: counter.notes,
    recommended_squads: counter.recommended_squads,
  };
}

// One approved counter entry per defender team keeps the overlay's answer
// unambiguous - a second manual entry for the same team should be an edit
// of the first instead.
async function assertNoOtherApprovedCounter(client, defenderSquadId, exceptCounterId) {
  const { rows } = await client.query(
    `SELECT id FROM counters
     WHERE defender_squad_id = $1 AND status = 'approved'
       AND ($2::int IS NULL OR id <> $2)
     LIMIT 1`,
    [defenderSquadId, exceptCounterId]
  );
  if (rows.length > 0) {
    throw conflict("this defender team already has a counter entry - edit that one instead", {
      existing_id: rows[0].id,
    });
  }
}

async function insertRecommendations(client, counterId, counterSquads) {
  for (let i = 0; i < counterSquads.length; i++) {
    const squadId = await findOrCreateSquad(client, counterSquads[i].unitIds);
    await client.query(
      `INSERT INTO counter_recommendations (counter_id, counter_squad_id, rank, notes)
       VALUES ($1, $2, $3, $4)`,
      [counterId, squadId, i + 1, counterSquads[i].notes]
    );
  }
}

// GET /api/counters?status=approved|pending|rejected - every counter entry
// (optionally filtered by status), newest first, fully expanded. This is
// what the web admin's counters list shows.
router.get("/", asyncHandler(async (req, res) => {
  const { status } = req.query;
  if (status && !STATUSES.includes(status)) {
    throw badRequest(`status must be one of ${STATUSES.join(", ")}`);
  }
  const counters = status
    ? await loadCounters("WHERE status = $1", [status])
    : await loadCounters("", []);
  res.json(counters);
}));

// POST /api/counters
// body: {
//   defender_unit_ids: [12, 4, 87],            // ordered, leader first
//   counter_squads: [[3,9,14], {unit_ids: [22,5,6], notes: "..."}, ...]
//                                               // ranked, best first
//   notes: "...",                               // about the defender team
//   source: "manual" | "ocr" | "import",        // default "manual"
//   submitted_by: "Dennis"
// }
//
// Manual entries (source: "manual", the default) go straight to
// status: "approved" - see docs/ARCHITECTURE.md on why manual entry by a
// trusted submitter skips the review queue. Anything else defaults to
// "pending" and needs an explicit approve call below.
router.post("/", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const defenderIds = parseUnitIds(body.defender_unit_ids, "defender_unit_ids");
  const counterSquads = parseCounterSquads(body.counter_squads);
  const source = body.source || "manual";
  if (!SOURCES.includes(source)) {
    throw badRequest(`source must be one of ${SOURCES.join(", ")}`);
  }
  const status = source === "manual" ? "approved" : "pending";

  const counterId = await db.withTransaction(async (client) => {
    const defenderSquadId = await findOrCreateSquad(client, defenderIds);
    if (status === "approved") {
      await assertNoOtherApprovedCounter(client, defenderSquadId, null);
    }
    const { rows } = await client.query(
      `INSERT INTO counters (defender_squad_id, status, source, submitted_by, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [defenderSquadId, status, source, cleanText(body.submitted_by), cleanText(body.notes)]
    );
    await insertRecommendations(client, rows[0].id, counterSquads);
    return rows[0].id;
  });

  res.status(201).json(await loadCounter(counterId));
}));

// GET /api/counters/lookup?defender_unit_ids=12,4,87
// Exact lookup: the defender team with this leader (first id) and exactly
// these members. Only returns approved counters. NOTE: the named routes
// (lookup, match, defender-squads, pending) must stay registered before the
// "/:id" routes below.
router.get("/lookup", asyncHandler(async (req, res) => {
  const unitIds = parseUnitIdQuery(req.query.defender_unit_ids, "defender_unit_ids");

  const squadId = await findSquad(db, unitIds);
  if (!squadId) {
    return res.json({ found: false, counters: [] });
  }

  const counters = await loadCounters(
    "WHERE defender_squad_id = $1 AND status = 'approved'",
    [squadId]
  );
  res.json({ found: counters.length > 0, counters: counters.map(toLookupShape) });
}));

// GET /api/counters/match?unit_ids=12,4,87,5,9&limit=5
// "Best match" lookup - the one the overlay uses once it can read the
// screen. unit_ids is whatever was detected on the enemy team, leader first
// if known. Unlike /lookup this tolerates a team that's one or two units
// off from what's on file (opponents swap members around), ranking every
// known defender team by how many units overlap, with a bonus when the
// leader matches. A single unit id works too: "show me every team led by X".
router.get("/match", asyncHandler(async (req, res) => {
  const unitIds = parseUnitIdQuery(req.query.unit_ids, "unit_ids");
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);

  const { rows } = await db.query(
    `SELECT DISTINCT defender_squad_id FROM counters WHERE status = 'approved'`
  );
  const squads = await getSquads(rows.map((r) => r.defender_squad_id));

  const detected = new Set(unitIds);
  const LEADER_BONUS = 0.2;
  const scored = [];
  for (const squad of squads.values()) {
    const overlap = squad.units.filter((u) => detected.has(u.id)).length;
    const leaderMatch = squad.units.length > 0 && squad.units[0].id === unitIds[0];
    if (overlap < 2 && !leaderMatch) continue;

    const coverage = overlap / Math.max(squad.units.length, unitIds.length);
    scored.push({
      score: Math.round(((coverage + (leaderMatch ? LEADER_BONUS : 0)) / (1 + LEADER_BONUS)) * 1000) / 1000,
      exact: leaderMatch && overlap === squad.units.length && overlap === unitIds.length,
      leader_match: leaderMatch,
      overlap,
      defender: squad,
    });
  }
  scored.sort((a, b) => b.score - a.score || b.overlap - a.overlap);
  const top = scored.slice(0, limit);

  const counters = top.length
    ? await loadCounters(
        "WHERE status = 'approved' AND defender_squad_id = ANY($1::int[])",
        [top.map((m) => m.defender.id)]
      )
    : [];
  const countersBySquad = new Map();
  for (const counter of counters) {
    const key = counter.defender.id;
    if (!countersBySquad.has(key)) countersBySquad.set(key, []);
    countersBySquad.get(key).push(toLookupShape(counter));
  }

  res.json({
    matches: top.map((m) => ({ ...m, counters: countersBySquad.get(m.defender.id) || [] })),
  });
}));

// GET /api/counters/defender-squads - every defender squad that has at
// least one approved counter on file, sorted by leader name. This is what
// the overlay's Team Select screen lists (manual team selection - see
// docs/ARCHITECTURE.md on why screenshot auto-detection isn't the v1 flow):
// the player taps whichever of these they're actually facing in their GAC
// match, and the app calls /lookup with that squad's unit ids.
router.get("/defender-squads", asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT defender_squad_id FROM counters WHERE status = 'approved'`
  );
  const squads = [...(await getSquads(rows.map((r) => r.defender_squad_id))).values()];
  const leaderName = (s) => (s.units[0] ? s.units[0].name : "");
  squads.sort((a, b) => leaderName(a).localeCompare(leaderName(b)));
  res.json({ squads });
}));

// GET /api/counters/pending - the review queue for OCR/import submissions
router.get("/pending", asyncHandler(async (req, res) => {
  res.json(await loadCounters("WHERE status = 'pending'", []));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  res.json(await loadCounter(parseCounterId(req.params.id)));
}));

// PUT /api/counters/:id - replace a counter entry's defender team, ranked
// counter squads, and notes (same body shape as POST, minus source).
router.put("/:id", asyncHandler(async (req, res) => {
  const counterId = parseCounterId(req.params.id);
  const body = req.body || {};
  const defenderIds = parseUnitIds(body.defender_unit_ids, "defender_unit_ids");
  const counterSquads = parseCounterSquads(body.counter_squads);

  await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT status FROM counters WHERE id = $1 FOR UPDATE",
      [counterId]
    );
    if (rows.length === 0) throw notFound();

    const defenderSquadId = await findOrCreateSquad(client, defenderIds);
    if (rows[0].status === "approved") {
      await assertNoOtherApprovedCounter(client, defenderSquadId, counterId);
    }
    await client.query(
      "UPDATE counters SET defender_squad_id = $1, notes = $2 WHERE id = $3",
      [defenderSquadId, cleanText(body.notes), counterId]
    );
    await client.query("DELETE FROM counter_recommendations WHERE counter_id = $1", [counterId]);
    await insertRecommendations(client, counterId, counterSquads);
    await deleteOrphanSquads(client);
  });

  res.json(await loadCounter(counterId));
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const counterId = parseCounterId(req.params.id);
  await db.withTransaction(async (client) => {
    const { rowCount } = await client.query("DELETE FROM counters WHERE id = $1", [counterId]);
    if (rowCount === 0) throw notFound();
    await deleteOrphanSquads(client);
  });
  res.status(204).end();
}));

async function review(req, res, status) {
  const { rows } = await db.query(
    `UPDATE counters SET status = $1, reviewed_at = now(), reviewed_by = $2
     WHERE id = $3 RETURNING id, status`,
    [status, cleanText((req.body || {}).reviewed_by), parseCounterId(req.params.id)]
  );
  if (rows.length === 0) throw notFound();
  res.json(rows[0]);
}

router.post("/:id/approve", asyncHandler((req, res) => review(req, res, "approved")));
router.post("/:id/reject", asyncHandler((req, res) => review(req, res, "rejected")));

module.exports = router;
