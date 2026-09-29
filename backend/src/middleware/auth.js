// Simple shared-bearer-token auth. Deliberately not per-user yet - see
// docs/ARCHITECTURE.md ("Auth & hosting") for why, and what to change if
// this grows past you + one trusted friend.
module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token || token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
};
