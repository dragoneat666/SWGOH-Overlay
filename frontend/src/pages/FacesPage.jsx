import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, imageUrl } from "../api.js";
import { useUnits } from "../units.jsx";
import { useToast } from "../toast.jsx";
import UnitPicker from "../components/UnitPicker.jsx";

// The "To identify" queue: faces from screenshot imports that nobody has
// named yet. Naming one teaches the app that face (and names any other
// queued copies of it too).
export default function FacesPage() {
  const [faces, setFaces] = useState(null);
  const [error, setError] = useState(null);
  const { reload: reloadUnits } = useUnits();
  const toast = useToast();

  const load = useCallback(() => {
    api("/portraits/unidentified")
      .then((rows) => {
        setFaces(rows);
        window.dispatchEvent(new Event("faces-changed"));
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function identify(face, unit) {
    try {
      const res = await api(`/portraits/unidentified/${face.id}/identify`, { method: "POST", body: { unit_id: unit.id } });
      toast(res.resolved > 1 ? `Saved as ${unit.name} (${res.resolved} matching faces)` : `Saved as ${unit.name}`);
      reloadUnits();
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function dismiss(face) {
    try {
      await api(`/portraits/unidentified/${face.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>To identify</h1>
      </div>
      <p className="muted">
        Faces from screenshot imports that haven't been named yet. Once named, they're recognized automatically
        - re-import a screenshot afterwards to save the rows that used them.
      </p>

      {error && <p className="error-text">{error}</p>}
      {!faces && !error && <p className="muted">Loading…</p>}
      {faces && faces.length === 0 && (
        <div className="empty card">
          <h2>All caught up</h2>
          <p className="muted">
            Faces you skip on the <Link to="/import">Import</Link> screen show up here.
          </p>
        </div>
      )}

      <ul className="face-list">
        {(faces || []).map((face) => (
          <li key={face.id} className="card face-row">
            <span className="face big">
              <img src={imageUrl(face.image_path)} alt="Unidentified portrait" />
            </span>
            <div className="grow">
              <UnitPicker onPick={(unit) => identify(face, unit)} />
              <button className="btn small ghost" onClick={() => dismiss(face)}>
                Not a unit - remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
