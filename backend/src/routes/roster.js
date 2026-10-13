const express = require("express");
const asyncHandler = require("../asyncHandler");
const { badRequest } = require("../httpError");
const { markRequested, pullRoster, cachedRoster } = require("../rosterSync");

const router = express.Router();

// "123-456-789" / "123 456 789" / "123456789" -> "123456789"
function normalizeAllyCode(raw) {
  const digits = String(raw || "").replace(/[^0-9]/g, "");
  if (digits.length !== 9) {
    throw badRequest("ally code must be 9 digits (dashes are fine)");
  }
  return digits;
}

// GET /api/roster/:allyCode - pulls fresh data from Comlink (rosterSync.js:
// archives the raw payload when it changed, upserts the normalized
// roster_units rows) and returns a simplified roster the Android app uses to
// check "do I own a counter unit, and if so what's its gear/relic/ultimate
// state". Asking also keeps this ally code in the server's background
// refresh.
//
// If Comlink can't be reached, the last pulled roster comes back instead,
// with stale: true, fetched_at = when it was pulled, and error = why.
router.get("/:allyCode", asyncHandler(async (req, res) => {
  const allyCode = normalizeAllyCode(req.params.allyCode);
  await markRequested(allyCode);
  try {
    res.json(await pullRoster(allyCode));
  } catch (err) {
    const cached = await cachedRoster(allyCode);
    if (!cached) throw err;
    res.json({ ...cached, error: err.message });
  }
}));

module.exports = router;
