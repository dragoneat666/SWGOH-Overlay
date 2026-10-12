import { test } from "node:test";
import assert from "node:assert/strict";
import { initials, searchUnits, counterMatches } from "./unitSearch.js";

const units = [
  { id: 1, name: "Supreme Leader Kylo Ren", definition_id: "SUPREMELEADERKYLOREN", is_ship: false },
  { id: 2, name: "Kylo Ren", definition_id: "KYLOREN", is_ship: false },
  { id: 3, name: "Kylo Ren (Unmasked)", definition_id: "KYLORENUNMASKED", is_ship: false },
  { id: 4, name: "Jedi Master Kenobi", definition_id: "JEDIMASTERKENOBI", is_ship: false },
  { id: 5, name: "Jedi Master Luke Skywalker", definition_id: "JEDIMASTERLUKESKYWALKER", is_ship: false },
  { id: 6, name: "Padmé Amidala", definition_id: "PADMEAMIDALA", is_ship: false },
  { id: 7, name: "Executor", definition_id: "CAPITALEXECUTOR", is_ship: true },
  { id: 8, name: "CC-2224 \"Cody\"", definition_id: "CC2224", is_ship: false },
];

test("initials helper", () => {
  assert.equal(initials("Supreme Leader Kylo Ren"), "slkr");
  assert.equal(initials('CC-2224 "Cody"'), "c2c");
});

test("prefix matches beat initials beat substrings", () => {
  const names = searchUnits(units, "kylo").map((u) => u.name);
  assert.deepEqual(names, ["Kylo Ren", "Kylo Ren (Unmasked)", "Supreme Leader Kylo Ren"]);
});

test("initials", () => {
  assert.deepEqual(searchUnits(units, "SLKR").map((u) => u.id), [1]);
  assert.deepEqual(searchUnits(units, "jmk").map((u) => u.id), [4]);
  // JML is how players say Jedi Master Luke Skywalker
  assert.deepEqual(searchUnits(units, "JML").map((u) => u.id), [5]);
});

test("accents and definition ids", () => {
  assert.deepEqual(searchUnits(units, "padme").map((u) => u.id), [6]);
  assert.deepEqual(searchUnits(units, "capitalexec").map((u) => u.id), [7]);
  assert.deepEqual(searchUnits(units, "cody").map((u) => u.id), [8]);
});

test("exclude and kind filters", () => {
  assert.deepEqual(searchUnits(units, "kylo", { exclude: new Set([2]) }).map((u) => u.id), [3, 1]);
  assert.deepEqual(searchUnits(units, "e", { kind: "ships" }).map((u) => u.id), [7]);
  assert.equal(searchUnits(units, "   ").length, 0);
});

test("counterMatches looks at every squad and the notes", () => {
  const counter = {
    notes: "Bring Wat",
    defender: { units: [units[0], units[1]] },
    recommended_squads: [{ notes: "kill hux first", units: [units[4]] }],
  };
  assert.ok(counterMatches(counter, "slkr"));
  assert.ok(counterMatches(counter, "luke"));
  assert.ok(counterMatches(counter, "hux"));
  assert.ok(counterMatches(counter, ""));
  assert.ok(!counterMatches(counter, "padme"));
});
