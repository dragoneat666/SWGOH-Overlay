import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useUnits } from "../units.jsx";
import { searchUnits } from "../unitSearch.js";
import UnitAvatar from "./UnitAvatar.jsx";
import Icon from "./Icon.jsx";

// Pick an ordered squad: type a name or initials, tap a result to add it.
// The first unit is the leader; any other unit can be promoted with the
// crown button. Once the squad has a character (or ship) in it, search only
// offers that kind, since squads never mix the two.
export default function SquadBuilder({ value, onChange, label, max = 8, autoFocus = false }) {
  const { units, byId } = useUnits();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const selected = value.map((id) => byId.get(id)).filter(Boolean);
  const kind = selected.length === 0 ? "all" : selected[0].is_ship ? "ships" : "characters";
  const results = useMemo(
    () => searchUnits(units, query, { exclude: new Set(value), kind, limit: 8 }),
    [units, query, value, kind]
  );
  const full = value.length >= max;

  function add(unit) {
    onChange([...value, unit.id]);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) add(results[active]);
    } else if (e.key === "Escape") {
      setQuery("");
    } else if (e.key === "Backspace" && !query && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="squad-builder">
      {label && (
        <div className="field-label">
          {label}
          <span className="muted">
            {value.length}/{max}
          </span>
        </div>
      )}

      {selected.length > 0 && (
        <ul className="chips">
          {selected.map((unit, i) => (
            <li key={unit.id} className={`chip${i === 0 ? " is-leader" : ""}`}>
              <UnitAvatar unit={unit} size={30} leader={i === 0} />
              <span className="chip-name">{unit.name}</span>
              {i === 0 ? (
                <span className="lead-tag">Lead</span>
              ) : (
                <button
                  type="button"
                  className="icon-btn"
                  title="Make leader"
                  aria-label={`Make ${unit.name} the leader`}
                  onClick={() => onChange([unit.id, ...value.filter((id) => id !== unit.id)])}
                >
                  <Icon name="crown" size={16} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                title="Remove"
                aria-label={`Remove ${unit.name}`}
                onClick={() => onChange(value.filter((id) => id !== unit.id))}
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {units.length === 0 ? (
        <p className="muted small">
          No units in the library yet - <Link to="/units">import or add them on the Units page</Link>.
        </p>
      ) : (
        !full && (
          <div className="unit-search">
            <Icon name="search" size={18} />
            <input
              ref={inputRef}
              type="search"
              value={query}
              autoFocus={autoFocus}
              enterKeyHint="done"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck="false"
              placeholder={
                value.length === 0 ? "Add leader - name or initials (e.g. SLKR)" : "Add another unit"
              }
              aria-label={label ? `Add unit to ${label}` : "Add unit"}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
        )
      )}

      {query && (
        <ul className="results" role="listbox">
          {results.map((unit, i) => (
            <li key={unit.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => add(unit)}
              >
                <UnitAvatar unit={unit} size={28} />
                <span>{unit.name}</span>
                {unit.is_ship && <span className="tag">Ship</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="muted small no-results">
              No {kind === "all" ? "units" : kind} match "{query}"
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
