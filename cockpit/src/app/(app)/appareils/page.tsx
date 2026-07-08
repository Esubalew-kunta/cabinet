import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPatientsIndex, patientName, getPersonnel } from "@/lib/data";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { ETAT_APPAREIL_UNITE, TYPES_APPAREIL } from "@/lib/labels";
import { formatDate, formatEuro, EMPTY } from "@/lib/utils";
import {
  EtatAppareilSelect,
  NouvelAppareilButton,
  NouvelExamenButton,
  AppareilRenduButton,
  FacturerPenaliteButton,
} from "@/components/interactive";
import { Watch } from "lucide-react";
import type { Appareil, Examen } from "@/lib/types";

/**
 * Le parc physique et son prêt. L'administration ajoute des appareils ;
 * le personnel en assigne un (unité libre) à un patient, puis le récupère
 * et facture les retards. L'interprétation, elle, vit sur la page Examens.
 */
export default async function AppareilsPage() {
  const session = await getSession();
  if (!can(session, "examens")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();
  const isAdmin = session.member.is_owner || session.member.role === "admin";
  const canBill = can(session, "paiements_all");

  const supa = await supabaseServer();
  const [unites, examens, patientsIndex, personnel, fees, penalitesExistantes] = await Promise.all([
    supa.from("appareils").select("*").order("ref_appareil").then((r) => (r.data ?? []) as Appareil[]),
    supa
      .from("examens")
      .select("*")
      .in("statut_appareil", ["Remis", "Bientôt dû", "En retard"])
      .then((r) => (r.data ?? []) as Examen[]),
    getPatientsIndex(),
    getPersonnel(),
    supabaseAdmin().from("parametres").select("parametre, valeur")
      .in("parametre", ["late_fee_holter", "late_fee_polygraphie"])
      .then((r) => new Map((r.data ?? []).map((p) => [p.parametre, Number(p.valeur)]))),
    canBill
      ? supa.from("paiements").select("examen").eq("type_prestation", "Pénalité retard")
          .then((r) => new Set(((r.data ?? []) as { examen: string[] | null }[]).flatMap((p) => p.examen ?? [])))
      : Promise.resolve(new Set<string>()),
  ]);

  const examByUnit = new Map<string, Examen>();
  for (const e of examens) for (const uniteId of e.appareil ?? []) examByUnit.set(uniteId, e);

  const now = Date.now();
  const penalty = (e: Examen | undefined): { days: number; amount: number } | null => {
    if (!e?.restitution_prevue) return null;
    const days = Math.floor((now - new Date(e.restitution_prevue).getTime()) / 86_400_000);
    if (days <= 0) return null;
    const isPgv = (e.type ?? "").includes("Polygraphie");
    const rate = fees.get(isPgv ? "late_fee_polygraphie" : "late_fee_holter") ?? (isPgv ? 100 : 150);
    return { days, amount: days * rate };
  };

  const types = [...TYPES_APPAREIL.filter((t) => unites.some((u) => u.type === t)),
    ...[...new Set(unites.map((u) => u.type))].filter((t): t is string => Boolean(t) && !TYPES_APPAREIL.includes(t as (typeof TYPES_APPAREIL)[number]))];

  const medecins = personnel.filter((p) => p.role === "Médecin" && p.actif);
  const patientsList = [...patientsIndex.values()]
    .map((p) => ({ notion_id: p.notion_id, nom: p.nom }))
    .sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? ""));
  const libres = unites.map((u) => ({ notion_id: u.notion_id, ref_appareil: u.ref_appareil, type: u.type, etat: u.etat }));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Watch />}
        title={tr.appareils.title}
        subtitle={tr.appareils.subtitle}
        actions={
          <>
            <NouvelExamenButton
              patients={patientsList}
              interpretes={medecins}
              unites={libres}
              label={tr.appareils.assignDevice}
            />
            {isAdmin && <NouvelAppareilButton />}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {types.map((t) => {
          const ofType = unites.filter((u) => u.type === t);
          const cabinet = ofType.filter((u) => u.etat === "Au cabinet").length;
          const dehors = ofType.filter((u) => u.etat === "Dehors");
          const late = dehors.filter((u) => penalty(examByUnit.get(u.notion_id))).length;
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
              <th>{tr.appareils.colUnit}</th><th>{tr.common.type}</th><th>{tr.appareils.colNumber}</th><th>{tr.appareils.colState}</th><th>{tr.appareils.colWith}</th><th>{tr.appareils.colDue}</th><th>{tr.examens.colPenalty}</th><th></th>
            </THead>
            <TBody>
              {unites.map((u) => {
                const exam = u.etat === "Dehors" ? examByUnit.get(u.notion_id) : undefined;
                const pen = penalty(exam);
                const dejaFacturee = exam ? penalitesExistantes.has(exam.notion_id) : false;
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
                    <td>
                      {pen ? (
                        <span className="whitespace-nowrap text-xs font-semibold text-danger">
                          {tr.examens.penaltyDays(pen.days, formatEuro(pen.amount, lang))}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">{EMPTY}</span>
                      )}
                    </td>
                    <td>
                      {exam && (
                        <div className="flex items-center gap-2">
                          <AppareilRenduButton examenId={exam.notion_id} />
                          {canBill && pen && !dejaFacturee && (
                            <FacturerPenaliteButton examenId={exam.notion_id} days={pen.days} amount={formatEuro(pen.amount, lang)} />
                          )}
                        </div>
                      )}
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
