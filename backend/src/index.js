require("dotenv").config();
const express = require("express");
const path = require("path");

const requireAuth = require("./middleware/auth");
const unitsRouter = require("./routes/units");
const countersRouter = require("./routes/counters");
const rosterRouter = require("./routes/roster");

const app = express();
app.use(express.json());

// Unauthenticated health check, for docker-compose/uptime checks.
app.get("/health", (req, res) => res.json({ ok: true }));

// Serve uploaded unit portraits. Read access to images doesn't need the API
// token (they're not sensitive), but everything else below does.
app.use("/uploads", express.static("/app/uploads"));

app.use(requireAuth);
app.use("/api/units", unitsRouter);
app.use("/api/counters", countersRouter);
app.use("/api/roster", rosterRouter);

// Centralized error handler so route handlers can just `throw` / let async
// rejections propagate instead of try/catching everywhere.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error", message: err.message });
});

const port = process.env.PORT || 4001;
app.listen(port, () => {
  console.log(`SWGOH Overlay backend listening on :${port}`);
});
