import Link from "next/link";
import { getSession, can } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { Sidebar, type NavItem } from "@/components/shell/sidebar";
import { cn } from "@/lib/utils";
import { AlarmClock, ArrowRight } from "lucide-react";

/** Compteurs de tâches ouvertes (RLS appliquée : chacun compte ce qu'il voit). */
async function getTaskCounts(): Promise<{ open: number; today: number; overdue: number }> {
  const supa = await supabaseServer();
  const { data } = await supa
    .from("taches")
    .select("echeance")
    .neq("statut", "Terminé")
    .limit(500);
  const rows = data ?? [];
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let today = 0;
  let overdue = 0;
  for (const r of rows) {
    if (!r.echeance) continue;
    const d = new Date(r.echeance);
    if (d < startOfDay) overdue++;
    else if (d <= endOfDay) today++;
  }
  return { open: rows.length, today, overdue };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const { member } = session;
  const { tr } = await getTr();

  const hasTaches = can(session, "taches");
  const counts = hasTaches ? await getTaskCounts() : { open: 0, today: 0, overdue: 0 };

  const items: NavItem[] = [];
  if (can(session, "dossiers_all")) items.push({ href: "/secretariat", label: tr.nav.secretariat, icon: "secretariat" });
  if (member.role === "medecin" || member.is_owner || member.role === "admin")
    items.push({ href: "/medecin", label: tr.nav.medecin, icon: "medecin" });
  if (can(session, "patients_all") || can(session, "patients_own"))
    items.push({ href: "/patients", label: tr.nav.patients, icon: "patients" });
  if (hasTaches) items.push({ href: "/taches", label: tr.nav.taches, icon: "taches", badge: counts.open });
  if (can(session, "examens")) items.push({ href: "/examens", label: tr.nav.examens, icon: "examens" });
  if (can(session, "perfusions")) items.push({ href: "/perfusions", label: tr.nav.perfusions, icon: "perfusions" });
  if (can(session, "finances")) items.push({ href: "/finances", label: tr.nav.finances, icon: "finances" });
  if (can(session, "admin_stats")) items.push({ href: "/admin", label: tr.nav.admin, icon: "admin" });
  if (can(session, "gestion_comptes")) items.push({ href: "/admin/acces", label: tr.nav.acces, icon: "acces" });

  const showStrip = counts.today + counts.overdue > 0;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        items={items}
        memberName={member.nom ?? member.email}
        memberRole={member.role}
        isOwner={member.is_owner}
      />
      <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-[1400px]">
          {showStrip && (
            <Link
              href="/taches"
              className={cn(
                "rise-in mb-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
                counts.overdue > 0
                  ? "border-warning/40 bg-warning-soft text-warning hover:border-warning/70"
                  : "border-primary/25 bg-primary-soft text-primary hover:border-primary/50"
              )}
            >
              <AlarmClock className="size-4 shrink-0" />
              <span>
                {counts.today > 0 && tr.strip.today(counts.today)}
                {counts.today > 0 && counts.overdue > 0 && " · "}
                {counts.overdue > 0 && tr.strip.overdue(counts.overdue)}
              </span>
              <span className="ml-auto inline-flex items-center gap-1 text-xs">
                {tr.strip.open} <ArrowRight className="size-3" />
              </span>
            </Link>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
