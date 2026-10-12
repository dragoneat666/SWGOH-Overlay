const crypto = require("crypto");

// Simple shared-bearer-token auth. Deliberately not per-user yet - see
// docs/ARCHITECTURE.md ("Auth & hosting") for why, and what to change if
// this grows past you + one trusted friend. The web admin UI sends the same
// token (typed in once on its login screen, kept in the browser).
function tokensMatch(given, expected) {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const expected = process.env.API_TOKEN;

  if (!token || !expected || !tokensMatch(token, expected)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
};
