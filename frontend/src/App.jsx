import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, getToken, onUnauthorized, setToken } from "./api.js";
import { UnitsProvider } from "./units.jsx";
import { ToastProvider } from "./toast.jsx";
import Icon from "./components/Icon.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import CountersPage from "./pages/CountersPage.jsx";
import CounterEditor from "./pages/CounterEditor.jsx";
import UnitsPage from "./pages/UnitsPage.jsx";
import ReviewPage from "./pages/ReviewPage.jsx";

const NAV = [
  { to: "/", label: "Counters", icon: "swords", end: true },
  { to: "/units", label: "Units", icon: "users" },
  { to: "/review", label: "Review", icon: "inbox" },
];

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
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <img src="/icon.svg" alt="" width="28" height="28" />
              <span>SWGOH Counters</span>
            </div>
            <nav className="topnav" aria-label="Main">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}>
                  {item.label}
                  {item.to === "/review" && <PendingBadge />}
                </NavLink>
              ))}
            </nav>
            <button className="btn ghost small" onClick={signOut}>
              Sign out
            </button>
          </header>

          <main className="content">
            <Routes>
              <Route path="/" element={<CountersPage />} />
              <Route path="/counters/new" element={<CounterEditor />} />
              <Route path="/counters/:id" element={<CounterEditor />} />
              <Route path="/units" element={<UnitsPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

          <nav className="bottomnav" aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                <Icon name={item.icon} />
                <span>
                  {item.label}
                  {item.to === "/review" && <PendingBadge />}
                </span>
              </NavLink>
            ))}
          </nav>
        </div>
      </UnitsProvider>
    </ToastProvider>
  );
}

// Count of OCR/import submissions waiting for review. Nothing creates those
// yet, so this normally stays hidden.
function PendingBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api("/counters?status=pending")
      .then((rows) => !cancelled && setCount(rows.length))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return count > 0 ? <span className="badge">{count}</span> : null;
}
