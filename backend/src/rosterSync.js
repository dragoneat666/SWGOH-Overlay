// Rosters (the units each player owns), pulled from the game via Comlink.
//
// - The phone asks for a roster (GET /api/roster/:allyCode) when the
//   overlay starts and whenever its copy is old; that pulls a fresh one.
// - In the background, every ROSTER_REFRESH_HOURS (default 6, 0 = off) the
//   server re-pulls every ally code a phone has asked for in the last
//   ACTIVE_DAYS days, so newly unlocked units show up without anyone asking.
// - If Comlink can't be reached, the last pulled roster is served instead
//   (marked stale, with its time).
//
// Each pull archives the raw Comlink payload in roster_snapshots - but only
// when the roster changed since the last one, so timed pulls don't pile up
// identical copies.
const crypto = require("crypto");
const db = require("./db");
const { fetchPlayerByAllyCode } = require("./comlinkClient");

const ACTIVE_DAYS = 30;
const DEFAULT_REFRESH_HOURS = 6;

// Comlink roster entries identify units as "BASEID:SEVEN_STAR" - the part
// before the colon is the same definition_id stored on `units`.
function baseDefinitionId(definitionId) {
  return String(definitionId).split(":")[0];
}

function normalizeUnits(rosterUnit) {
  return (rosterUnit || [])
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
}

/** The phone asked for this ally code - keep it in the background refresh. */
async function markRequested(allyCode) {
  await db.query(
    `INSERT INTO roster_sync (ally_code, last_requested_at) VALUES ($1, now())
     ON CONFLICT (ally_code) DO UPDATE SET last_requested_at = now()`,
    [allyCode]
  );
}

/**
 * Pulls a roster from Comlink and stores it. Returns the API response shape:
 * { ally_code, player_name, fetched_at, snapshot_id, unit_count, units, stale: false }
 */
async function pullRoster(allyCode) {
  let player;
  try {
    player = await fetchPlayerByAllyCode(allyCode);
  } catch (err) {
    await db.query(
      `INSERT INTO roster_sync (ally_code, last_error, last_error_at) VALUES ($1, $2, now())
       ON CONFLICT (ally_code) DO UPDATE SET last_error = $2, last_error_at = now()`,
      [allyCode, err.message]
    );
    throw err;
  }
  const units = normalizeUnits(player.rosterUnit);
  // Fingerprint of the roster itself (not of the whole payload, which also
  // carries things like last-activity times that change every pull).
  const rosterHash = crypto.createHash("sha256").update(JSON.stringify(player.rosterUnit || [])).digest("hex");

  const snapshotId = await db.withTransaction(async (client) => {
    const { rows: last } = await client.query(
      `SELECT id, roster_hash FROM roster_snapshots WHERE ally_code = $1 ORDER BY fetched_at DESC, id DESC LIMIT 1`,
      [allyCode]
    );
    let id;
    if (last.length > 0 && last[0].roster_hash === rosterHash) {
      id = last[0].id;
    } else {
      const { rows } = await client.query(
        `INSERT INTO roster_snapshots (ally_code, raw_json, roster_hash) VALUES ($1, $2, $3) RETURNING id`,
        [allyCode, JSON.stringify(player), rosterHash]
      );
      id = rows[0].id;
    }

    for (const u of units) {
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
    await client.query(
      `INSERT INTO roster_sync (ally_code, player_name, last_pulled_at) VALUES ($1, $2, now())
       ON CONFLICT (ally_code) DO UPDATE SET player_name = $2, last_pulled_at = now(), last_error = NULL, last_error_at = NULL`,
      [allyCode, player.name || null]
    );
    return id;
  });

  return {
    ally_code: allyCode,
    player_name: player.name || null,
    fetched_at: new Date().toISOString(),
    snapshot_id: snapshotId,
    unit_count: units.length,
    units,
    stale: false,
  };
}

/** The last pulled roster (same shape as pullRoster, stale: true), or null. */
async function cachedRoster(allyCode) {
  const { rows: sync } = await db.query(
    "SELECT player_name, last_pulled_at FROM roster_sync WHERE ally_code = $1 AND last_pulled_at IS NOT NULL",
    [allyCode]
  );
  const { rows: units } = await db.query(
    `SELECT unit_definition_id, gear_tier, relic_tier, purchased_ability_ids, last_snapshot_id, updated_at
     FROM roster_units WHERE ally_code = $1 ORDER BY unit_definition_id`,
    [allyCode]
  );
  if (units.length === 0) return null;
  // Rosters pulled before roster_sync existed only have roster_units' times.
  const fetchedAt = sync.length > 0
    ? sync[0].last_pulled_at
    : units.reduce((max, u) => (u.updated_at > max ? u.updated_at : max), units[0].updated_at);
  return {
    ally_code: allyCode,
    player_name: sync.length > 0 ? sync[0].player_name : null,
    fetched_at: new Date(fetchedAt).toISOString(),
    snapshot_id: Math.max(...units.map((u) => u.last_snapshot_id || 0)) || null,
    unit_count: units.length,
    units: units.map(({ unit_definition_id, gear_tier, relic_tier, purchased_ability_ids }) => ({
      unit_definition_id, gear_tier, relic_tier, purchased_ability_ids,
    })),
    stale: true,
  };
}

/** Re-pulls every ally code asked for in the last ACTIVE_DAYS days. */
async function refreshActiveRosters() {
  const { rows } = await db.query(
    `SELECT ally_code FROM roster_sync
     WHERE last_requested_at > now() - make_interval(days => $1)
     ORDER BY ally_code`,
    [ACTIVE_DAYS]
  );
  let refreshed = 0;
  let failed = 0;
  for (const { ally_code: allyCode } of rows) {
    try {
      await pullRoster(allyCode);
      refreshed++;
    } catch (err) {
      failed++;
      console.warn(`Roster refresh failed for one ally code: ${err.message}`);
    }
  }
  return { refreshed, failed };
}

/** Starts the background refresh (no-op when ROSTER_REFRESH_HOURS is 0). */
function startRosterRefresh() {
  const raw = process.env.ROSTER_REFRESH_HOURS;
  const hours = raw == null || raw === "" ? DEFAULT_REFRESH_HOURS : Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.log("Background roster refresh is off (ROSTER_REFRESH_HOURS=0).");
    return null;
  }
  const run = () => refreshActiveRosters().catch((err) => console.warn(`Roster refresh failed: ${err.message}`));
  // First run a minute after startup (Comlink may still be starting too).
  const first = setTimeout(run, 60 * 1000);
  const timer = setInterval(run, hours * 60 * 60 * 1000);
  first.unref();
  timer.unref();
  console.log(`Background roster refresh every ${hours} h.`);
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { markRequested, pullRoster, cachedRoster, refreshActiveRosters, startRosterRefresh };
