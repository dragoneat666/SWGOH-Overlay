// Brings the database schema up to date on every startup.
//
// 1. If the base tables don't exist yet, apply db/init.sql. Normally the
//    Postgres container already ran it on first start, but a Dockge stack
//    without db/init.sql copied next to it gets an empty database (Docker
//    mounts a missing file as an empty directory) - this covers that case.
// 2. Apply the changes made after the first deploy. db/init.sql only runs
//    when the Postgres volume is first created, so anything added later
//    lives here - every statement must be safe to re-run (IF NOT EXISTS).
const fs = require("fs");
const path = require("path");
const db = require("./db");

const MIGRATIONS = [
  // Per-counter-squad notes ("kill Reva first", "needs Jabba ult").
  `ALTER TABLE counter_recommendations ADD COLUMN IF NOT EXISTS notes TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_counter_recommendations_squad ON counter_recommendations(counter_squad_id)`,
  `CREATE INDEX IF NOT EXISTS idx_counters_defender ON counters(defender_squad_id)`,

  // Battle stats per counter squad (from swgoh.gg screenshots or typed in).
  // They decide the recommended order - see ranking.js.
  `ALTER TABLE counter_recommendations ADD COLUMN IF NOT EXISTS seen_count INTEGER`,
  `ALTER TABLE counter_recommendations ADD COLUMN IF NOT EXISTS win_rate DOUBLE PRECISION`,
  `ALTER TABLE counter_recommendations ADD COLUMN IF NOT EXISTS avg_banners DOUBLE PRECISION`,
  `ALTER TABLE counter_recommendations ADD COLUMN IF NOT EXISTS stats_updated_at TIMESTAMPTZ`,

  // Known faces: one row per identified portrait crop. Several per unit is
  // normal (different sources/ring colors). fingerprint =
  // shared/scan/faces.mjs#pictureFingerprint of the stored picture.
  `CREATE TABLE IF NOT EXISTS unit_portraits (
     id          SERIAL PRIMARY KEY,
     unit_id     INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
     image_path  TEXT NOT NULL,
     fingerprint JSONB NOT NULL,
     source      TEXT,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_unit_portraits_unit ON unit_portraits(unit_id)`,

  // Faces seen in a screenshot that nobody has identified yet - the
  // "To identify" queue in the web UI.
  `CREATE TABLE IF NOT EXISTS unidentified_portraits (
     id          SERIAL PRIMARY KEY,
     image_path  TEXT NOT NULL,
     fingerprint JSONB NOT NULL,
     source      TEXT,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // Rosters: a new raw snapshot is only archived when the roster changed
  // (roster_hash), and roster_sync tracks which ally codes the phone uses so
  // the server can refresh them in the background (rosterSync.js).
  `ALTER TABLE roster_snapshots ADD COLUMN IF NOT EXISTS roster_hash TEXT`,
  `CREATE TABLE IF NOT EXISTS roster_sync (
     ally_code         TEXT PRIMARY KEY,
     player_name       TEXT,
     last_requested_at TIMESTAMPTZ,
     last_pulled_at    TIMESTAMPTZ,
     last_error        TEXT,
     last_error_at     TIMESTAMPTZ
   )`,
];

// /app/db/init.sql inside the Docker image, ../db/init.sql in a repo checkout.
const SCHEMA_CANDIDATES = [
  path.join(__dirname, "..", "db", "init.sql"),
  path.join(__dirname, "..", "..", "db", "init.sql"),
];

async function applyBaseSchemaIfMissing() {
  const { rows } = await db.query("SELECT to_regclass('public.units') AS units_table");
  if (rows[0].units_table) return false;

  const schemaFile = SCHEMA_CANDIDATES.find((f) => fs.existsSync(f));
  if (!schemaFile) {
    throw new Error("Database has no tables and db/init.sql couldn't be found to create them");
  }
  await db.query(fs.readFileSync(schemaFile, "utf8"));
  return true;
}

async function migrate() {
  if (await applyBaseSchemaIfMissing()) {
    console.log("Created database tables from db/init.sql");
  }
  for (const sql of MIGRATIONS) {
    await db.query(sql);
  }
}

// The API container can start while Postgres is still initializing, so keep
// retrying for a while before giving up.
async function migrateWithRetry({ attempts = 30, delayMs = 2000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await migrate();
    } catch (err) {
      if (i >= attempts) throw err;
      console.warn(`Database not ready (${err.message}) - retrying in ${delayMs / 1000}s [${i}/${attempts}]`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { migrate, migrateWithRetry };
