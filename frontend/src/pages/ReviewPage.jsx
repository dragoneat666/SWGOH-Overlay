import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../toast.jsx";
import SquadView from "../components/SquadView.jsx";
import Icon from "../components/Icon.jsx";

// Counters submitted by automated sources (future OCR/import tools) wait
// here until approved - manual entries skip this. See docs/ARCHITECTURE.md
// ("Counters QA workflow").
export default function ReviewPage() {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    api("/counters/pending")
      .then(setPending)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function review(counter, action) {
    try {
      await api(`/counters/${counter.id}/${action}`, { method: "POST", body: {} });
      toast(action === "approve" ? "Approved - the overlay will show it now" : "Rejected");
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Review queue</h1>
      </div>
      <p className="muted">
        Counters from automated sources (like screenshot scanning, once that's built) wait here for your
        approval. Counters you enter yourself skip the queue.
      </p>

      {error && <p className="error-text">{error}</p>}
      {pending && pending.length === 0 && <div className="empty card">Nothing waiting for review.</div>}

      <ul className="counter-list">
        {(pending || []).map((counter) => (
          <li key={counter.id} className="card counter-card">
            <div className="counter-defender">
              <span className="eyebrow">
                Defense · from {counter.source}
                {counter.submitted_by ? ` by ${counter.submitted_by}` : ""}
              </span>
              <SquadView squad={counter.defender} />
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
            <div className="row">
              <span className="grow" />
              <button className="btn danger" onClick={() => review(counter, "reject")}>
                Reject
              </button>
              <button className="btn primary" onClick={() => review(counter, "approve")}>
                <Icon name="check" size={18} /> Approve
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
