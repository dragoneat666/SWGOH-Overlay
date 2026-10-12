// Builds the playable-unit catalog (name + definition_id + ship flag) from
// the game's own data via Comlink and upserts it into `units`, so the units
// library doesn't have to be typed in by hand. Portraits aren't part of
// this - see docs/ARCHITECTURE.md ("Portrait images & the matching engine").
const db = require("./db");
const comlink = require("./comlinkClient");

const COMBAT_TYPE_SHIP = 2;

function isShip(unit) {
  return unit.combatType === COMBAT_TYPE_SHIP || unit.combatType === "SHIP";
}

// Keeps one entry per playable unit: `units` lists every unit once per star
// level, and also includes things that were never released or aren't out
// yet (obtainable false / obtainableTime in the future).
function extractPlayableUnits(rawUnits, localization, now = Date.now()) {
  const byBaseId = new Map();
  let missingName = 0;

  for (const u of rawUnits) {
    if (!u || !u.baseId || byBaseId.has(u.baseId)) continue;
    if (u.obtainable === false) continue;
    const obtainableTime = Number(u.obtainableTime || 0);
    if (obtainableTime > now) continue;

    const name = localization.get(u.nameKey);
    if (!name) {
      missingName++;
      continue;
    }
    byBaseId.set(u.baseId, { definition_id: u.baseId, name: name.trim(), is_ship: isShip(u) });
  }

  return { units: [...byBaseId.values()], missingName };
}

// Upserts the catalog. Matching order: same definition_id first, then a
// manually-added unit with the same name and no definition_id yet (it gets
// the id attached). Names stay unique - if the game reuses a display name
// for two units, the later one gets its definition_id appended.
async function upsertUnits(units) {
  const counts = { created: 0, updated: 0, unchanged: 0 };

  await db.withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      "SELECT id, definition_id, name, is_ship FROM units"
    );
    const byDefinitionId = new Map(existing.filter((u) => u.definition_id).map((u) => [u.definition_id, u]));
    const byName = new Map(existing.map((u) => [u.name.toLowerCase(), u]));

    for (const unit of units) {
      let match = byDefinitionId.get(unit.definition_id);
      if (!match) {
        const sameName = byName.get(unit.name.toLowerCase());
        if (sameName && !sameName.definition_id) match = sameName;
      }

      let name = unit.name;
      const nameOwner = byName.get(name.toLowerCase());
      if (nameOwner && nameOwner !== match) {
        name = `${unit.name} (${unit.definition_id})`;
      }

      if (match) {
        if (match.name === name && match.definition_id === unit.definition_id && match.is_ship === unit.is_ship) {
          counts.unchanged++;
          continue;
        }
        await client.query(
          `UPDATE units SET name = $1, definition_id = $2, is_ship = $3, updated_at = now() WHERE id = $4`,
          [name, unit.definition_id, unit.is_ship, match.id]
        );
        byName.delete(match.name.toLowerCase());
        Object.assign(match, { name, definition_id: unit.definition_id, is_ship: unit.is_ship });
        byName.set(name.toLowerCase(), match);
        byDefinitionId.set(unit.definition_id, match);
        counts.updated++;
      } else {
        const { rows } = await client.query(
          `INSERT INTO units (name, definition_id, is_ship) VALUES ($1, $2, $3)
           RETURNING id, definition_id, name, is_ship`,
          [name, unit.definition_id, unit.is_ship]
        );
        byName.set(name.toLowerCase(), rows[0]);
        byDefinitionId.set(unit.definition_id, rows[0]);
        counts.created++;
      }
    }
  });

  return counts;
}

async function importUnitsFromGameData() {
  const meta = await comlink.fetchMetadata();
  if (!meta.latestGamedataVersion || !meta.latestLocalizationBundleVersion) {
    throw new Error("Comlink /metadata response is missing the game data / localization versions");
  }
  const [rawUnits, localization] = await Promise.all([
    comlink.fetchUnitDefinitions(meta.latestGamedataVersion),
    comlink.fetchEnglishLocalization(meta.latestLocalizationBundleVersion),
  ]);

  const { units, missingName } = extractPlayableUnits(rawUnits, localization);
  if (units.length === 0) {
    throw new Error("Comlink game data contained no playable units - nothing imported");
  }
  const counts = await upsertUnits(units);

  return {
    game_data_version: meta.latestGamedataVersion,
    total: units.length,
    characters: units.filter((u) => !u.is_ship).length,
    ships: units.filter((u) => u.is_ship).length,
    skipped_without_name: missingName,
    ...counts,
  };
}

module.exports = { importUnitsFromGameData, extractPlayableUnits, upsertUnits };
