import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useUnits } from "../units.jsx";
import { useToast } from "../toast.jsx";
import SquadBuilder from "../components/SquadBuilder.jsx";
import Icon from "../components/Icon.jsx";

let keySeq = 0;
// Stats are kept as the strings typed into the inputs ("" = none).
function newSquad(unitIds = [], notes = "", stats = {}) {
  keySeq += 1;
  const str = (v) => (v == null ? "" : String(v));
  return {
    key: keySeq,
    unitIds,
    notes,
    seen: str(stats.seen_count),
    win: str(stats.win_rate),
    banners: str(stats.avg_banners),
  };
}

const hasStats = (s) => s.seen !== "" || s.win !== "" || s.banners !== "";

export default function CounterEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const { loading: unitsLoading, reload: reloadUnits } = useUnits();

  const [defender, setDefender] = useState([]);
  const [notes, setNotes] = useState("");
  const [squads, setSquads] = useState(() => [newSquad()]);
  const [loaded, setLoaded] = useState(isNew);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [existingId, setExistingId] = useState(null);
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setDefender([]);
    setNotes("");
    setSquads([newSquad()]);
    setError(null);
    setExistingId(null);
  }

  useEffect(() => {
    if (isNew) {
      resetForm();
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    api(`/counters/${id}`)
      .then((counter) => {
        if (cancelled) return;
        setDefender(counter.defender.units.map((u) => u.id));
        setNotes(counter.notes || "");
        setSquads(
          counter.recommended_squads.map((s) => newSquad(s.units.map((u) => u.id), s.notes || "", s))
        );
        setLoaded(true);
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  // Warn as soon as the defense team matches one that already has an entry,
  // instead of only when saving.
  const defenderKey = defender.join(",");
  useEffect(() => {
    if (!loaded || defender.length === 0) {
      setExistingId(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api(`/counters/lookup?defender_unit_ids=${defenderKey}`)
        .then((res) => {
          if (cancelled) return;
          const other = res.counters.find((c) => String(c.counter_id) !== String(id));
          setExistingId(other ? other.counter_id : null);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [defenderKey, loaded, id]);

  function updateSquad(key, changes) {
    setSquads((list) => list.map((s) => (s.key === key ? { ...s, ...changes } : s)));
  }

  function moveSquad(index, delta) {
    setSquads((list) => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(index + delta, 0, moved);
      return next;
    });
  }

  async function save(addAnother) {
    setError(null);
    const kept = squads.filter((s) => s.unitIds.length > 0 || s.notes.trim() || hasStats(s));
    if (defender.length === 0) return setError("Pick the defense team first.");
    if (kept.length === 0) return setError("Add at least one counter squad.");
    const emptyIndex = kept.findIndex((s) => s.unitIds.length === 0);
    if (emptyIndex >= 0) return setError(`Counter #${emptyIndex + 1} has notes or stats but no units.`);

    const body = {
      defender_unit_ids: defender,
      notes,
      counter_squads: kept.map((s) => ({
        unit_ids: s.unitIds,
        notes: s.notes,
        seen_count: s.seen,
        win_rate: s.win,
        avg_banners: s.banners,
      })),
    };

    setSaving(true);
    try {
      if (isNew) {
        await api("/counters", { method: "POST", body });
      } else {
        await api(`/counters/${id}`, { method: "PUT", body });
      }
      reloadUnits();
      toast(isNew ? "Counter added" : "Counter saved");
      if (addAnother) {
        resetForm();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        navigate("/");
      }
    } catch (err) {
      if (err.status === 409 && err.body.existing_id) setExistingId(err.body.existing_id);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this counter entry? This can't be undone.")) return;
    try {
      await api(`/counters/${id}`, { method: "DELETE" });
      reloadUnits();
      toast("Counter deleted");
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <p className="error-text">Couldn't load that counter: {loadError}</p>
        <Link to="/">Back to counters</Link>
      </div>
    );
  }
  if (!loaded || unitsLoading) return <p className="page muted">Loading…</p>;

  return (
    <div className="page editor">
      <div className="page-head">
        <Link to="/" className="back-link">
          <Icon name="back" size={18} /> Counters
        </Link>
        <h1>{isNew ? "New counter" : "Edit counter"}</h1>
      </div>

      <section className="card">
        <h2>Defense team</h2>
        <p className="muted small">The team you're up against. Leader first.</p>
        <SquadBuilder value={defender} onChange={setDefender} autoFocus={isNew} />
        {existingId && (
          <p className="warning-text">
            This team already has a counter entry.{" "}
            <Link to={`/counters/${existingId}`}>Open it</Link> to add squads there instead.
          </p>
        )}
        <label className="field">
          <span className="field-label">Notes about this team (optional)</span>
          <input
            type="text"
            value={notes}
            placeholder="e.g. usually has Wat Tambor, high speed"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </section>

      <h2 className="section-title">Counters</h2>
      <p className="muted small">
        Ranked automatically from their stats (win rate, how often they've been seen, average banners). Squads
        without stats come after those, in the order below.
      </p>

      {squads.map((squad, i) => (
        <section className="card" key={squad.key}>
          <div className="squad-head">
            <span className="rank">#{i + 1}</span>
            <span className="grow" />
            <button
              type="button"
              className="icon-btn"
              disabled={i === 0}
              aria-label="Move up"
              title="Move up"
              onClick={() => moveSquad(i, -1)}
            >
              <Icon name="up" />
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={i === squads.length - 1}
              aria-label="Move down"
              title="Move down"
              onClick={() => moveSquad(i, 1)}
            >
              <Icon name="down" />
            </button>
            <button
              type="button"
              className="icon-btn danger"
              disabled={squads.length === 1}
              aria-label="Remove this counter squad"
              title="Remove"
              onClick={() => setSquads((list) => list.filter((s) => s.key !== squad.key))}
            >
              <Icon name="trash" />
            </button>
          </div>
          <SquadBuilder value={squad.unitIds} onChange={(ids) => updateSquad(squad.key, { unitIds: ids })} />
          <label className="field">
            <span className="field-label">Notes (optional)</span>
            <input
              type="text"
              value={squad.notes}
              placeholder="e.g. kill Reva first, needs Jabba ult"
              onChange={(e) => updateSquad(squad.key, { notes: e.target.value })}
            />
          </label>
          <div className="stats-inputs">
            <label className="field">
              <span className="field-label">Seen</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={squad.seen}
                placeholder="-"
                onChange={(e) => updateSquad(squad.key, { seen: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Win %</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.1"
                value={squad.win}
                placeholder="-"
                onChange={(e) => updateSquad(squad.key, { win: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Avg ⚑</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={squad.banners}
                placeholder="-"
                onChange={(e) => updateSquad(squad.key, { banners: e.target.value })}
              />
            </label>
          </div>
        </section>
      ))}

      <button type="button" className="btn block dashed" onClick={() => setSquads((l) => [...l, newSquad()])}>
        <Icon name="plus" size={18} /> Add another counter squad
      </button>

      <div className="form-actions">
        {error && <p className="error-text">{error}</p>}
        <div className="row">
          {!isNew && (
            <button type="button" className="btn danger" onClick={remove} disabled={saving}>
              Delete
            </button>
          )}
          <span className="grow" />
          {isNew && (
            <button type="button" className="btn" onClick={() => save(true)} disabled={saving}>
              Save &amp; add another
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => save(false)} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
