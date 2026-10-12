const { Pool } = require("pg");

// A single shared pool - fine at this scale (personal project, low request
// volume). Revisit if this ever needs to handle a real number of concurrent
// users. PG_POOL_MAX exists for the test/dev database (PGlite), which only
// handles one connection safely - so code holding a transaction client must
// do all its work through that client, never db.query() alongside it.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : 10,
});

// Runs fn(client) inside BEGIN/COMMIT, rolling back if it throws.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  withTransaction,
  pool,
};
