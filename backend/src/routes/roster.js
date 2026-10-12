const express = require("express");
const db = require("../db");
const asyncHandler = require("../asyncHandler");
const { badRequest } = require("../httpError");
const { fetchPlayerByAllyCode } = require("../comlinkClient");

const router = express.Router();

// "123-456-789" / "123 456 789" / "123456789" -> "123456789"
function normalizeAllyCode(raw) {
  const digits = String(raw || "").replace(/[^0-9]/g, "");
  if (digits.length !== 9) {
    throw badRequest("ally code must be 9 digits (dashes are fine)");
  }
  return digits;
}

// Comlink roster entries identify units as "BASEID:SEVEN_STAR" - the part
// before the colon is the same definition_id stored on `units`.
function baseDefinitionId(definitionId) {
  return String(definitionId).split(":")[0];
}

// GET /api/roster/:allyCode - pulls fresh data from Comlink, archives the
// full raw payload (append-only, see docs/ARCHITECTURE.md), upserts the
// normalized roster_units rows we actually use today, and returns a
// simplified roster the Android app can use to check "do I own a counter
// unit, and if so what's its gear/relic/ultimate state" for ring rendering.
router.get("/:allyCode", asyncHandler(async (req, res) => {
  const allyCode = normalizeAllyCode(req.params.allyCode);

  const player = await fetchPlayerByAllyCode(allyCode);

  const rosterUnit = player.rosterUnit || [];
  const normalized = rosterUnit
    .filter((u) => u.definitionId || u.id)
    .map((u) => {
      // relic.currentTier is an enum; real relic level = value - 2 (per
      // Comlink's own docs) - only meaningful once >= 3 (relic level 1+).
      const relicTierRaw = u.relic && u.relic.currentTier != null ? u.relic.currentTier : null;
      return {
        unit_definition_id: baseDefinitionId(u.definitionId || u.id),
        gear_tier: u.currentTier ?? null,
        relic_tier: relicTierRaw != null ? relicTierRaw - 2 : null,
        purchased_ability_ids: u.purchasedAbilityId || [],
      };
    });

  const snapshotId = await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO roster_snapshots (ally_code, raw_json) VALUES ($1, $2) RETURNING id`,
      [allyCode, JSON.stringify(player)]
    );
    const id = rows[0].id;

    for (const u of normalized) {
      await client.query(
        `INSERT INTO roster_units (ally_code, unit_definition_id, gear_tier, relic_tier, purchased_ability_ids, last_snapshot_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (ally_code, unit_definition_id)
         DO UPDATE SET gear_tier = EXCLUDED.gear_tier,
                       relic_tier = EXCLUDED.relic_tier,
                       purchased_ability_ids = EXCLUDED.purchased_ability_ids,
                       last_snapshot_id = EXCLUDED.last_snapshot_id,
                       updated_at = now()`,
        [allyCode, u.unit_definition_id, u.gear_tier, u.relic_tier, u.purchased_ability_ids, id]
      );
    }
    return id;
  });

  res.json({
    ally_code: allyCode,
    player_name: player.name || null,
    fetched_at: new Date().toISOString(),
    snapshot_id: snapshotId,
    unit_count: normalized.length,
    units: normalized,
  });
}));

module.exports = router;
