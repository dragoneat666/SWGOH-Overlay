import { useState } from "react";
import { api, setToken } from "../api.js";

export default function LoginPage({ onSignedIn }) {
  const [token, setTokenInput] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await api("/auth/check", { token: value });
      setToken(value);
      onSignedIn();
    } catch (err) {
      setError(err.status === 401 ? "That token was rejected." : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <img src="/icon.svg" alt="" width="56" height="56" />
        <h1>SWGOH Counters</h1>
        <p className="muted">
          Sign in with the <code>API_TOKEN</code> from your server's <code>.env</code> file. This browser
          will remember it.
        </p>
        <label className="field">
          <span className="field-label">API token</span>
          <input
            type="password"
            value={token}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setTokenInput(e.target.value)}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary block" disabled={busy || !token.trim()}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
