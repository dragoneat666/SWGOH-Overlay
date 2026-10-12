// Read-side counter queries shared by the counters routes and the screen
// scan endpoint (routes/scan.js).
const db = require("./db");
const { getSquads } = require("./squadHelpers");
const { rankRecommendations } = require("./ranking");

// Loads counters plus their defender squad and ranked recommended squads in
// a fixed number of queries. Each counter comes back as
// { id, status, source, submitted_by, notes, created_at, reviewed_at,
//   reviewed_by, defender: {id, units}, recommended_squads: [{rank, notes, id, units}] }
async function loadCounters(whereSql, params) {
  const { rows: counters } = await db.query(
    `SELECT id, defender_squad_id, status, source, submitted_by, notes,
            created_at, reviewed_at, reviewed_by
     FROM counters ${whereSql}
     ORDER BY created_at DESC, id DESC`,
    params
  );
  if (counters.length === 0) return [];

  const { rows: recs } = await db.query(
    `SELECT counter_id, counter_squad_id, rank, notes, seen_count, win_rate, avg_banners, stats_updated_at
     FROM counter_recommendations
     WHERE counter_id = ANY($1::int[])
     ORDER BY counter_id, rank ASC`,
    [counters.map((c) => c.id)]
  );

  const squadIds = new Set(counters.map((c) => c.defender_squad_id));
  for (const rec of recs) squadIds.add(rec.counter_squad_id);
  const squads = await getSquads([...squadIds]);

  const recsByCounter = new Map();
  for (const rec of recs) {
    if (!recsByCounter.has(rec.counter_id)) recsByCounter.set(rec.counter_id, []);
    recsByCounter.get(rec.counter_id).push({
      rank: rec.rank,
      notes: rec.notes,
      seen_count: rec.seen_count,
      win_rate: rec.win_rate,
      avg_banners: rec.avg_banners,
      stats_updated_at: rec.stats_updated_at,
      ...squads.get(rec.counter_squad_id),
    });
  }

  // recommended_squads come back best first: `rank` is the recommended
  // position (what the overlay shows), `manual_rank` the entered order.
  return counters.map(({ defender_squad_id, ...counter }) => ({
    ...counter,
    defender: squads.get(defender_squad_id),
    recommended_squads: rankRecommendations(recsByCounter.get(counter.id) || []),
  }));
}

// The shape /lookup has always returned, which the Android app reads.
function toLookupShape(counter) {
  return {
    counter_id: counter.id,
    notes: counter.notes,
    recommended_squads: counter.recommended_squads,
  };
}

// "Best match": rank every saved defense team (with an approved counter
// entry) by how many of unitIds it contains, with a bonus when the leader
// (unitIds[0]) matches - opponents often run a known team with a member or
// two swapped. Returns the top `limit` with their counters.
async function matchDefense(unitIds, limit) {
  const { rows } = await db.query(
    `SELECT DISTINCT defender_squad_id FROM counters WHERE status = 'approved'`
  );
  const squads = await getSquads(rows.map((r) => r.defender_squad_id));

  const detected = new Set(unitIds);
  const LEADER_BONUS = 0.2;
  const scored = [];
  for (const squad of squads.values()) {
    const overlap = squad.units.filter((u) => detected.has(u.id)).length;
    const leaderMatch = squad.units.length > 0 && squad.units[0].id === unitIds[0];
    if (overlap < 2 && !leaderMatch) continue;

    const coverage = overlap / Math.max(squad.units.length, unitIds.length);
    scored.push({
      score: Math.round(((coverage + (leaderMatch ? LEADER_BONUS : 0)) / (1 + LEADER_BONUS)) * 1000) / 1000,
      exact: leaderMatch && overlap === squad.units.length && overlap === unitIds.length,
      leader_match: leaderMatch,
      overlap,
      defender: squad,
    });
  }
  scored.sort((a, b) => b.score - a.score || b.overlap - a.overlap);
  const top = scored.slice(0, limit);

  const counters = top.length
    ? await loadCounters(
        "WHERE status = 'approved' AND defender_squad_id = ANY($1::int[])",
        [top.map((m) => m.defender.id)]
      )
    : [];
  const countersBySquad = new Map();
  for (const counter of counters) {
    const key = counter.defender.id;
    if (!countersBySquad.has(key)) countersBySquad.set(key, []);
    countersBySquad.get(key).push(toLookupShape(counter));
  }
  return top.map((m) => ({ ...m, counters: countersBySquad.get(m.defender.id) || [] }));
}

module.exports = { loadCounters, toLookupShape, matchDefense };
