import { useEffect, useMemo, useState } from "react";
import { api, imageUrl } from "../api.js";
import { useUnits } from "../units.jsx";
import { useToast } from "../toast.jsx";
import { matchRank } from "../unitSearch.js";
import UnitAvatar from "../components/UnitAvatar.jsx";
import Modal from "../components/Modal.jsx";
import Icon from "../components/Icon.jsx";
import UnitPicker from "../components/UnitPicker.jsx";

const FILTERS = {
  all: { label: "All", test: () => true },
  characters: { label: "Characters", test: (u) => !u.is_ship },
  ships: { label: "Ships", test: (u) => u.is_ship },
  nopic: { label: "No picture", test: (u) => !u.image_path },
};

export default function UnitsPage() {
  const { units, byId, loading, error, reload } = useUnits();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  // Unit id being edited, "new" for a new one. Looked up in the live list so
  // the dialog sees changes (e.g. its picture) after a reload.
  const [editing, setEditing] = useState(null);
  const editingUnit = editing === "new" ? {} : editing != null ? byId.get(editing) : null;
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const shown = useMemo(
    () =>
      units.filter((u) => FILTERS[filter].test(u) && (!query.trim() || matchRank(u, query) !== null)),
    [units, query, filter]
  );

  async function importFromGame() {
    setImporting(true);
    setImportResult(null);
    try {
      const result = await api("/units/import-game-data", { method: "POST" });
      setImportResult(result);
      await reload();
      toast(`Imported ${result.total} units (${result.created} new)`);
    } catch (err) {
      toast(`Import failed: ${err.message}`, "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Units</h1>
        <div className="row">
          <button className="btn" onClick={importFromGame} disabled={importing}>
            <Icon name="download" size={18} />
            {importing ? "Importing…" : "Import from game"}
          </button>
          <button className="btn primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={18} /> Add unit
          </button>
        </div>
      </div>

      {importing && (
        <p className="muted small">
          Pulling the full character and ship list from the game via Comlink - this can take a minute.
        </p>
      )}
      {importResult && (
        <div className="card info-card">
          <strong>Import done:</strong> {importResult.characters} characters and {importResult.ships} ships
          in the game - {importResult.created} added, {importResult.updated} updated,{" "}
          {importResult.unchanged} already up to date.
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setImportResult(null)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="unit-search grow">
          <Icon name="search" size={18} />
          <input
            type="search"
            value={query}
            placeholder="Search units"
            aria-label="Search units"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="segmented" role="group" aria-label="Filter">
          {Object.entries(FILTERS).map(([key, f]) => (
            <button key={key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-text">Couldn't load units: {error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && units.length === 0 && (
        <div className="empty card">
          <h2>No units yet</h2>
          <p className="muted">
            <strong>Import from game</strong> pulls every character and ship (names and IDs) from the
            game's own data through your Comlink container. You can also add units by hand.
          </p>
        </div>
      )}

      {units.length > 0 && (
        <p className="muted small">
          {shown.length === units.length ? `${units.length} units` : `${shown.length} of ${units.length} units`}
        </p>
      )}

      <ul className="unit-list">
        {shown.map((unit) => (
          <li key={unit.id}>
            <button className="unit-row" onClick={() => setEditing(unit.id)}>
              <UnitAvatar unit={unit} size={40} />
              <span className="grow">
                <span className="unit-name">{unit.name}</span>
                <span className="muted small mono">{unit.definition_id || "no game ID"}</span>
              </span>
              {unit.is_ship && <span className="tag">Ship</span>}
              {unit.face_count > 0 && (
                <span className="tag" title="Faces recognized as this unit">
                  {unit.face_count} face{unit.face_count === 1 ? "" : "s"}
                </span>
              )}
              {unit.used_in_counters && <span className="tag accent">In counters</span>}
            </button>
          </li>
        ))}
      </ul>

      {editingUnit && (
        <UnitDialog
          // Remount when the picture changes (e.g. a face was moved away) so
          // the dialog shows the current one.
          key={`${editingUnit.id ?? "new"}-${editingUnit.image_path ?? ""}`}
          unit={editingUnit}
          onClose={() => setEditing(null)}
          onFacesChanged={async (message) => {
            await reload();
            toast(message);
          }}
          onSaved={async (message) => {
            setEditing(null);
            await reload();
            toast(message);
          }}
        />
      )}
    </div>
  );
}

function UnitDialog({ unit, onClose, onSaved, onFacesChanged }) {
  const isNew = !unit.id;
  const [name, setName] = useState(unit.name || "");
  const [definitionId, setDefinitionId] = useState(unit.definition_id || "");
  const [isShip, setIsShip] = useState(Boolean(unit.is_ship));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(imageUrl(unit.image_path));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    setBusy(true);
    try {
      if (isNew) {
        const form = new FormData();
        form.append("name", name.trim());
        form.append("definition_id", definitionId.trim());
        form.append("is_ship", String(isShip));
        if (file) form.append("image", file);
        await api("/units", { method: "POST", form });
        onSaved(`Added ${name.trim()}`);
      } else {
        await api(`/units/${unit.id}`, {
          method: "PUT",
          body: { name: name.trim(), definition_id: definitionId.trim(), is_ship: isShip },
        });
        if (file) {
          const form = new FormData();
          form.append("image", file);
          await api(`/units/${unit.id}/image`, { method: "POST", form });
        }
        onSaved(`Saved ${name.trim()}`);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${unit.name}?`)) return;
    setBusy(true);
    try {
      await api(`/units/${unit.id}`, { method: "DELETE" });
      onSaved(`Deleted ${unit.name}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={isNew ? "Add unit" : "Edit unit"} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <div className="portrait-row">
          <span className={`portrait${isShip ? " ship" : ""}`}>
            {preview ? <img src={preview} alt="" /> : <span className="muted small">No picture</span>}
          </span>
          <label className="btn small">
            <Icon name="upload" size={16} /> {preview ? "Replace picture" : "Add picture"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => e.target.files[0] && setFile(e.target.files[0])}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Name</span>
          <input type="text" value={name} autoFocus={isNew} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Game ID (optional)</span>
          <input
            type="text"
            className="mono"
            value={definitionId}
            placeholder="e.g. GRANDMASTERYODA"
            autoCapitalize="characters"
            onChange={(e) => setDefinitionId(e.target.value)}
          />
          <span className="muted small">
            Filled in by "Import from game". Needed to check your roster for ownership.
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={isShip} onChange={(e) => setIsShip(e.target.checked)} />
          This is a ship
        </label>

        {error && <p className="error-text">{error}</p>}

        <div className="row">
          {!isNew && (
            <button
              type="button"
              className="btn danger"
              onClick={remove}
              disabled={busy || unit.used_in_counters}
              title={unit.used_in_counters ? "Remove it from every counter squad first" : undefined}
            >
              Delete
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {!isNew && unit.used_in_counters && (
          <p className="muted small">This unit is in at least one counter, so it can't be deleted.</p>
        )}
      </form>
      {!isNew && <RecognizedFaces unit={unit} onChanged={onFacesChanged} />}
    </Modal>
  );
}

// The faces the screenshot importer recognizes as this unit - where a wrong
// "who is this?" answer gets fixed: move the face to the right unit, or
// remove it so it's asked about again next import.
function RecognizedFaces({ unit, onChanged }) {
  const [faces, setFaces] = useState(null);
  const [error, setError] = useState(null);
  const [moving, setMoving] = useState(null); // face id with the unit picker open

  const load = () =>
    api(`/portraits?unit_id=${unit.id}`)
      .then(setFaces)
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, [unit.id]);

  async function moveTo(face, target) {
    if (target.id === unit.id) return setMoving(null);
    try {
      await api(`/portraits/${face.id}`, { method: "PATCH", body: { unit_id: target.id } });
      setMoving(null);
      await load();
      onChanged(`Face moved to ${target.name}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(face) {
    if (!window.confirm(`Forget this face for ${unit.name}? It'll be asked about again next time it's imported.`)) return;
    try {
      await api(`/portraits/${face.id}`, { method: "DELETE" });
      await load();
      onChanged("Face removed");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="recognized-faces">
      <h3>Recognized faces</h3>
      <p className="muted small">
        Faces from screenshot imports that are matched to {unit.name}. If one is wrong, move it to the right unit
        or remove it.
      </p>
      {error && <p className="error-text">{error}</p>}
      {faces && faces.length === 0 && <p className="muted small">None yet.</p>}
      <ul className="face-list">
        {(faces || []).map((face) => (
          <li key={face.id} className="face-row">
            <span className="face big">
              <img src={imageUrl(face.image_path)} alt={`Face recognized as ${unit.name}`} />
            </span>
            <div className="grow">
              {moving === face.id ? (
                <>
                  <UnitPicker autoFocus placeholder="Move to which unit?" onPick={(target) => moveTo(face, target)} />
                  <button type="button" className="btn small ghost" onClick={() => setMoving(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <div className="row">
                  <button type="button" className="btn small" onClick={() => setMoving(face.id)}>
                    Wrong unit - move to…
                  </button>
                  <button type="button" className="btn small danger" onClick={() => remove(face)}>
                    Remove
                  </button>
                </div>
              )}
              {face.image_path === unit.image_path && <span className="muted small">Used as this unit's picture</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
