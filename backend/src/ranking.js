// Decides the recommended order of a defense team's counter squads from
// their battle stats, so nobody has to rank them by hand.
//
// Score = expected banners = (chance to win) x (average banners).
// The chance to win is the reported win rate pulled toward a 75% prior by
// 20 imaginary battles, so a squad that's 100% from 3 battles doesn't
// outrank one that's 98% from 4,000. Banners matter because GAC is scored
// in banners, not wins.
//
// Squads without stats keep the order they were entered in, after the
// ones with stats.

const PRIOR_WIN_RATE = 0.75;
const PRIOR_BATTLES = 20;
// Typical 5v5 GAC win when a squad has a win rate but no banner average.
const DEFAULT_BANNERS = 60;

function adjustedWinRate(winRatePct, seen) {
  const n = Math.max(0, seen);
  return ((winRatePct / 100) * n + PRIOR_WIN_RATE * PRIOR_BATTLES) / (n + PRIOR_BATTLES);
}

/** Expected banners, or null when the squad has no win rate + sample size. */
function counterScore({ win_rate, seen_count, avg_banners }) {
  if (win_rate == null || seen_count == null) return null;
  const banners = avg_banners == null ? DEFAULT_BANNERS : avg_banners;
  return Math.round(adjustedWinRate(win_rate, seen_count) * banners * 100) / 100;
}

/**
 * recs: [{ rank, win_rate, seen_count, avg_banners, ... }] where `rank` is
 * the entered order. Returns them best first with `score`, `manual_rank`
 * (entered order) and `rank` (recommended position, 1 = use this).
 */
function rankRecommendations(recs) {
  return recs
    .map((r) => ({ ...r, manual_rank: r.rank, score: counterScore(r) }))
    .sort((a, b) => {
      if (a.score != null && b.score != null) return b.score - a.score || a.manual_rank - b.manual_rank;
      if (a.score != null) return -1;
      if (b.score != null) return 1;
      return a.manual_rank - b.manual_rank;
    })
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

module.exports = { counterScore, adjustedWinRate, rankRecommendations };
