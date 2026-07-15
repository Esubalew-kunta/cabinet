import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPatientsIndex, patientName, getPersonnel, isSoignant } from "@/lib/data";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { ETAT_APPAREIL_UNITE, TYPES_APPAREIL, STATUT_APPAREIL } from "@/lib/labels";
import { formatDate, formatEuro, EMPTY } from "@/lib/utils";
import { jour, joursDeRetard, statutRetour, retardBloqueUneReservation, type Pret } from "@/lib/appareils";
import {
  EtatAppareilSelect,
  NouvelAppareilButton,
  NouvelExamenButton,
  AppareilRenduButton,
  FacturerPenaliteButton,
} from "@/components/interactive";
import { TriangleAlert, Watch } from "lucide-react";
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
    // Prêts OUVERTS = pas de restitution effective. Inclut les réservations à venir.
    // (On ne filtre plus sur « Statut appareil » : cette valeur est désormais dérivée,
    // et rien ne l'écrivait de façon fiable — cf. src/lib/appareils.ts.)
    supa
      .from("examens")
      .select("*")
      .is("restitution_effective", null)
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

  const today = new Date().toISOString().slice(0, 10);

  // Prêts par unité : une unité peut avoir un prêt en cours ET des réservations à venir.
  const pretsByUnit = new Map<string, Pret[]>();
  for (const e of examens) {
    for (const uniteId of e.appareil ?? []) {
      const p: Pret = {
        id: e.notion_id,
        debut: jour(e.date_pose) ?? today,
        retourPrevu: jour(e.restitution_prevue),
        retourEffectif: jour(e.restitution_effective),
      };
      pretsByUnit.set(uniteId, [...(pretsByUnit.get(uniteId) ?? []), p]);
    }
  }
  /** Le prêt réellement en cours (pose atteinte), par opposition à une réservation. */
  const enCoursByUnit = new Map<string, Examen>();
  for (const e of examens) {
    if ((jour(e.date_pose) ?? today) <= today) {
      for (const uniteId of e.appareil ?? []) enCoursByUnit.set(uniteId, e);
    }
  }

  const penalty = (e: Examen | undefined): { days: number; amount: number } | null => {
    if (!e?.restitution_prevue) return null;
    const days = joursDeRetard(
      { id: e.notion_id, debut: jour(e.date_pose) ?? today, retourPrevu: jour(e.restitution_prevue), retourEffectif: jour(e.restitution_effective) },
      today
    );
    if (days <= 0) return null;
    const isPgv = (e.type ?? "").includes("Polygraphie");
    const rate = fees.get(isPgv ? "late_fee_polygraphie" : "late_fee_holter") ?? (isPgv ? 100 : 150);
    return { days, amount: days * rate };
  };

  const types = [...TYPES_APPAREIL.filter((t) => unites.some((u) => u.type === t)),
    ...[...new Set(unites.map((u) => u.type))].filter((t): t is string => Boolean(t) && !TYPES_APPAREIL.includes(t as (typeof TYPES_APPAREIL)[number]))];

  const medecins = personnel.filter(isSoignant);
  const patientsList = [...patientsIndex.values()]
    .map((p) => ({ notion_id: p.notion_id, nom: p.nom }))
    .sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? ""));
  // Chaque unité part avec ses prêts : le dialogue juge la disponibilité à la DATE
  // demandée, et non sur l'état courant — c'est ce qui permet de réserver à l'avance.
  const libres = unites.map((u) => ({
    notion_id: u.notion_id,
    ref_appareil: u.ref_appareil,
    type: u.type,
    etat: u.etat,
    prets: pretsByUnit.get(u.notion_id) ?? [],
  }));

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
          const late = dehors.filter((u) => penalty(enCoursByUnit.get(u.notion_id))).length;
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
                const exam = enCoursByUnit.get(u.notion_id);
                const pen = penalty(exam);
                const dejaFacturee = exam ? penalitesExistantes.has(exam.notion_id) : false;
                const prets = pretsByUnit.get(u.notion_id) ?? [];
                // Réservations = prêts ouverts dont la pose est à venir.
                const reservations = prets
                  .filter((p) => p.debut > today)
                  .sort((a, b) => a.debut.localeCompare(b.debut));
                // Un retard qui fait attendre quelqu'un : c'est ce qu'il faut voir en premier.
                const pretEnCours = exam
                  ? prets.find((p) => p.id === exam.notion_id)
                  : undefined;
                const bloqueUnAutre = pretEnCours
                  ? retardBloqueUneReservation(pretEnCours, prets, today)
                  : false;
                return (
                  <Tr key={u.notion_id}>
                    <td className="font-medium">{u.ref_appareil ?? EMPTY}</td>
                    <td className="text-xs">{u.type ?? EMPTY}</td>
                    <td className="tabular-nums text-xs text-muted">{u.numero ?? EMPTY}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge value={u.etat} map={ETAT_APPAREIL_UNITE} />
                        <EtatAppareilSelect appareilId={u.notion_id} value={u.etat} />
                        {pretEnCours && (
                          <StatusBadge value={statutRetour(pretEnCours, today)} map={STATUT_APPAREIL} />
                        )}
                      </div>
                      {reservations.length > 0 && (
                        <div className="mt-1 text-[11px] text-muted">
                          {tr.appareils.reservedFrom(formatDate(reservations[0].debut, lang), reservations.length)}
                        </div>
                      )}
                      {bloqueUnAutre && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-danger">
                          <TriangleAlert className="size-3" /> {tr.appareils.blockingReservation}
                        </div>
                      )}
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
