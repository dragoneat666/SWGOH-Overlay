const db = require("./db");

// Creates a squad row + its ordered members in one go. unitIds is an ordered
// array (index 0 = leader). Returns the new squad's id.
async function createSquad(unitIds) {
  if (!Array.isArray(unitIds) || unitIds.length === 0) {
    throw new Error("unitIds must be a non-empty array");
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      "INSERT INTO squads DEFAULT VALUES RETURNING id"
    );
    const squadId = rows[0].id;

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

    await client.query("COMMIT");
    return squadId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Returns { id, units: [{id, name, image_path, is_ship}, ...] } in position
// order (index 0 = leader) for a single squad id.
async function getSquad(squadId) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.image_path, u.is_ship
     FROM squad_members sm
     JOIN units u ON u.id = sm.unit_id
     WHERE sm.squad_id = $1
     ORDER BY sm.position ASC`,
    [squadId]
  );
  return { id: squadId, units: rows };
}

// Finds an existing squad that has EXACTLY this set of unit ids (order
// ignored) - used so re-entering "the same defender squad" doesn't create a
// duplicate squads row every time. Returns the squad id, or null.
async function findSquadByUnitSet(unitIds) {
  const { rows } = await db.query(
    `SELECT sm.squad_id
     FROM squad_members sm
     WHERE sm.unit_id = ANY($1::int[])
     GROUP BY sm.squad_id
     HAVING COUNT(*) = $2
        AND COUNT(*) = (SELECT COUNT(*) FROM squad_members sm2 WHERE sm2.squad_id = sm.squad_id)`,
    [unitIds, unitIds.length]
  );
  return rows.length > 0 ? rows[0].squad_id : null;
}

module.exports = { createSquad, getSquad, findSquadByUnitSet };
