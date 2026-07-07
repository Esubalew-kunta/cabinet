import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rise-in overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.05),0_1px_3px_rgba(16,24,40,0.04)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-border px-4 py-3", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary [&>svg]:size-4">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "danger" | "success" | "warning";
}) {
  const valueColor =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <Card className="px-4 py-3 transition-shadow hover:shadow-[0_2px_8px_rgba(16,24,40,0.08)]">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("font-display mt-1 text-2xl font-semibold tabular-nums", valueColor)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
