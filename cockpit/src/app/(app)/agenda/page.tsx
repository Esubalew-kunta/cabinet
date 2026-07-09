import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPatientsIndex, patientName } from "@/lib/data";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate, cn, EMPTY } from "@/lib/utils";
import { CalendarClock, Watch, CalendarCheck, ListChecks, CreditCard, FileText } from "lucide-react";
import type { Tache, Examen, Patient, Paiement } from "@/lib/types";
import type { Tone } from "@/lib/labels";

type Kind = "return" | "appt" | "task" | "payment" | "report";
type Item = { when: string | null; kind: Kind; label: string; sub: string | null; href: string };

const KIND_META: Record<Kind, { tone: Tone; icon: React.ReactNode }> = {
  return: { tone: "violet", icon: <Watch className="size-3.5" /> },
  appt: { tone: "blue", icon: <CalendarCheck className="size-3.5" /> },
  task: { tone: "gray", icon: <ListChecks className="size-3.5" /> },
  payment: { tone: "orange", icon: <CreditCard className="size-3.5" /> },
  report: { tone: "green", icon: <FileText className="size-3.5" /> },
};

const day = (d: string | null) => (d ? d.slice(0, 10) : null);

export default async function AgendaPage() {
  const session = await getSession();
  // La « planification » du secrétariat : réservé au front desk + admin.
  if (!can(session, "dossiers_all")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const supa = await supabaseServer();
  const [taches, examens, patients, paiements, patientsIndex] = await Promise.all([
    supa.from("taches").select("*").neq("statut", "Terminé").not("echeance", "is", null).limit(200).then((r) => (r.data ?? []) as Tache[]),
    supa.from("examens").select("*").limit(300).then((r) => (r.data ?? []) as Examen[]),
    supa.from("patients").select("*").not("prochain_rdv", "is", null).limit(300).then((r) => (r.data ?? []) as Patient[]),
    can(session, "paiements_all")
      ? supa.from("paiements").select("*").in("statut_paiement", ["Impayé", "Partiel"]).limit(200).then((r) => (r.data ?? []) as Paiement[])
      : Promise.resolve([] as Paiement[]),
    getPatientsIndex(),
  ]);

  const items: Item[] = [];
  // Appareils à rendre (pas encore rendus)
  for (const e of examens) {
    if (e.restitution_prevue && e.statut_appareil !== "Rendu") {
      items.push({ when: e.restitution_prevue, kind: "return", label: tr.agenda.deviceReturn(e.type ?? "appareil"), sub: patientName(e.patient, patientsIndex), href: e.patient?.[0] ? `/patients/${e.patient[0]}` : "/appareils" });
    }
    // Comptes rendus à envoyer (interprétés, non envoyés)
    if (e.date_interpretation && !e.date_envoi) {
      items.push({ when: e.date_interpretation, kind: "report", label: tr.agenda.reportToSend, sub: patientName(e.patient, patientsIndex), href: "/examens" });
    }
  }
  // Rendez-vous à confirmer
  for (const p of patients) {
    items.push({ when: p.prochain_rdv, kind: "appt", label: tr.agenda.appointment, sub: p.nom, href: `/patients/${p.notion_id}` });
  }
  // Tâches à échéance
  for (const t of taches) {
    items.push({ when: t.echeance, kind: "task", label: t.titre ?? EMPTY, sub: patientName(t.patient_lie, patientsIndex) === EMPTY ? null : patientName(t.patient_lie, patientsIndex), href: "/taches" });
  }
  // Relances de paiement
  for (const pay of paiements) {
    items.push({ when: pay.echeance, kind: "payment", label: tr.agenda.paymentFollowUp, sub: patientName(pay.patient, patientsIndex), href: "/finances" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const bucketOf = (w: string | null): "overdue" | "today" | "tomorrow" | "later" => {
    const d = day(w);
    if (!d) return "later";
    if (d < today) return "overdue";
    if (d === today) return "today";
    if (d === tomorrow) return "tomorrow";
    return "later";
  };
  const order = { overdue: 0, today: 1, tomorrow: 2, later: 3 } as const;
  items.sort((a, b) => {
    const ba = order[bucketOf(a.when)], bb = order[bucketOf(b.when)];
    if (ba !== bb) return ba - bb;
    return (day(a.when) ?? "9999").localeCompare(day(b.when) ?? "9999");
  });

  const groups: { key: "overdue" | "today" | "tomorrow" | "later"; label: string; items: Item[] }[] = [
    { key: "overdue", label: tr.agenda.overdue, items: [] },
    { key: "today", label: tr.agenda.today, items: [] },
    { key: "tomorrow", label: tr.agenda.tomorrow, items: [] },
    { key: "later", label: tr.agenda.later, items: [] },
  ];
  for (const it of items) groups.find((g) => g.key === bucketOf(it.when))!.items.push(it);

  const total = items.length;

  return (
    <div className="space-y-4">
      <PageHeader icon={<CalendarClock />} title={tr.agenda.title} subtitle={tr.agenda.subtitle} />

      {total === 0 ? (
        <Card><div className="p-8 text-center text-sm text-muted">{tr.agenda.empty}</div></Card>
      ) : (
        groups.filter((g) => g.items.length > 0).map((g) => (
          <Card key={g.key}>
            <CardHeader
              icon={<CalendarClock />}
              title={g.label}
              subtitle={`${g.items.length} ${g.items.length > 1 ? tr.agenda.itemsN : tr.agenda.item1}`}
            />
            <ul className="divide-y divide-border">
              {g.items.map((it, i) => {
                const meta = KIND_META[it.kind];
                const overdue = g.key === "overdue";
                return (
                  <li key={i}>
                    <Link href={it.href} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface/60">
                      <Badge tone={overdue ? "red" : meta.tone}>{meta.icon}</Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{it.label}</span>
                        {it.sub && <span className="block truncate text-xs text-muted">{it.sub}</span>}
                      </span>
                      <span className={cn("whitespace-nowrap text-xs tabular-nums", overdue ? "font-semibold text-danger" : "text-muted")}>
                        {formatDate(it.when, lang)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
