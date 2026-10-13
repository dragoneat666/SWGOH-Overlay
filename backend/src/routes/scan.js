const express = require("express");
const { PNG } = require("pngjs");
const jpeg = require("jpeg-js");
const db = require("../db");
const asyncHandler = require("../asyncHandler");
const { badRequest } = require("../httpError");
const { matchDefense } = require("../counterQueries");
const { loadScanLib } = require("../faceFingerprints");
const { readRelics } = require("../badgeReader");

// Screen scans from the phone overlay: the phone sends a screenshot of the
// GAC territory screen, this finds the enemy squads that are still
// standing, identifies their units by face, and matches each squad to the
// saved defense teams - the same pixel code the web importer uses
// (shared/scan, ES modules).
const router = express.Router();

// At or above this a face counts as recognized without asking. Same-source
// copies of a face score ~1.0; a game face vs its swgoh.gg version scores
// around 0.4-0.7, so those come back as suggestions to confirm.
const SAME_FACE = 0.9;
// Suggestions shown when a face isn't recognized outright.
const MAX_CANDIDATES = 3;
const MIN_CANDIDATE_SCORE = 0.25;

function decodeImage(body, contentType) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw badRequest("send the screenshot as the request body (Content-Type image/png or image/jpeg)");
  }
  try {
    if (/png/i.test(contentType)) {
      const png = PNG.sync.read(body);
      return { width: png.width, height: png.height, data: png.data };
    }
    const img = jpeg.decode(body, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    return { width: img.width, height: img.height, data: img.data };
  } catch (err) {
    throw badRequest(`couldn't read that image (${err.message})`);
  }
}

// A face picture (faces.facePicture) as a PNG data URL - shown on the phone
// when asking who it is, and stored as the face's picture.
function pictureDataUrl(picture) {
  const png = new PNG({ width: picture.width, height: picture.height });
  png.data = Buffer.from(picture.data);
  return "data:image/png;base64," + PNG.sync.write(png).toString("base64");
}

// Best score per unit, highest first.
function rankUnits(fingerprint, library, similarity) {
  const best = new Map();
  for (const face of library) {
    const s = similarity(fingerprint, face.fingerprint);
    if (s > (best.get(face.unit_id) ?? -2)) best.set(face.unit_id, s);
  }
  return [...best.entries()].map(([unitId, score]) => ({ unitId, score })).sort((a, b) => b.score - a.score);
}

// POST /api/scan/gac  (body: the screenshot, image/png or image/jpeg)
// Returns
//   { width, height, beaten,
//     squads: [{ slots: [{ unit_id | null, score, candidates: [{unit_id, name, score}],
//                          image, fingerprint, relic }],
//                matches: [...same as /api/counters/match...] | null }] }
// `squads` are the lit (still standing) ones, top to bottom. `matches` is
// filled in once every face in the squad is recognized; otherwise the phone
// asks about the unknown ones (POST /api/portraits with the returned image
// and fingerprint) and then looks the squad up itself. `relic` is the
// relic level read off the portrait's badge (1-10), or null when it has
// none or it couldn't be read.
router.post(
  "/gac",
  express.raw({ type: ["image/png", "image/jpeg", "image/jpg"], limit: "25mb" }),
  asyncHandler(async (req, res) => {
    const img = decodeImage(req.body, req.headers["content-type"] || "");
    const { gac, faces, badges } = await loadScanLib();
    const found = gac.detectGacSquads(img);
    const lit = found.filter((s) => s.lit);

    const { rows: library } = await db.query("SELECT unit_id, fingerprint FROM unit_portraits");
    const { rows: units } = await db.query("SELECT id, name FROM units");
    const names = new Map(units.map((u) => [u.id, u.name]));

    const squads = [];
    for (const squad of lit) {
      const relics = await readRelics(img, squad.slots, badges);
      const slots = squad.slots.map((slot, k) => {
        // Fingerprint from the picture, exactly as it will be stored if the
        // user says who this is - so it's recognized next time.
        const picture = faces.facePicture(img, slot.cx, slot.cy, slot.r, faces.RING_SCALE.game);
        const fingerprint = faces.pictureFingerprint(picture, faces.RING_SCALE.game);
        const ranked = rankUnits(fingerprint, library, faces.similarity);
        const top = ranked[0];
        const recognized = top && top.score >= SAME_FACE;
        return {
          unit_id: recognized ? top.unitId : null,
          score: top ? Math.round(top.score * 1000) / 1000 : null,
          candidates: ranked
            .filter((c) => c.score >= MIN_CANDIDATE_SCORE)
            .slice(0, MAX_CANDIDATES)
            .map((c) => ({ unit_id: c.unitId, name: names.get(c.unitId) || null, score: Math.round(c.score * 1000) / 1000 })),
          image: pictureDataUrl(picture),
          fingerprint,
          relic: relics[k],
        };
      });
      const ids = slots.map((s) => s.unit_id);
      const complete = ids.every((id) => id != null) && new Set(ids).size === ids.length;
      squads.push({ slots, matches: complete ? await matchDefense(ids, 4) : null });
    }

    res.json({ width: img.width, height: img.height, beaten: found.length - lit.length, squads });
  })
);

module.exports = router;
