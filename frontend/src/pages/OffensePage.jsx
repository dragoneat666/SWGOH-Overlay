import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import SquadBuilder from "../components/SquadBuilder.jsx";
import SquadView from "../components/SquadView.jsx";
import StatsLine from "../components/StatsLine.jsx";
import Icon from "../components/Icon.jsx";

// "What does this squad beat?" - build an attacking squad (leader + up to 4)
// and see which saved defense teams it has a record against. Below that,
// the squads that counter the most defense teams in your data.
export default function OffensePage() {
  const [squad, setSquad] = useState([]);
  const [results, setResults] = useState(null); // null = not searched yet
  const [searchedFor, setSearchedFor] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [popular, setPopular] = useState(null);

  useEffect(() => {
    api("/counters/offense/popular?limit=12")
      .then((res) => setPopular(res.squads))
      .catch(() => setPopular([]));
  }, []);

  const search = useCallback(async (ids) => {
    if (ids.length === 0) return;
    setSearching(true);
    setError(null);
    try {
      const res = await api(`/counters/offense?unit_ids=${ids.join(",")}`);
      setResults(res.results);
      setSearchedFor(ids.join(","));
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }, []);

  function pickPopular(s) {
    const ids = s.units.map((u) => u.id);
    setSquad(ids);
    search(ids);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const stale = results && searchedFor !== squad.join(",");

  return (
    <div className="page">
      <div className="page-head">
        <h1>Offense</h1>
      </div>
      <p className="muted page-intro">
        Build the squad you want to attack with to see which defense teams it beats, and how often it wins.
      </p>

      <section className="card">
        <SquadBuilder value={squad} onChange={setSquad} label="Your squad (leader first)" max={5} />
        <div className="row offense-actions">
          <button className="btn primary" disabled={squad.length === 0 || searching} onClick={() => search(squad)}>
            <Icon name="search" size={18} /> {searching ? "Searching…" : "Search"}
          </button>
          {squad.length > 0 && (
            <button
              className="btn ghost"
              onClick={() => {
                setSquad([]);
                setResults(null);
              }}
            >
              Clear
            </button>
          )}
          <span className="muted small grow">
            {squad.length === 0
              ? "Start with the leader."
              : squad.length < 5
                ? "Add more members, or search now - fewer units also finds the full squads they're part of."
                : "Full squad."}
          </span>
        </div>
      </section>

      {error && <p className="error-text">{error}</p>}

      {results && (
        <section className="offense-results">
          <h2 className="section-title">
            {results.length === 0
              ? "No recorded wins for this squad yet"
              : `Beats ${new Set(results.map((r) => r.defender.id)).size} defense team${
                  new Set(results.map((r) => r.defender.id)).size === 1 ? "" : "s"
                }`}
            {stale && <span className="muted small"> - squad changed, search again</span>}
          </h2>
          {results.length === 0 && (
            <p className="muted">
              This squad isn't listed as a counter for any saved defense team. Try fewer units (leader + 1-2) to
              find the full squads it's part of.
            </p>
          )}
          <ul className="counter-list">
            {results.map((r) => (
              <li key={`${r.counter_id}-${r.squad.id}`}>
                <Link className="card offense-result" to={`/counters/${r.counter_id}`}>
                  <div className="offense-vs">
                    <span className="eyebrow">Beats this defense</span>
                    <SquadView squad={r.defender} size={34} />
                  </div>
                  <div className="offense-stats">
                    <StatsLine squad={r} />
                    {!r.exact && (
                      <div className="offense-full">
                        <span className="eyebrow">Full squad used</span>
                        <SquadView squad={r.squad} size={26} />
                      </div>
                    )}
                    {r.notes && <p className="notes">{r.notes}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="section-title">Popular squads</h2>
      <p className="muted small">
        The attack squads that counter the most defense teams in your data, with their average win rate.
      </p>
      {!popular && <p className="muted">Loading…</p>}
      {popular && popular.length === 0 && (
        <p className="muted">
          Nothing yet - import some counters (with win rates) on the <Link to="/import">Import</Link> page.
        </p>
      )}
      <ul className="counter-list">
        {(popular || []).map((s) => (
          <li key={s.id} className="card popular-squad">
            <div className="grow">
              <SquadView squad={s} size={32} />
              <div className="stats-line">
                <span>
                  Beats <strong>{s.defense_teams}</strong> defense team{s.defense_teams === 1 ? "" : "s"}
                </span>
                {s.avg_win_rate != null && (
                  <span>
                    <strong>{s.avg_win_rate}%</strong> avg win
                  </span>
                )}
                {s.avg_banners != null && (
                  <span>
                    <strong>{s.avg_banners}</strong> ⚑ avg
                  </span>
                )}
              </div>
            </div>
            <button className="btn small" onClick={() => pickPopular(s)}>
              See matchups
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
