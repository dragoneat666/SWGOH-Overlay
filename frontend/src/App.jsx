import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, getToken, onUnauthorized, setToken } from "./api.js";
import { UnitsProvider } from "./units.jsx";
import { ToastProvider } from "./toast.jsx";
import Icon from "./components/Icon.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import CountersPage from "./pages/CountersPage.jsx";
import CounterEditor from "./pages/CounterEditor.jsx";
import UnitsPage from "./pages/UnitsPage.jsx";
import ReviewPage from "./pages/ReviewPage.jsx";
import ImportPage from "./pages/ImportPage.jsx";
import OffensePage from "./pages/OffensePage.jsx";
import FacesPage from "./pages/FacesPage.jsx";

export default function App() {
  const [signedIn, setSignedIn] = useState(() => Boolean(getToken()));

  const signOut = useCallback(() => {
    setToken("");
    setSignedIn(false);
  }, []);

  useEffect(() => onUnauthorized(signOut), [signOut]);

  if (!signedIn) {
    return (
      <ToastProvider>
        <LoginPage onSignedIn={() => setSignedIn(true)} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <UnitsProvider>
        <Shell onSignOut={signOut} />
      </UnitsProvider>
    </ToastProvider>
  );
}

// Badge counts for the nav: faces waiting to be identified, and automated
// submissions waiting for review (the Review tab only shows when there are
// some - nothing creates those yet).
function useNavCounts() {
  const location = useLocation();
  const [counts, setCounts] = useState({ faces: 0, review: 0 });

  const refresh = useCallback(() => {
    Promise.all([
      api("/portraits/unidentified").catch(() => []),
      api("/counters?status=pending").catch(() => []),
    ]).then(([faces, pending]) => setCounts({ faces: faces.length, review: pending.length }));
  }, []);

  useEffect(refresh, [refresh, location.pathname]);
  useEffect(() => {
    window.addEventListener("faces-changed", refresh);
    return () => window.removeEventListener("faces-changed", refresh);
  }, [refresh]);
  return counts;
}

function Shell({ onSignOut }) {
  const counts = useNavCounts();
  const nav = [
    { to: "/", label: "Defense", icon: "shield", end: true },
    { to: "/offense", label: "Offense", icon: "swords" },
    { to: "/import", label: "Import", icon: "upload" },
    { to: "/faces", label: "Faces", icon: "scan", badge: counts.faces },
    { to: "/units", label: "Units", icon: "users" },
    ...(counts.review > 0 ? [{ to: "/review", label: "Review", icon: "inbox", badge: counts.review }] : []),
  ];
  const badge = (n) => (n > 0 ? <span className="badge">{n}</span> : null);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width="28" height="28" />
          <span>SWGOH Counters</span>
        </div>
        <nav className="topnav" aria-label="Main">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
              {badge(item.badge)}
            </NavLink>
          ))}
        </nav>
        <button className="btn ghost small" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<CountersPage />} />
          <Route path="/counters/new" element={<CounterEditor />} />
          <Route path="/counters/:id" element={<CounterEditor />} />
          <Route path="/offense" element={<OffensePage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/faces" element={<FacesPage />} />
          <Route path="/units" element={<UnitsPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="bottomnav" aria-label="Main" style={{ "--nav-count": nav.length }}>
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            <Icon name={item.icon} />
            <span>
              {item.label}
              {badge(item.badge)}
            </span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
