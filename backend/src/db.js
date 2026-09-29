const { Pool } = require("pg");

// A single shared pool - fine at this scale (personal project, low request
// volume). Revisit if this ever needs to handle a real number of concurrent
// users.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
