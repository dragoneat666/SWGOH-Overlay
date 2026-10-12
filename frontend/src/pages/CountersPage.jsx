import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { counterMatches } from "../unitSearch.js";
import SquadView from "../components/SquadView.jsx";
import Icon from "../components/Icon.jsx";

const SORTS = {
  leader: {
    label: "A-Z",
    compare: (a, b) => leaderName(a).localeCompare(leaderName(b)),
  },
  newest: {
    label: "Newest",
    compare: (a, b) => new Date(b.created_at) - new Date(a.created_at),
  },
};

function leaderName(counter) {
  return counter.defender.units[0] ? counter.defender.units[0].name : "";
}

// Remembered per browser so the list opens the way you left it.
function savedSort() {
  try {
    return SORTS[localStorage.getItem("counters-sort")] ? localStorage.getItem("counters-sort") : "leader";
  } catch {
    return "leader";
  }
}

export default function CountersPage() {
  const [counters, setCounters] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(savedSort);

  useEffect(() => {
    api("/counters?status=approved")
      .then(setCounters)
      .catch((err) => setError(err.message));
  }, []);

  const shown = useMemo(() => {
    if (!counters) return [];
    return counters.filter((c) => counterMatches(c, query)).sort(SORTS[sort].compare);
  }, [counters, query, sort]);

  function changeSort(value) {
    setSort(value);
    try {
      localStorage.setItem("counters-sort", value);
    } catch {
      // not remembered - fine
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Counters</h1>
        <Link to="/counters/new" className="btn primary">
          <Icon name="plus" size={18} /> New counter
        </Link>
      </div>

      <div className="toolbar">
        <div className="unit-search grow">
          <Icon name="search" size={18} />
          <input
            type="search"
            value={query}
            placeholder="Find a team (e.g. SLKR)"
            aria-label="Search counters"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="segmented" role="group" aria-label="Sort">
          {Object.entries(SORTS).map(([key, s]) => (
            <button key={key} className={sort === key ? "on" : ""} onClick={() => changeSort(key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-text">Couldn't load counters: {error}</p>}
      {!counters && !error && <p className="muted">Loading…</p>}

      {counters && counters.length === 0 && (
        <div className="empty card">
          <h2>No counters yet</h2>
          <p className="muted">
            Add the defense teams you run into in GAC and the squads that beat them. The overlay app
            shows these when you're facing that team.
          </p>
          <Link to="/counters/new" className="btn primary">
            <Icon name="plus" size={18} /> Add your first counter
          </Link>
        </div>
      )}

      {counters && counters.length > 0 && (
        <p className="muted small">
          {shown.length === counters.length
            ? `${counters.length} defense team${counters.length === 1 ? "" : "s"}`
            : `${shown.length} of ${counters.length} defense teams`}
        </p>
      )}

      <ul className="counter-list">
        {shown.map((counter) => (
          <li key={counter.id}>
            <Link className="card counter-card" to={`/counters/${counter.id}`}>
              <div className="counter-defender">
                <span className="eyebrow">Defense</span>
                <SquadView squad={counter.defender} size={40} />
                {counter.notes && <p className="notes">{counter.notes}</p>}
              </div>
              <ol className="counter-recs">
                {counter.recommended_squads.map((squad) => (
                  <li key={squad.rank}>
                    <span className="rank">#{squad.rank}</span>
                    <div className="grow">
                      <SquadView squad={squad} size={30} />
                      {squad.notes && <p className="notes">{squad.notes}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
