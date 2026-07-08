import { getSession, can } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { Sidebar, type NavItem } from "@/components/shell/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const { member } = session;
  const { tr } = await getTr();

  const items: NavItem[] = [];
  if (can(session, "dossiers_all")) items.push({ href: "/secretariat", label: tr.nav.secretariat, icon: "secretariat" });
  if (member.role === "medecin" || member.is_owner || member.role === "admin")
    items.push({ href: "/medecin", label: tr.nav.medecin, icon: "medecin" });
  if (can(session, "patients_all") || can(session, "patients_own"))
    items.push({ href: "/patients", label: tr.nav.patients, icon: "patients" });
  if (can(session, "examens")) items.push({ href: "/examens", label: tr.nav.examens, icon: "examens" });
  if (can(session, "examens")) items.push({ href: "/appareils", label: tr.nav.appareils, icon: "appareils" });
  if (can(session, "perfusions")) items.push({ href: "/perfusions", label: tr.nav.perfusions, icon: "perfusions" });
  if (can(session, "finances")) items.push({ href: "/finances", label: tr.nav.finances, icon: "finances" });
  if (can(session, "admin_stats")) items.push({ href: "/admin", label: tr.nav.admin, icon: "admin" });
  if (can(session, "gestion_comptes")) items.push({ href: "/admin/acces", label: tr.nav.acces, icon: "acces" });

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        items={items}
        memberName={member.nom ?? member.email}
        memberRole={member.role}
        isOwner={member.is_owner}
      />
      <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
