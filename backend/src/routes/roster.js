const express = require("express");
const db = require("../db");
const asyncHandler = require("../asyncHandler");
const { fetchPlayerByAllyCode } = require("../comlinkClient");

const router = express.Router();

// GET /api/roster/:allyCode - pulls fresh data from Comlink, archives the
// full raw payload (append-only, see docs/ARCHITECTURE.md), upserts the
// normalized roster_units rows we actually use today, and returns a
// simplified roster the Android app can use to check "do I own a counter
// unit, and if so what's its gear/relic/ultimate state" for ring rendering.
router.get("/:allyCode", asyncHandler(async (req, res) => {
  const { allyCode } = req.params;

  const player = await fetchPlayerByAllyCode(allyCode);

  const { rows: snapRows } = await db.query(
    `INSERT INTO roster_snapshots (ally_code, raw_json) VALUES ($1, $2) RETURNING id`,
    [allyCode, JSON.stringify(player)]
  );
  const snapshotId = snapRows[0].id;

  const rosterUnit = player.rosterUnit || [];

  const normalized = [];
  for (const u of rosterUnit) {
    const definitionId = u.definitionId || u.id;
    const gearTier = u.currentTier ?? null;
    // relic.currentTier is an enum; real relic level = value - 2 (per
    // Comlink's own docs) - only meaningful once >= 3 (relic level 1+).
    const relicTierRaw = u.relic && u.relic.currentTier != null ? u.relic.currentTier : null;
    const relicTier = relicTierRaw != null ? relicTierRaw - 2 : null;
    const purchasedAbilityIds = u.purchasedAbilityId || [];

    await db.query(
      `INSERT INTO roster_units (ally_code, unit_definition_id, gear_tier, relic_tier, purchased_ability_ids, last_snapshot_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (ally_code, unit_definition_id)
       DO UPDATE SET gear_tier = EXCLUDED.gear_tier,
                     relic_tier = EXCLUDED.relic_tier,
                     purchased_ability_ids = EXCLUDED.purchased_ability_ids,
                     last_snapshot_id = EXCLUDED.last_snapshot_id,
                     updated_at = now()`,
      [allyCode, definitionId, gearTier, relicTier, purchasedAbilityIds, snapshotId]
    );

    normalized.push({
      unit_definition_id: definitionId,
      gear_tier: gearTier,
      relic_tier: relicTier,
      purchased_ability_ids: purchasedAbilityIds,
    });
  }

  res.json({
    ally_code: allyCode,
    fetched_at: new Date().toISOString(),
    snapshot_id: snapshotId,
    unit_count: normalized.length,
    units: normalized,
  });
}));

module.exports = router;
