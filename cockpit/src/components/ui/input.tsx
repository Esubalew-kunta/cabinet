"use client";

import { cn } from "@/lib/utils";
import { forwardRef } from "react";

const base =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted hover:border-ring/70 focus:outline-2 focus:outline-ring disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(base, "h-9", className)} {...props} />;
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(base, "py-2 min-h-20", className)} {...props} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(base, "h-9 cursor-pointer", className)} {...props}>
        {children}
      </select>
    );
  }
);

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}
