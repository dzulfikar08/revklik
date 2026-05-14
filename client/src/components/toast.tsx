import { useState, useEffect, useCallback } from "react";

interface Toast {
  id: number;
  message: string;
  type: "error" | "success" | "info";
}

let addToastFn: ((message: string, type?: Toast["type"]) => void) | null = null;

export function toast(message: string, type: Toast["type"] = "error") {
  addToastFn?.(message, type);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let nextId = 0;

  const add = useCallback((message: string, type: Toast["type"] = "error") => {
    const id = ++nextId;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  useEffect(() => { addToastFn = add; return () => { addToastFn = null; }; }, [add]);

  if (toasts.length === 0) return null;

  const colors = {
    error: { bg: "var(--crit-dim)", border: "rgba(239,68,68,.25)", text: "var(--crit)" },
    success: { bg: "var(--green-dim)", border: "rgba(52,211,153,.25)", text: "var(--green)" },
    info: { bg: "var(--info-dim)", border: "rgba(96,165,250,.25)", text: "var(--info)" },
  };

  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 300, display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: colors[t.type].bg,
          border: `1px solid ${colors[t.type].border}`,
          borderRadius: 10,
          padding: "12px 16px",
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: colors[t.type].text,
          animation: "fadeUp 0.25s cubic-bezier(0.16,1,0.3,1)",
          boxShadow: "0 8px 24px rgba(0,0,0,.3)",
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
