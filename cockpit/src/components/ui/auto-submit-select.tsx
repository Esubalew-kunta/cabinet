"use client";

import { cn } from "@/lib/utils";

/**
 * Select qui soumet son formulaire parent au changement : plus de bouton
 * « Filtrer » / « OK » à cliquer.
 */
export function AutoSubmitSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      onChange={(e) => {
        props.onChange?.(e);
        e.currentTarget.form?.requestSubmit();
      }}
      className={cn(
        "h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-xs shadow-sm transition-colors hover:border-ring/70 focus:outline-2 focus:outline-ring",
        className
      )}
    >
      {children}
    </select>
  );
}
