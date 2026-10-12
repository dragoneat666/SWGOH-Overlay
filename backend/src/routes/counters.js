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

const { loadCounters, toLookupShape, matchDefense } = require("../counterQueries");

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

// Optional battle stats on a counter squad. Blank -> null; anything present
// must be a sensible number.
function parseStats(entry, label) {
  const num = (key, min, max, integer) => {
    const v = entry[key];
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      throw badRequest(`${label}.${key} must be a number from ${min} to ${max}`);
    }
    return n;
  };
  return {
    seenCount: num("seen_count", 0, 100000000, true),
    winRate: num("win_rate", 0, 100, false),
    avgBanners: num("avg_banners", 0, 100, false),
  };
}

// counter_squads entries are either a bare unit-id array (leader first) or
// { unit_ids: [...], notes, seen_count, win_rate, avg_banners }. Order =
// the entered order; the recommended order comes from the stats (ranking.js).
function parseCounterSquads(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("counter_squads must be a non-empty array of squads");
  }
  const squads = raw.map((entry, i) => {
    const isObject = entry && typeof entry === "object" && !Array.isArray(entry);
    return {
      unitIds: parseUnitIds(isObject ? entry.unit_ids : entry, `counter_squads[${i}]`),
      notes: isObject ? cleanText(entry.notes) : null,
      ...(isObject ? parseStats(entry, `counter_squads[${i}]`) : { seenCount: null, winRate: null, avgBanners: null }),
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

async function loadCounter(id) {
  const [counter] = await loadCounters("WHERE id = $1", [id]);
  if (!counter) throw notFound();
  return counter;
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
    const s = counterSquads[i];
    const squadId = await findOrCreateSquad(client, s.unitIds);
    const hasStats = s.seenCount != null || s.winRate != null || s.avgBanners != null;
    await client.query(
      `INSERT INTO counter_recommendations
         (counter_id, counter_squad_id, rank, notes, seen_count, win_rate, avg_banners, stats_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ${hasStats ? "now()" : "NULL"})`,
      [counterId, squadId, i + 1, s.notes, s.seenCount, s.winRate, s.avgBanners]
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

// POST /api/counters/import - battle records read from a screenshot (and
// checked by you on the import screen).
// body: { rows: [{ defender_unit_ids, counter_unit_ids, seen_count, win_rate, avg_banners }] }
// Rows for the same defense team land in that team's one approved entry
// (created if it doesn't exist yet). A counter squad that's already listed
// gets its stats refreshed instead of being added twice.
router.post("/import", asyncHandler(async (req, res) => {
  const raw = (req.body || {}).rows;
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("rows must be a non-empty array");
  if (raw.length > 100) throw badRequest("at most 100 rows per import");
  const rows = raw.map((r, i) => {
    const row = r && typeof r === "object" ? r : {};
    return {
      defenderIds: parseUnitIds(row.defender_unit_ids, `rows[${i}].defender_unit_ids`),
      counterIds: parseUnitIds(row.counter_unit_ids, `rows[${i}].counter_unit_ids`),
      ...parseStats(row, `rows[${i}]`),
    };
  });

  const summary = { defense_teams_created: 0, counters_added: 0, counters_updated: 0, counter_ids: [] };
  await db.withTransaction(async (client) => {
    const counterIdByDefender = new Map();
    for (const row of rows) {
      const defenderSquadId = await findOrCreateSquad(client, row.defenderIds);
      let counterId = counterIdByDefender.get(defenderSquadId);
      if (!counterId) {
        const { rows: existing } = await client.query(
          `SELECT id FROM counters WHERE defender_squad_id = $1 AND status = 'approved' ORDER BY id LIMIT 1`,
          [defenderSquadId]
        );
        if (existing.length > 0) {
          counterId = existing[0].id;
        } else {
          const { rows: created } = await client.query(
            `INSERT INTO counters (defender_squad_id, status, source) VALUES ($1, 'approved', 'import') RETURNING id`,
            [defenderSquadId]
          );
          counterId = created[0].id;
          summary.defense_teams_created++;
        }
        counterIdByDefender.set(defenderSquadId, counterId);
      }

      const counterSquadId = await findOrCreateSquad(client, row.counterIds);
      const { rows: rec } = await client.query(
        "SELECT id FROM counter_recommendations WHERE counter_id = $1 AND counter_squad_id = $2",
        [counterId, counterSquadId]
      );
      if (rec.length > 0) {
        await client.query(
          `UPDATE counter_recommendations
           SET seen_count = $1, win_rate = $2, avg_banners = $3, stats_updated_at = now()
           WHERE id = $4`,
          [row.seenCount, row.winRate, row.avgBanners, rec[0].id]
        );
        summary.counters_updated++;
      } else {
        await client.query(
          `INSERT INTO counter_recommendations
             (counter_id, counter_squad_id, rank, seen_count, win_rate, avg_banners, stats_updated_at)
           SELECT $1, $2, COALESCE(MAX(rank), 0) + 1, $3, $4, $5, now()
           FROM counter_recommendations WHERE counter_id = $1`,
          [counterId, counterSquadId, row.seenCount, row.winRate, row.avgBanners]
        );
        summary.counters_added++;
      }
    }
    summary.counter_ids = [...new Set(counterIdByDefender.values())];
  });

  res.json(summary);
}));

// GET /api/counters/offense?unit_ids=3,9,14 - "what does this squad beat?"
// unit_ids is an attacking squad, leader first (1-5 units). Finds every
// recorded counter squad with that leader that includes all of those
// units (so a partial squad finds the full squads it's part of), and
// returns the defense teams they've beaten - best win rate first.
router.get("/offense", asyncHandler(async (req, res) => {
  const unitIds = parseUnitIdQuery(req.query.unit_ids, "unit_ids");
  const { rows: squadRows } = await db.query(
    `SELECT sm.squad_id
     FROM squad_members sm
     WHERE sm.squad_id IN (SELECT squad_id FROM squad_members WHERE position = 0 AND unit_id = $2)
     GROUP BY sm.squad_id
     HAVING COUNT(*) FILTER (WHERE sm.unit_id = ANY($1::int[])) = $3`,
    [unitIds, unitIds[0], unitIds.length]
  );
  if (squadRows.length === 0) return res.json({ results: [] });

  const { rows } = await db.query(
    `SELECT r.counter_id, r.counter_squad_id, r.win_rate, r.avg_banners, r.notes, c.defender_squad_id
     FROM counter_recommendations r
     JOIN counters c ON c.id = r.counter_id AND c.status = 'approved'
     WHERE r.counter_squad_id = ANY($1::int[])`,
    [squadRows.map((r) => r.squad_id)]
  );
  const squads = await getSquads([...new Set(rows.flatMap((r) => [r.counter_squad_id, r.defender_squad_id]))]);

  const results = rows
    .map((r) => ({
      counter_id: r.counter_id,
      win_rate: r.win_rate,
      avg_banners: r.avg_banners,
      notes: r.notes,
      exact: squads.get(r.counter_squad_id).units.length === unitIds.length,
      squad: squads.get(r.counter_squad_id),
      defender: squads.get(r.defender_squad_id),
    }))
    .sort(
      (a, b) =>
        (b.win_rate ?? -1) - (a.win_rate ?? -1) ||
        (b.avg_banners ?? -1) - (a.avg_banners ?? -1) ||
        Number(b.exact) - Number(a.exact)
    );
  res.json({ results });
}));

// GET /api/counters/offense/popular?limit=12 - attack squads that show up
// against the most defense teams in your data, with their average win rate
// and banners. Only counters with a recorded win rate count.
router.get("/offense/popular", asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 50);
  const { rows } = await db.query(
    `SELECT r.counter_squad_id,
            COUNT(DISTINCT c.defender_squad_id)::int AS defense_teams,
            AVG(r.win_rate) AS avg_win_rate,
            AVG(r.avg_banners) AS avg_banners
     FROM counter_recommendations r
     JOIN counters c ON c.id = r.counter_id AND c.status = 'approved'
     WHERE r.win_rate IS NOT NULL
     GROUP BY r.counter_squad_id
     ORDER BY defense_teams DESC, avg_win_rate DESC, avg_banners DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  const squads = await getSquads(rows.map((r) => r.counter_squad_id));
  const round = (v, d) => (v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);
  res.json({
    squads: rows.map((r) => ({
      ...squads.get(r.counter_squad_id),
      defense_teams: r.defense_teams,
      avg_win_rate: round(r.avg_win_rate, 1),
      avg_banners: round(r.avg_banners, 2),
    })),
  });
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

  res.json({ matches: await matchDefense(unitIds, limit) });
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
