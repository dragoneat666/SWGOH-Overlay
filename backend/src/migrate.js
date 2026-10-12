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
