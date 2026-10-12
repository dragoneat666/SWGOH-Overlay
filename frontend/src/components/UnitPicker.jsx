import { useMemo, useState } from "react";
import { useUnits } from "../units.jsx";
import { searchUnits } from "../unitSearch.js";
import UnitAvatar from "./UnitAvatar.jsx";
import Icon from "./Icon.jsx";

// Search box + results for answering "who is this?" - name or initials.
export default function UnitPicker({ onPick, autoFocus = false, placeholder = "Who is this? Name or initials" }) {
  const { units } = useUnits();
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchUnits(units, query, { limit: 6 }), [units, query]);

  return (
    <div className="unit-picker">
      <div className="unit-search">
        <Icon name="search" size={18} />
        <input
          type="search"
          value={query}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck="false"
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              onPick(results[0]);
              setQuery("");
            }
          }}
        />
      </div>
      {query && (
        <ul className="results">
          {results.map((unit) => (
            <li key={unit.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(unit);
                  setQuery("");
                }}
              >
                <UnitAvatar unit={unit} size={28} />
                <span>{unit.name}</span>
                {unit.is_ship && <span className="tag">Ship</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="muted small no-results">No unit matches "{query}"</li>}
        </ul>
      )}
    </div>
  );
}
