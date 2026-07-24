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
  CalendarRange,
  ClipboardList,
  CreditCard,
  HeartPulse,
  KeyRound,
  ListChecks,
  LogOut,
  Mail,
  MessageSquare,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings2,
  Stethoscope,
  Syringe,
  Users,
  Watch,
  X,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";

const COLLAPSE_KEY = "cockpit:sidebar-collapsed";
const COLLAPSE_EVT = "cockpit:sidebar-collapsed-change";

// État de repli lu depuis localStorage via un store externe : pas de setState dans un
// effet (règle lint), et pas de décalage d'hydratation (getServerSnapshot = déplié).
function subscribeCollapsed(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(COLLAPSE_EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(COLLAPSE_EVT, cb);
  };
}
function getCollapsedSnapshot() {
  return typeof window !== "undefined" && window.localStorage.getItem(COLLAPSE_KEY) === "1";
}

const ICONS = {
  secretariat: ClipboardList,
  agenda: CalendarClock,
  horaires: CalendarRange,
  medecin: Stethoscope,
  patients: Users,
  taches: ListChecks,
  messages: MessageSquare,
  examens: Activity,
  appareils: Watch,
  telecardiologie: HeartPulse,
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
  // Repli de la barre bureau : icônes seules. Persisté pour survivre aux navigations.
  const collapsed = useSyncExternalStore(subscribeCollapsed, getCollapsedSnapshot, () => false);

  function toggleCollapsed() {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
    } catch {}
    window.dispatchEvent(new Event(COLLAPSE_EVT));
  }

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.replace("/connexion");
    router.refresh();
  }

  // `mini` = variante repliée (bureau uniquement). Le tiroir mobile passe toujours false.
  const renderNav = (mini: boolean) => (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 scrollbar-thin">
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
        const Icon = ICONS[item.icon];
        const hasBadge = typeof item.badge === "number" && item.badge > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            title={mini ? item.label : undefined}
            className={cn(
              "group relative flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
              mini ? "justify-center px-0" : "gap-2.5 px-3",
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
            {!mini && <span className="flex-1">{item.label}</span>}
            {!mini && hasBadge && (
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-white">
                {item.badge! > 99 ? "99+" : item.badge}
              </span>
            )}
            {/* Replié : une pastille sans chiffre, pour ne pas perdre l'info « du nouveau ». */}
            {mini && hasBadge && (
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-surface" />
            )}
          </Link>
        );
      })}
    </nav>
  );

  const renderFooter = (mini: boolean) =>
    mini ? (
      <div className="flex flex-col items-center gap-2 border-t border-border p-2">
        <div
          title={memberName}
          className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold uppercase text-primary"
        >
          {memberName.slice(0, 2)}
        </div>
        <button
          onClick={logout}
          title={tr.common.logout}
          className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    ) : (
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

  // `toggle` : n'affiche le bouton de repli que sur la barre bureau.
  const renderHeader = (mini: boolean, toggle: boolean) =>
    mini ? (
      <div className="flex flex-col items-center gap-2 border-b border-border px-2 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-accent-soft">
          <HeartPulse className="size-5 text-accent" />
        </div>
        {toggle && (
          <button
            onClick={toggleCollapsed}
            title={tr.common.expandSidebar}
            aria-label={tr.common.expandSidebar}
            className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        )}
      </div>
    ) : (
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
          <HeartPulse className="size-5 text-accent" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold leading-tight">{tr.nav.brand}</p>
          <p className="truncate text-xs leading-tight text-muted">{tr.nav.brandSub}</p>
        </div>
        {toggle && (
          <button
            onClick={toggleCollapsed}
            title={tr.common.collapseSidebar}
            aria-label={tr.common.collapseSidebar}
            className="ml-auto cursor-pointer rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
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
              {renderHeader(false, false)}
              <button
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-background"
                aria-label={tr.common.close}
              >
                <X className="size-5" />
              </button>
            </div>
            {renderNav(false)}
            {renderFooter(false)}
          </div>
        </div>
      )}

      {/* Barre latérale bureau (repliable en rail d'icônes) */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {renderHeader(collapsed, true)}
        {renderNav(collapsed)}
        {renderFooter(collapsed)}
      </aside>
    </>
  );
}
