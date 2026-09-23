"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "info" | "success" | "error";
type Toast = { id: number; kind: Kind; msg: string; href?: string };

type ToastState = {
  push: (t: { kind?: Kind; msg: string; href?: string }) => void;
};

const Ctx = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: { kind?: Kind; msg: string; href?: string }) => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, kind: t.kind ?? "info", msg: t.msg, href: t.href }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 6000);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-toast-in card px-4 py-3 text-sm ${
              t.kind === "success"
                ? "border-settle/40"
                : t.kind === "error"
                  ? "border-danger/40"
                  : "border-line"
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  t.kind === "success"
                    ? "bg-settle"
                    : t.kind === "error"
                      ? "bg-danger"
                      : "bg-accent"
                }`}
              />
              <div className="min-w-0">
                <p className="text-ink">{t.msg}</p>
                {t.href && (
                  <a
                    href={t.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mono text-accent hover:underline"
                  >
                    View on explorer ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
