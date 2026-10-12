const db = require("./db");
const { badRequest } = require("./httpError");

// GAC fleets are the biggest squad shape: capital ship + 3 starters + 4
// reinforcements.
const MAX_SQUAD_SIZE = 8;

// Validates a request body's unit id list: non-empty, integers, no repeats,
// not over MAX_SQUAD_SIZE. Returns it as a clean int array (index 0 = leader).
function parseUnitIds(raw, label = "unit_ids") {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest(`${label} must be a non-empty array of unit ids`);
  }
  const ids = raw.map((v) => Number(v));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw badRequest(`${label} must only contain unit ids`);
  }
  if (new Set(ids).size !== ids.length) {
    throw badRequest(`${label} has the same unit more than once`);
  }
  if (ids.length > MAX_SQUAD_SIZE) {
    throw badRequest(`${label} can have at most ${MAX_SQUAD_SIZE} units`);
  }
  return ids;
}

// Finds the existing squad with exactly this leader and this set of
// members (non-leader order ignored). Returns its id, or null. The leader
// counts as part of a squad's identity because the lead ability changes how
// a team plays. `queryable` is either `db` or a transaction client.
async function findSquad(queryable, unitIds) {
  const { rows } = await queryable.query(
    `SELECT sm.squad_id
     FROM squad_members sm
     WHERE sm.squad_id IN (
       SELECT squad_id FROM squad_members WHERE position = 0 AND unit_id = $2
     )
     GROUP BY sm.squad_id
     HAVING COUNT(*) = $3 AND bool_and(sm.unit_id = ANY($1::int[]))
     LIMIT 1`,
    [unitIds, unitIds[0], unitIds.length]
  );
  return rows.length > 0 ? rows[0].squad_id : null;
}

// Squads are shared, immutable rows - re-entering "the same team" reuses
// the same squad id instead of piling up duplicates. `client` must be a
// transaction client from db.withTransaction.
async function findOrCreateSquad(client, unitIds) {
  const existingId = await findSquad(client, unitIds);
  if (existingId) return existingId;

  const { rows: created } = await client.query(
    "INSERT INTO squads DEFAULT VALUES RETURNING id"
  );
  const squadId = created[0].id;

  const values = [];
  const placeholders = unitIds
    .map((unitId, i) => {
      values.push(squadId, unitId, i);
      const base = i * 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    })
    .join(", ");

  await client.query(
    `INSERT INTO squad_members (squad_id, unit_id, position) VALUES ${placeholders}`,
    values
  );
  return squadId;
}

// Removes squads no counter points at any more (left behind after a
// counter is edited or deleted).
async function deleteOrphanSquads(client) {
  await client.query(
    `DELETE FROM squads s
     WHERE NOT EXISTS (SELECT 1 FROM counters c WHERE c.defender_squad_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM counter_recommendations r WHERE r.counter_squad_id = s.id)`
  );
}

// Loads many squads in one query. Returns a Map of squad id ->
// { id, units: [{id, definition_id, name, image_path, is_ship}, ...] }
// with units in position order (index 0 = leader).
// definition_id (SWGoH's own unit id string, e.g. "GRANDMASTERYODA") is
// needed so the Android app can cross-reference a recommended squad's units
// against the roster pulled from /api/roster/:allyCode, which is keyed by
// that same definition_id - the internal `id` here is only meaningful
// within this app's own DB (squad membership, used-squad tracking).
async function getSquads(squadIds) {
  const squads = new Map();
  if (squadIds.length === 0) return squads;

  const { rows } = await db.query(
    `SELECT sm.squad_id, u.id, u.definition_id, u.name, u.image_path, u.is_ship
     FROM squad_members sm
     JOIN units u ON u.id = sm.unit_id
     WHERE sm.squad_id = ANY($1::int[])
     ORDER BY sm.squad_id, sm.position ASC`,
    [squadIds]
  );
  for (const id of squadIds) squads.set(id, { id, units: [] });
  for (const { squad_id, ...unit } of rows) {
    squads.get(squad_id).units.push(unit);
  }
  return squads;
}

async function getSquad(squadId) {
  return (await getSquads([squadId])).get(squadId);
}

module.exports = {
  MAX_SQUAD_SIZE,
  parseUnitIds,
  findSquad,
  findOrCreateSquad,
  deleteOrphanSquads,
  getSquads,
  getSquad,
};
