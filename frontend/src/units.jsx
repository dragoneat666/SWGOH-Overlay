import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

// The whole units library, loaded once and shared by every page (it's a
// few hundred rows at most).
const UnitsContext = createContext(null);

export function UnitsProvider({ children }) {
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      // Sorted here rather than trusting the database's collation, which
      // differs between setups (case-sensitive "C" vs en_US).
      const rows = await api("/units");
      rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      setUnits(rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(
    () => ({ units, byId: new Map(units.map((u) => [u.id, u])), loading, error, reload }),
    [units, loading, error, reload]
  );
  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits() {
  return useContext(UnitsContext);
}
