import { cn } from "@/lib/utils";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto scrollbar-thin", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border bg-background/50 text-left text-[11px] font-semibold uppercase tracking-wider text-muted [&>th]:px-3 [&>th]:py-2.5 [&>th]:whitespace-nowrap">
        {children}
      </tr>
    </thead>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function Tr({ className, children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("transition-colors hover:bg-primary-soft/35 [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-middle", className)}
      {...props}
    >
      {children}
    </tr>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
      <span className="flex size-8 items-center justify-center rounded-full bg-background text-muted">✓</span>
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
