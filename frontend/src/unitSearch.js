// Unit search for the squad builder and the lists. Matches the way players
// actually refer to units: by name fragment ("kylo"), or by initials
// ("SLKR" -> Supreme Leader Kylo Ren, "JMK" -> Jedi Master Kenobi).

export function fold(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function initials(name) {
  return fold(name)
    .split(/[\s\-()"'.]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
}

// Lower is better; null = no match.
export function matchRank(unit, query) {
  const q = fold(query).trim();
  if (!q) return null;
  const name = fold(unit.name);
  if (name.startsWith(q)) return 0;
  if (!q.includes(" ") && q.length >= 2 && initials(unit.name).startsWith(q)) return 1;
  if (name.split(/[\s\-()]+/).some((word) => word.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  if (unit.definition_id && fold(unit.definition_id).includes(q.replace(/\s+/g, ""))) return 4;
  return null;
}

export function searchUnits(units, query, { exclude = new Set(), limit = 12, kind = "all" } = {}) {
  const results = [];
  for (const unit of units) {
    if (exclude.has(unit.id)) continue;
    if (kind === "ships" && !unit.is_ship) continue;
    if (kind === "characters" && unit.is_ship) continue;
    const rank = matchRank(unit, query);
    if (rank !== null) results.push({ unit, rank });
  }
  results.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.unit.name.length - b.unit.name.length ||
      a.unit.name.localeCompare(b.unit.name)
  );
  return results.slice(0, limit).map((r) => r.unit);
}

// For the counters list search box: does any unit in the entry (defender or
// any counter squad), or any of its notes, match?
export function counterMatches(counter, query) {
  const q = fold(query).trim();
  if (!q) return true;
  const squads = [counter.defender, ...counter.recommended_squads];
  if (squads.some((s) => s && s.units.some((u) => matchRank(u, q) !== null))) return true;
  const notes = [counter.notes, ...counter.recommended_squads.map((s) => s.notes)];
  return notes.some((n) => n && fold(n).includes(q));
}
