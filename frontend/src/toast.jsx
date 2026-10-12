import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const show = useCallback((message, kind = "ok") => {
    clearTimeout(timer.current);
    setToast({ message, kind, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), kind === "error" ? 6000 : 3000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

// toast("Saved") / toast("Couldn't save: ...", "error")
export function useToast() {
  return useContext(ToastContext);
}
