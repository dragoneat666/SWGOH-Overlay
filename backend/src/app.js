const express = require("express");
const fs = require("fs");
const path = require("path");

const { uploadDir, webDir } = require("./config");
const requireAuth = require("./middleware/auth");
const unitsRouter = require("./routes/units");
const countersRouter = require("./routes/counters");
const rosterRouter = require("./routes/roster");

// Builds the Express app without starting it, so tests can run it on a
// random port against a throwaway database.
function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Unauthenticated health check, for docker-compose/uptime checks.
  app.get("/health", (req, res) => res.json({ ok: true }));

  // Serve uploaded unit portraits. Read access to images doesn't need the
  // API token (they're not sensitive), but everything under /api does.
  app.use("/uploads", express.static(uploadDir, { maxAge: "1h" }));

  const api = express.Router();
  api.use(requireAuth);
  // Lets the web UI's login screen check a token before saving it.
  api.get("/auth/check", (req, res) => res.json({ ok: true }));
  api.use("/units", unitsRouter);
  api.use("/counters", countersRouter);
  api.use("/roster", rosterRouter);
  api.use((req, res) => res.status(404).json({ error: "not found" }));
  app.use("/api", api);

  // Web admin UI (static build of frontend/). Any other path falls back to
  // index.html so client-side routes survive a page refresh.
  const indexHtml = path.join(webDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(webDir, { index: false, maxAge: "1h" }));
    app.get("*", (req, res) => res.sendFile(indexHtml, { maxAge: 0 }));
  }

  // Centralized error handler so route handlers can just `throw` / let
  // async rejections propagate instead of try/catching everywhere.
  app.use((err, req, res, next) => {
    if (err.status && err.body) {
      return res.status(err.status).json(err.body);
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "request body is not valid JSON" });
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "image is too large (5 MB max)" });
    }
    if (err.code === "23503") {
      return res.status(400).json({ error: "one of those unit ids doesn't exist" });
    }
    console.error(err);
    res.status(500).json({ error: "internal_error", message: err.message });
  });

  return app;
}

module.exports = { createApp };
