// Local Postgres for development without Docker: an in-process PGlite
// database served over the normal Postgres wire protocol.
//
//   npm run dev:db                  (in-memory, gone when stopped)
//   PGLITE_DIR=./.devdb npm run dev:db   (kept on disk between runs)
//
// Then start the backend against it with
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres PG_POOL_MAX=1
// PG_POOL_MAX=1 matters: PGlite is a single-connection database.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.PGLITE_PORT || 54329);
const db = await PGlite.create(process.env.PGLITE_DIR || undefined);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
await server.start();
console.log(`Dev Postgres (PGlite) listening on 127.0.0.1:${port}`);

async function shutdown() {
  await server.stop();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
