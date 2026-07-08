import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPatientsIndex, patientName } from "@/lib/data";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { ETAT_APPAREIL_UNITE, TYPES_APPAREIL } from "@/lib/labels";
import { formatDate, EMPTY } from "@/lib/utils";
import { EtatAppareilSelect, NouvelAppareilButton } from "@/components/interactive";
import { Watch } from "lucide-react";
import type { Appareil, Examen } from "@/lib/types";

/**
 * L'inventaire physique : répond mot pour mot à la question de la Dre —
 * « Holter rythmique : 5 au total · 2 au cabinet · 3 dehors (1 en retard) ».
 */
export default async function AppareilsPage() {
  const session = await getSession();
  if (!can(session, "examens")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const supa = await supabaseServer();
  const [unites, examens, patientsIndex] = await Promise.all([
    supa.from("appareils").select("*").order("ref_appareil").then((r) => (r.data ?? []) as Appareil[]),
    supa
      .from("examens")
      .select("*")
      .in("statut_appareil", ["Remis", "Bientôt dû", "En retard"])
      .then((r) => (r.data ?? []) as Examen[]),
    getPatientsIndex(),
  ]);

  // examen en cours par unité (via la relation portée par l'examen)
  const examByUnit = new Map<string, Examen>();
  for (const e of examens) for (const uniteId of e.appareil ?? []) examByUnit.set(uniteId, e);

  const now = Date.now();
  const lateDays = (e: Examen | undefined): number => {
    if (!e?.restitution_prevue) return 0;
    return Math.max(0, Math.floor((now - new Date(e.restitution_prevue).getTime()) / 86_400_000));
  };

  const types = [...TYPES_APPAREIL.filter((t) => unites.some((u) => u.type === t)),
    ...[...new Set(unites.map((u) => u.type))].filter((t): t is string => Boolean(t) && !TYPES_APPAREIL.includes(t as (typeof TYPES_APPAREIL)[number]))];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Watch />}
        title={tr.appareils.title}
        subtitle={tr.appareils.subtitle}
        actions={<NouvelAppareilButton />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {types.map((t) => {
          const ofType = unites.filter((u) => u.type === t);
          const cabinet = ofType.filter((u) => u.etat === "Au cabinet").length;
          const dehors = ofType.filter((u) => u.etat === "Dehors");
          const late = dehors.filter((u) => lateDays(examByUnit.get(u.notion_id)) > 0).length;
          return (
            <StatCard
              key={t}
              label={t}
              value={`${cabinet}/${ofType.length}`}
              hint={tr.appareils.summary(ofType.length, cabinet, dehors.length, late)}
              tone={late > 0 ? "danger" : cabinet === 0 && ofType.length > 0 ? "warning" : "default"}
            />
          );
        })}
      </div>

      <Card>
        <CardHeader icon={<Watch />} title={tr.appareils.unitsTitle} subtitle={tr.appareils.unitsSub} />
        {unites.length === 0 ? (
          <Empty message={tr.appareils.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.appareils.colUnit}</th><th>{tr.common.type}</th><th>{tr.appareils.colNumber}</th><th>{tr.appareils.colState}</th><th>{tr.appareils.colWith}</th><th>{tr.appareils.colDue}</th><th>{tr.appareils.colLate}</th>
            </THead>
            <TBody>
              {unites.map((u) => {
                const exam = u.etat === "Dehors" ? examByUnit.get(u.notion_id) : undefined;
                const late = lateDays(exam);
                return (
                  <Tr key={u.notion_id}>
                    <td className="font-medium">{u.ref_appareil ?? EMPTY}</td>
                    <td className="text-xs">{u.type ?? EMPTY}</td>
                    <td className="tabular-nums text-xs text-muted">{u.numero ?? EMPTY}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={u.etat} map={ETAT_APPAREIL_UNITE} />
                        <EtatAppareilSelect appareilId={u.notion_id} value={u.etat} />
                      </div>
                    </td>
                    <td>{exam ? patientName(exam.patient, patientsIndex) : EMPTY}</td>
                    <td className="whitespace-nowrap">{exam ? formatDate(exam.restitution_prevue, lang) : EMPTY}</td>
                    <td className={late > 0 ? "font-semibold text-danger" : "text-muted"}>
                      {late > 0 ? tr.appareils.lateDays(late) : EMPTY}
                    </td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
