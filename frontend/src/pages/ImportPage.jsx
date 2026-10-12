import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useUnits } from "../units.jsx";
import { useToast } from "../toast.jsx";
import { scanScreenshot } from "../scan/scanScreenshot.js";
import { identify, groupFaces } from "../../../shared/scan/faces.mjs";
import UnitAvatar from "../components/UnitAvatar.jsx";
import UnitPicker from "../components/UnitPicker.jsx";
import Icon from "../components/Icon.jsx";

// Import battle records from a screenshot of a swgoh.gg GAC counters list:
// faces are matched against known portraits, numbers are read with OCR,
// and you check everything before it's saved. Faces it doesn't know are
// asked about here (once per distinct face); "Ask me later" parks them in
// the To identify list instead.
export default function ImportPage() {
  const { byId, reload: reloadUnits } = useUnits();
  const toast = useToast();

  const [library, setLibrary] = useState(null);
  const [status, setStatus] = useState(null); // progress message while scanning
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [scan, setScan] = useState(null); // { rows } with slot.unitId / slot.group filled in
  const [groups, setGroups] = useState([]); // unknown faces: { key, image, fingerprint, unitId, count }
  const [deferred, setDeferred] = useState(false);
  const [defenseOnRight, setDefenseOnRight] = useState(true);
  const [included, setIncluded] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api("/portraits/library")
      .then(setLibrary)
      .catch((err) => setError(`Couldn't load known faces: ${err.message}`));
  }, []);

  const reset = () => {
    setScan(null);
    setGroups([]);
    setDeferred(false);
    setIncluded({});
    setResult(null);
    setError(null);
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
  };

  const handleImage = useCallback(
    async (blob) => {
      if (!blob || !blob.type.startsWith("image/")) {
        setError("That isn't an image - paste or pick a screenshot.");
        return;
      }
      if (!library) return;
      reset();
      setPreview(URL.createObjectURL(blob));
      try {
        const { rows } = await scanScreenshot(blob, setStatus);
        if (rows.length === 0) {
          setError("Couldn't find any squad rows. Crop the screenshot to the list of rows (portraits + Seen / Win % / Avg).");
          return;
        }

        // Match every face; group the unknown ones so each is asked once.
        const unknown = [];
        for (const row of rows) {
          for (const slot of [...row.left, ...row.right]) {
            if (slot.empty) continue;
            slot.unitId = identify(slot.fingerprint, library).unitId;
            if (slot.unitId == null) unknown.push(slot);
          }
        }
        const grouped = groupFaces(unknown.map((s) => s.fingerprint)).map((members, i) => {
          members.forEach((m) => {
            unknown[m].group = i;
          });
          const first = unknown[members[0]];
          return { key: i, image: first.image, fingerprint: first.fingerprint, unitId: null, count: members.length };
        });

        setGroups(grouped);
        setScan({ rows });
        setIncluded(Object.fromEntries(rows.map((_, i) => [i, true])));
      } catch (err) {
        setError(`Couldn't read that screenshot: ${err.message}`);
      } finally {
        setStatus(null);
      }
    },
    [library]
  );

  // Ctrl+V anywhere on the page.
  useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        handleImage(item.getAsFile());
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleImage]);

  const slotUnitId = (slot) => (slot.unitId != null ? slot.unitId : slot.group != null ? groups[slot.group]?.unitId ?? null : null);

  // Each row as the import endpoint wants it, plus why it can't be saved yet.
  const rows = useMemo(() => {
    if (!scan) return [];
    return scan.rows.map((row, i) => {
      const attack = defenseOnRight ? row.left : row.right;
      const defense = defenseOnRight ? row.right : row.left;
      const ids = (slots) => slots.filter((s) => !s.empty).map(slotUnitId);
      const attackIds = ids(attack);
      const defenseIds = ids(defense);
      let problem = null;
      if ([...attackIds, ...defenseIds].some((id) => id == null)) problem = "Has faces nobody has identified yet";
      else if (attackIds.length === 0 || defenseIds.length === 0) problem = "A squad is empty";
      else if (new Set(attackIds).size !== attackIds.length || new Set(defenseIds).size !== defenseIds.length) {
        problem = "The same unit appears twice in a squad - check the faces";
      }
      return { index: i, attack, defense, attackIds, defenseIds, stats: row.stats, problem };
    });
  }, [scan, groups, defenseOnRight]);

  const pending = groups.filter((g) => g.unitId == null);
  const savable = rows.filter((r) => !r.problem && included[r.index]);

  async function identifyGroup(group, unit) {
    try {
      const face = await api("/portraits", {
        method: "POST",
        body: { unit_id: unit.id, image: group.image, fingerprint: group.fingerprint, source: "swgoh.gg screenshot" },
      });
      setLibrary((lib) => [...(lib || []), { id: face.id, unit_id: unit.id, fingerprint: group.fingerprint }]);
      setGroups((gs) => gs.map((g) => (g.key === group.key ? { ...g, unitId: unit.id } : g)));
      reloadUnits();
    } catch (err) {
      toast(`Couldn't save that face: ${err.message}`, "error");
    }
  }

  async function askLater() {
    try {
      const res = await api("/portraits/unidentified", {
        method: "POST",
        body: { items: pending.map((g) => ({ image: g.image, fingerprint: g.fingerprint, source: "swgoh.gg screenshot" })) },
      });
      setDeferred(true);
      window.dispatchEvent(new Event("faces-changed")); // nav badge
      toast(`${res.added} face${res.added === 1 ? "" : "s"} added to the To identify list`);
    } catch (err) {
      toast(`Couldn't queue the faces: ${err.message}`, "error");
    }
  }

  function updateStat(rowIndex, key, value) {
    setScan((s) => ({
      rows: s.rows.map((row, i) =>
        i === rowIndex ? { ...row, stats: { ...row.stats, [key]: value === "" ? null : Number(value) } } : row
      ),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await api("/counters/import", {
        method: "POST",
        body: {
          rows: savable.map((r) => ({
            defender_unit_ids: r.defenseIds,
            counter_unit_ids: r.attackIds,
            seen_count: r.stats.seen_count,
            win_rate: r.stats.win_rate,
            avg_banners: r.stats.avg_banners,
          })),
        },
      });
      setResult(res);
      toast(`Saved ${savable.length} row${savable.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast(`Import failed: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  const faceCell = (slot, key) => {
    if (slot.empty) return <span key={key} className="slot-empty" aria-hidden="true" />;
    const id = slotUnitId(slot);
    const unit = id != null ? byId.get(id) : null;
    if (unit) return <UnitAvatar key={key} unit={unit} size={36} />;
    return (
      <span key={key} className="face unknown" title="Not identified yet">
        <img src={slot.image} alt="" />
        <span className="face-badge">?</span>
      </span>
    );
  };

  const squadNames = (slots) =>
    slots
      .filter((s) => !s.empty)
      .map((s) => byId.get(slotUnitId(s))?.name ?? "?")
      .join(", ");

  return (
    <div className="page">
      <div className="page-head">
        <h1>Import screenshot</h1>
        {scan && (
          <button className="btn" onClick={reset}>
            Start over
          </button>
        )}
      </div>

      {!scan && !status && (
        <>
          <label
            className="dropzone card"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleImage(e.dataTransfer.files[0]);
            }}
          >
            <Icon name="upload" size={28} />
            <strong>Paste (Ctrl+V), drop, or pick a screenshot</strong>
            <span className="muted small">
              A swgoh.gg GAC counters list: the rows between two ads, with the portraits and Seen / Win % / Avg.
            </span>
            <input type="file" accept="image/*" hidden onChange={(e) => handleImage(e.target.files[0])} />
          </label>
          {!library && !error && <p className="muted small">Loading known faces…</p>}
        </>
      )}

      {status && (
        <div className="card scanning">
          {preview && <img src={preview} alt="" className="shot-preview" />}
          <p>{status}</p>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {scan && (
        <>
          {pending.length > 0 && !deferred && (
            <section className="card faces-panel">
              <div className="section-head">
                <h2>Who are these? ({pending.length})</h2>
                <button className="btn small" onClick={askLater}>
                  Ask me later
                </button>
              </div>
              <p className="muted small">
                Each answer teaches the app this face - next time it's recognized automatically.
              </p>
              <ul className="face-list">
                {pending.map((g) => (
                  <li key={g.key} className="face-row">
                    <span className="face big">
                      <img src={g.image} alt="Unidentified portrait" />
                    </span>
                    <div className="grow">
                      <span className="muted small">
                        Appears {g.count} time{g.count === 1 ? "" : "s"} in this screenshot
                      </span>
                      <UnitPicker onPick={(unit) => identifyGroup(g, unit)} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {pending.length > 0 && deferred && (
            <p className="warning-text">
              {pending.length} face{pending.length === 1 ? " is" : "s are"} on the <Link to="/faces">To identify</Link>{" "}
              list. Rows using them are skipped - identify them, then import this screenshot again.
            </p>
          )}

          <div className="toolbar">
            <span className="muted small grow">
              {rows.length} row{rows.length === 1 ? "" : "s"} found · {savable.length} ready to save
            </span>
            <label className="check">
              <input type="checkbox" checked={defenseOnRight} onChange={(e) => setDefenseOnRight(e.target.checked)} />
              Defense is on the right
            </label>
          </div>

          <ul className="import-rows">
            {rows.map((r) => (
              <li key={r.index} className={`card import-row${r.problem ? " has-problem" : ""}`}>
                <label className="check row-check">
                  <input
                    type="checkbox"
                    disabled={!!r.problem}
                    checked={!r.problem && !!included[r.index]}
                    onChange={(e) => setIncluded((inc) => ({ ...inc, [r.index]: e.target.checked }))}
                  />
                  <span className="small muted">Row {r.index + 1}</span>
                </label>
                <div className="import-squad">
                  <span className="eyebrow">Attack</span>
                  <div className="squad-avatars">{r.attack.map((s, i) => faceCell(s, i))}</div>
                  <span className="small">{squadNames(r.attack)}</span>
                </div>
                {/* Seen is still read and saved (it weighs the ranking) but not shown. */}
                <div className="import-stats">
                  <label>
                    <span className="eyebrow">Win %</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={r.stats.win_rate ?? ""}
                      className={r.stats.win_rate == null ? "invalid" : ""}
                      onChange={(e) => updateStat(r.index, "win_rate", e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="eyebrow">Avg ⚑</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={r.stats.avg_banners ?? ""}
                      className={r.stats.avg_banners == null ? "invalid" : ""}
                      onChange={(e) => updateStat(r.index, "avg_banners", e.target.value)}
                    />
                  </label>
                </div>
                <div className="import-squad">
                  <span className="eyebrow">Defense</span>
                  <div className="squad-avatars">{r.defense.map((s, i) => faceCell(s, i))}</div>
                  <span className="small">{squadNames(r.defense)}</span>
                </div>
                {r.problem && <p className="warning-text small">{r.problem}</p>}
              </li>
            ))}
          </ul>

          <div className="form-actions">
            {result ? (
              <div className="row">
                <span className="grow">
                  Saved: {result.defense_teams_created} new defense team{result.defense_teams_created === 1 ? "" : "s"},{" "}
                  {result.counters_added} counter{result.counters_added === 1 ? "" : "s"} added,{" "}
                  {result.counters_updated} updated.
                </span>
                <Link to="/" className="btn">
                  View counters
                </Link>
                <button className="btn primary" onClick={reset}>
                  Import another
                </button>
              </div>
            ) : (
              <div className="row">
                <span className="grow muted small">
                  Counters are ranked automatically from these stats.
                </span>
                <button className="btn primary" disabled={saving || savable.length === 0} onClick={save}>
                  {saving ? "Saving…" : `Save ${savable.length} row${savable.length === 1 ? "" : "s"}`}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
