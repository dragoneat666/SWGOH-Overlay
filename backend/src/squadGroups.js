// Groups attack squads into "the same team with the last slots swapped".
//
// Teams keep a core and vary the rest (Jedi Master Kenobi + Commander Ahsoka
// + Snips, then General Kenobi / Padmé / Mace / ...), so counting every
// exact squad separately splits a popular team into many small entries.
//
// Per leader: take the most-recorded squad still ungrouped; its core is the
// leader plus its CORE_MEMBERS members that show up most often across that
// leader's ungrouped squads; every ungrouped squad containing the whole core
// joins the group. Repeat until every squad is in a group. Any two squads in
// a group share at least 1 + CORE_MEMBERS units - the same "3 in common" bar
// the offense search uses for close variants.
const CORE_MEMBERS = 2;

/**
 * squads: [{ id, unitIds: [leader, ...members], records }]  (records = how
 *   many counter records use it; decides which squad seeds a group)
 * Returns [{ core: [unitIds, leader first], squadIds: [...] }].
 */
function groupByCore(squads) {
  const byLeader = new Map();
  for (const s of squads) {
    if (!byLeader.has(s.unitIds[0])) byLeader.set(s.unitIds[0], []);
    byLeader.get(s.unitIds[0]).push(s);
  }

  const groups = [];
  for (const leaderSquads of byLeader.values()) {
    let left = [...leaderSquads].sort((a, b) => b.records - a.records || a.id - b.id);
    while (left.length > 0) {
      // How often each member appears among this leader's ungrouped squads.
      const freq = new Map();
      for (const s of left) {
        for (const u of s.unitIds.slice(1)) freq.set(u, (freq.get(u) || 0) + s.records);
      }
      const seed = left[0];
      const members = seed.unitIds
        .slice(1)
        .map((u, i) => ({ u, i }))
        .sort((a, b) => freq.get(b.u) - freq.get(a.u) || a.i - b.i)
        .slice(0, CORE_MEMBERS)
        .sort((a, b) => a.i - b.i)
        .map((m) => m.u);
      const core = [seed.unitIds[0], ...members];
      const inGroup = left.filter((s) => core.every((u) => s.unitIds.includes(u)));
      groups.push({ core, squadIds: inGroup.map((s) => s.id) });
      left = left.filter((s) => !inGroup.includes(s));
    }
  }
  return groups;
}

module.exports = { groupByCore, CORE_MEMBERS };
