"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastAction = { label: string; onAction: () => void };
type Toast = { id: number; message: string; kind: "success" | "error"; action?: ToastAction };
type PushToast = (message: string, kind?: Toast["kind"], action?: ToastAction) => void;

const ToastContext = createContext<PushToast>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback<PushToast>((message, kind = "success", action) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "toast-in pointer-events-auto flex items-center gap-2 rounded-xl border bg-surface px-3.5 py-2.5 text-sm font-medium shadow-lg",
              t.kind === "success" ? "border-success/25" : "border-danger/25"
            )}
            role="status"
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" />
            ) : (
              <XCircle className="size-4 shrink-0 text-danger" />
            )}
            {t.message}
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onAction();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
                className="ml-1 cursor-pointer rounded-md px-2 py-0.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-soft"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
