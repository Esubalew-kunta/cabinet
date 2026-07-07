import { cn } from "@/lib/utils";

/**
 * En-tête de page unique : icône teintée, titre display, sous-titre, actions.
 * Toutes les pages passent par ici pour garder une hiérarchie constante.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
  tone = "primary",
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: "primary" | "accent";
  className?: string;
}) {
  return (
    <div className={cn("rise-in flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl [&>svg]:size-5",
              tone === "accent" ? "bg-accent-soft text-accent" : "bg-primary-soft text-primary"
            )}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold leading-tight md:text-2xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
