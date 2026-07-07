"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white shadow-sm hover:bg-primary/90",
  secondary: "border border-border bg-surface text-foreground shadow-sm hover:bg-background",
  ghost: "text-foreground hover:bg-background",
  danger: "bg-danger text-white shadow-sm hover:bg-danger/90",
  success: "bg-success text-white shadow-sm hover:bg-success/90",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs rounded-md gap-1",
  md: "h-9 px-3.5 text-sm rounded-lg gap-1.5",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
  }
>(function Button({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
});
