"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useTr } from "@/components/i18n-provider";
import { LangToggle } from "@/components/lang-toggle";
import { ROLE_LABELS } from "@/lib/i18n/dict";
import {
  Activity,
  CalendarClock,
  ClipboardList,
  CreditCard,
  HeartPulse,
  KeyRound,
  ListChecks,
  LogOut,
  Mail,
  Menu,
  Package,
  ScrollText,
  Settings2,
  Stethoscope,
  Syringe,
  Users,
  Watch,
  X,
} from "lucide-react";
import { useState } from "react";

const ICONS = {
  secretariat: ClipboardList,
  agenda: CalendarClock,
  medecin: Stethoscope,
  patients: Users,
  taches: ListChecks,
  examens: Activity,
  appareils: Watch,
  inventaire: Package,
  abonnes: Mail,
  perfusions: Syringe,
  finances: CreditCard,
  admin: Settings2,
  acces: KeyRound,
  audit: ScrollText,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

export function Sidebar({
  items,
  memberName,
  memberRole,
  isOwner,
}: {
  items: NavItem[];
  memberName: string;
  memberRole: string;
  isOwner: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, tr } = useTr();
  const [open, setOpen] = useState(false);

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.replace("/connexion");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 scrollbar-thin">
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary-soft text-primary"
                : "text-foreground/75 hover:bg-background hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity",
                active ? "opacity-100" : "opacity-0"
              )}
            />
            <Icon className={cn("size-4 shrink-0 transition-colors", active ? "text-primary" : "text-muted group-hover:text-foreground")} />
            <span className="flex-1">{item.label}</span>
            {typeof item.badge === "number" && item.badge > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-white">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="space-y-2.5 border-t border-border p-3">
      <LangToggle className="w-full justify-center" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold uppercase text-primary">
            {memberName.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{memberName}</p>
            <p className="truncate text-xs text-muted">
              {ROLE_LABELS[lang][memberRole] ?? memberRole}
              {isOwner ? ` · ${tr.common.owner}` : ""}
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          title={tr.common.logout}
          className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );

  const header = (
    <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
      <div className="flex size-9 items-center justify-center rounded-xl bg-accent-soft">
        <HeartPulse className="size-5 text-accent" />
      </div>
      <div>
        <p className="font-display text-sm font-semibold leading-tight">{tr.nav.brand}</p>
        <p className="text-xs leading-tight text-muted">{tr.nav.brandSub}</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Barre mobile */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <HeartPulse className="size-5 text-accent" />
          <span className="font-display text-sm font-semibold">{tr.nav.brand} Dr Amraoui</span>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-background"
          aria-label="Menu"
          aria-expanded={open}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Tiroir mobile en surimpression */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="overlay-in absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="panel-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between pr-2">
              {header}
              <button
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-background"
                aria-label={tr.common.close}
              >
                <X className="size-5" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}

      {/* Barre latérale bureau */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        {header}
        {nav}
        {footer}
      </aside>
    </>
  );
}
