"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "success" | "error";

type Toast = { id: number; tone: ToastTone; title: string; detail?: string };

type ToastApi = {
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
};

const noop: ToastApi = { success: () => undefined, error: () => undefined };
const ToastContext = createContext<ToastApi>(noop);

const SUCCESS_MS = 4000;
const ERROR_MS = 12000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const push = useCallback(
    (tone: ToastTone, title: string, detail?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-4), { id, tone, title, detail }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? ERROR_MS : SUCCESS_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (title, detail) => push("success", title, detail), error: (title, detail) => push("error", title, detail) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto rounded-lg border bg-white p-3 shadow-lg ${toast.tone === "error" ? "border-[var(--danger)]" : "border-[var(--accent)]"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className={`text-sm font-medium ${toast.tone === "error" ? "text-[var(--danger)]" : ""}`}>{toast.title}</p>
              <button type="button" aria-label="Dismiss" className="cursor-pointer text-xs text-[var(--muted)]" onClick={() => dismiss(toast.id)}>
                ✕
              </button>
            </div>
            {toast.detail ? <p className="mt-1 text-xs break-words whitespace-pre-wrap text-[var(--muted)]">{toast.detail}</p> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
