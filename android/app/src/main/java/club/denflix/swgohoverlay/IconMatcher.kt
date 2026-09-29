package club.denflix.swgohoverlay

import android.graphics.Bitmap

/**
 * STUB - the actual icon-matching engine, not yet implemented.
 *
 * Per docs/ARCHITECTURE.md, this is deliberately the last piece to build,
 * once manual team selection is working end to end. When it's built, it
 * needs to:
 *
 * 1. Crop a captured screenshot down to individual portrait icons (fixed
 *    grid/layout assumptions per known screen, e.g. the GAC matchup screen).
 * 2. For each crop, further crop to an INNER CIRCLE that excludes the
 *    gear/relic/alignment ring, and mask out the corner level/relic badge -
 *    both of those vary per-instance and would break matching if included.
 *    See "Portrait images & the matching engine" in ARCHITECTURE.md.
 * 3. Compute a perceptual hash of the identity-only crop (no ML model
 *    needed - these are exact rendered assets, not photos).
 * 4. Compare against the known-units hash library (pulled from the backend's
 *    /api/units, each with its own stored identity-only reference image) and
 *    return the best match, or "no confident match" so the caller can fall
 *    back to manual entry / prompt for a name (see the bulk registration
 *    tool described in ARCHITECTURE.md - this same class is meant to power
 *    that too).
 */
object IconMatcher {

    data class MatchResult(val unitId: Int?, val confidence: Double)

    /**
     * TODO: implement. For now always returns "no match" so calling code can
     * be built and tested against the manual-entry path first.
     */
    fun matchIcon(crop: Bitmap, knownUnits: List<KnownUnitReference>): MatchResult {
        return MatchResult(unitId = null, confidence = 0.0)
    }

    data class KnownUnitReference(val unitId: Int, val referenceImage: Bitmap)
}
