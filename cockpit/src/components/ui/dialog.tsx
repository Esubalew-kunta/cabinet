"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useTr } from "@/components/i18n-provider";

export function Dialog({
  open,
  onClose,
  title,
  icon,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const { tr } = useTr();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  // Portal vers <body> : un ancêtre animé (transform) piégerait sinon le
  // position:fixed dans son bloc conteneur.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="overlay-in absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn("panel-in relative w-full max-w-lg rounded-2xl border border-border bg-surface shadow-xl", className)}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary [&>svg]:size-4">
                {icon}
              </span>
            )}
            <h2 className="font-display truncate text-sm font-semibold">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-muted transition-colors hover:bg-background hover:text-foreground"
            aria-label={tr.common.close}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4 scrollbar-thin">{children}</div>
      </div>
    </div>,
    document.body
  );
}
