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

/**
 * Nombre de MESSAGES non lus pour la pastille du menu.
 *
 * Décision réunion : « dans l'onglet chat, afficher le nombre de nouveaux messages ».
 * Donc on compte des messages, pas des conversations : compter les conversations
 * afficherait « 1 » à une secrétaire ayant dix messages en attente — et au plus « 1 »,
 * puisqu'elle n'en a qu'une.
 *
 * Non lu = message reçu après le filigrane de lecture du lecteur, et écrit par l'AUTRE
 * partie (ses propres messages ne sont jamais « nouveaux » pour soi).
 * RLS appliquée : un membre ne voit que SA conversation, l'admin les voit toutes.
 */
async function getUnreadMessages(isAdmin: boolean): Promise<number> {
  const supa = await supabaseServer();
  const { data: convs } = await supa
    .from("conversations")
    .select("id, dernier_message_at, lu_admin_at, lu_membre_at")
    .limit(200);

  const enAttente = (convs ?? []).filter((c) => {
    const lu = isAdmin ? c.lu_admin_at : c.lu_membre_at;
    return !lu || new Date(c.dernier_message_at) > new Date(lu);
  });
  if (enAttente.length === 0) return 0;

  const { data: msgs } = await supa
    .from("messages")
    .select("conversation_id, est_admin, created_at")
    .in(
      "conversation_id",
      enAttente.map((c) => c.id)
    )
    .limit(500);

  const luDe = new Map(enAttente.map((c) => [c.id, isAdmin ? c.lu_admin_at : c.lu_membre_at]));
  return (msgs ?? []).filter((m) => {
    if (m.est_admin === isAdmin) return false; // mes propres messages
    const lu = luDe.get(m.conversation_id);
    return !lu || new Date(m.created_at as string) > new Date(lu);
  }).length;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const { member } = session;
  const { tr } = await getTr();

  const hasTaches = can(session, "taches");
  const hasMessages = can(session, "messages");
  const isAdmin = member.is_owner || member.role === "admin";
  const [counts, unread] = await Promise.all([
    hasTaches ? getTaskCounts() : Promise.resolve({ open: 0, today: 0, overdue: 0 }),
    hasMessages ? getUnreadMessages(isAdmin) : Promise.resolve(0),
  ]);

  const items: NavItem[] = [];
  if (can(session, "dossiers_all")) items.push({ href: "/secretariat", label: tr.nav.secretariat, icon: "secretariat" });
  if (can(session, "dossiers_all")) items.push({ href: "/agenda", label: tr.nav.agenda, icon: "agenda" });
  if (can(session, "planning")) items.push({ href: "/horaires", label: tr.nav.horaires, icon: "horaires" });
  if (member.role === "medecin" || member.role === "ipa" || member.is_owner || member.role === "admin")
    items.push({ href: "/medecin", label: tr.nav.medecin, icon: "medecin" });
  if (can(session, "patients_all") || can(session, "patients_own"))
    items.push({ href: "/patients", label: tr.nav.patients, icon: "patients" });
  if (hasTaches) items.push({ href: "/taches", label: tr.nav.taches, icon: "taches", badge: counts.open });
  if (hasMessages) items.push({ href: "/messages", label: tr.nav.messages, icon: "messages", badge: unread });
  if (can(session, "examens")) items.push({ href: "/examens", label: tr.nav.examens, icon: "examens" });
  if (can(session, "examens")) items.push({ href: "/appareils", label: tr.nav.appareils, icon: "appareils" });
  if (can(session, "stock")) items.push({ href: "/inventaire", label: tr.nav.inventaire, icon: "inventaire" });
  if (can(session, "abonnes")) items.push({ href: "/abonnes", label: tr.nav.abonnes, icon: "abonnes" });
  if (can(session, "perfusions")) items.push({ href: "/perfusions", label: tr.nav.perfusions, icon: "perfusions" });
  if (can(session, "finances")) items.push({ href: "/finances", label: tr.nav.finances, icon: "finances" });
  if (can(session, "admin_stats")) items.push({ href: "/admin", label: tr.nav.admin, icon: "admin" });
  if (can(session, "gestion_comptes")) items.push({ href: "/admin/acces", label: tr.nav.acces, icon: "acces" });
  if (session.member.is_owner || session.member.role === "admin") items.push({ href: "/audit", label: tr.nav.audit, icon: "audit" });

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
