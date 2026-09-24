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
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 6500);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2.5">
        {toasts.map((t) => (
          <Toast key={t.id} t={t} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function Toast({ t }: { t: Toast }) {
  if (t.kind === "success") {
    return (
      <div className="flex animate-toastIn gap-3 bg-verdict px-4 py-3.5 text-ground shadow-[0_20px_50px_rgba(0,0,0,.6)]">
        <i className="ph-fill ph-seal-check text-xl" />
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">{t.msg}</span>
          {t.href && (
            <a
              href={t.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs font-medium text-ground"
            >
              VIEW TX <i className="ph ph-arrow-up-right" />
            </a>
          )}
        </div>
      </div>
    );
  }

  if (t.kind === "error") {
    return (
      <div className="flex animate-toastIn gap-3 border border-verdict bg-ground py-3.5 pr-4">
        <span aria-hidden className="w-2.5 flex-none self-stretch hazard-thin" />
        <i className="ph-bold ph-x-circle text-xl text-verdict" />
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-verdict">Something went wrong</span>
          <span className="text-[13px] text-sub">{t.msg}</span>
          {t.href && (
            <a
              href={t.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs font-medium text-verdict"
            >
              VIEW ON EXPLORER <i className="ph ph-arrow-up-right" />
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex animate-toastIn gap-3 border border-rule bg-raise px-4 py-3.5">
      <i className="ph ph-info text-xl text-ink" />
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-verdict">{t.msg}</span>
        {t.href && (
          <a
            href={t.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-muted"
          >
            {t.href.split("/").pop()?.slice(0, 10)}… <i className="ph ph-arrow-up-right" />
          </a>
        )}
      </div>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
