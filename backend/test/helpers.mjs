// Test harness: a throwaway in-memory Postgres (PGlite, served over the
// real wire protocol so the app's normal `pg` driver talks to it), a fake
// Comlink server, and the Express app on a random port.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const require = createRequire(import.meta.url);

export const TOKEN = "test-token";

// Minimal stand-in for the Comlink endpoints the backend calls. `state`
// lets a test swap the canned responses.
export function startFakeComlink(state) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      state.requests.push({ path: req.url, body: json });
      const handler = state.routes[req.url];
      if (!handler) {
        res.writeHead(404).end("no such route");
        return;
      }
      const out = handler(json);
      res.writeHead(out.status || 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export async function startTestEnv() {
  const pg = await PGlite.create();
  const pgServer = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1" });
  await pgServer.start();
  const pgPort = Number(pgServer.getServerConn().split(":").pop());

  const comlinkState = { routes: {}, requests: [] };
  const comlink = await startFakeComlink(comlinkState);

  const uploadDir = mkdtempSync(path.join(tmpdir(), "swgoh-uploads-"));

  Object.assign(process.env, {
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`,
    PG_POOL_MAX: "1",
    API_TOKEN: TOKEN,
    COMLINK_URL: `http://127.0.0.1:${comlink.address().port}`,
    UPLOAD_DIR: uploadDir,
    WEB_DIR: path.join(uploadDir, "no-web-build"),
  });

  const { migrate } = require("../src/migrate");
  const { createApp } = require("../src/app");
  const db = require("../src/db");

  await migrate();

  const app = createApp();
  const http = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${http.address().port}`;

  async function api(method, urlPath, { body, token = TOKEN, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(baseUrl + urlPath, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  async function stop() {
    await new Promise((resolve) => http.close(resolve));
    await db.pool.end();
    await new Promise((resolve) => comlink.close(resolve));
    await pgServer.stop();
    await pg.close();
    rmSync(uploadDir, { recursive: true, force: true });
  }

  return { api, db, baseUrl, uploadDir, comlinkState, stop };
}
