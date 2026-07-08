import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPatientsIndex, patientName, getPersonnelMap, personName, getPersonnel } from "@/lib/data";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { STATUT_APPAREIL, CAT_EXAMEN } from "@/lib/labels";
import { formatDate, formatEuro, EMPTY } from "@/lib/utils";
import { AppareilRenduButton, NouvelExamenButton, CATSelect, AppareillageButton, FacturerPenaliteButton } from "@/components/interactive";
import { Activity, Microscope, Send, Stethoscope, Watch } from "lucide-react";
import type { Lang } from "@/lib/i18n/dict";
import { getDict, tv } from "@/lib/i18n/dict";
import type { Examen, Patient, Appareil } from "@/lib/types";

function Section({
  title, icon, subtitle, rows, action, cat, patientsIndex, personnelMap, lang,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle: string;
  rows: Examen[];
  action?: boolean;
  cat?: boolean;
  patientsIndex: Map<string, Patient>;
  personnelMap: Map<string, string>;
  lang: Lang;
}) {
  const tr = getDict(lang);
  return (
    <Card>
      <CardHeader icon={icon} title={title} subtitle={subtitle} />
      {rows.length === 0 ? (
        <Empty message={tr.examens.empty} />
      ) : (
        <Table>
          <THead>
            <th>{tr.common.reference}</th><th>{tr.common.patient}</th><th>{tr.common.type}</th><th>{tr.examens.colIndication}</th><th>{tr.examens.colPose}</th><th>{tr.examens.colReturn}</th><th>{tr.examens.colInterpreter}</th>{cat && <th>{tr.examens.colCAT}</th>}<th>{tr.common.status}</th>{action && <th></th>}
          </THead>
          <TBody>
            {rows.map((e) => (
              <Tr key={e.notion_id}>
                <td className="font-medium">{e.ref_examen ?? EMPTY}</td>
                <td>{patientName(e.patient, patientsIndex)}</td>
                <td className="text-xs">{e.type ?? EMPTY}</td>
                <td className="text-xs">{e.indication ?? EMPTY}</td>
                <td className="whitespace-nowrap">{formatDate(e.date_pose, lang)}</td>
                <td className="whitespace-nowrap">{formatDate(e.restitution_prevue, lang)}</td>
                <td className="text-xs">{personName(e.interprete, personnelMap)}</td>
                {cat && (
                  <td>
                    {e.type === "Polygraphie" ? <CATSelect examenId={e.notion_id} value={e.cat} /> : <span className="text-xs text-muted">{EMPTY}</span>}
                  </td>
                )}
                <td><StatusBadge value={e.statut_appareil} map={STATUT_APPAREIL} /></td>
                {action && <td><AppareilRenduButton examenId={e.notion_id} /></td>}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

export default async function ExamensPage() {
  const session = await getSession();
  if (!can(session, "examens")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const supa = await supabaseServer();
  const [examens, patientsIndex, personnelMap, personnel, unites, fees, penalitesExistantes] = await Promise.all([
    supa.from("examens").select("*").order("date_pose", { ascending: false }).limit(200)
      .then((r) => (r.data ?? []) as Examen[]),
    getPatientsIndex(),
    getPersonnelMap(),
    getPersonnel(),
    supa.from("appareils").select("notion_id, ref_appareil, type, etat").order("ref_appareil")
      .then((r) => (r.data ?? []) as Appareil[]),
    // Tarifs de pénalité : lecture ciblée via service role (Paramètres est en zone admin)
    supabaseAdmin().from("parametres").select("parametre, valeur")
      .in("parametre", ["late_fee_holter", "late_fee_polygraphie"])
      .then((r) => new Map((r.data ?? []).map((p) => [p.parametre, Number(p.valeur)]))),
    can(session, "paiements_all")
      ? supa.from("paiements").select("examen").eq("type_prestation", "Pénalité retard")
          .then((r) => new Set(((r.data ?? []) as { examen: string[] | null }[]).flatMap((p) => p.examen ?? [])))
      : Promise.resolve(new Set<string>()),
  ]);

  const aInterpreter = examens.filter((e) => e.statut_appareil === "Rendu" && !e.date_interpretation);
  const aEnvoyer = examens.filter((e) => e.date_interpretation && !e.date_envoi);
  const dehors = examens.filter((e) => ["Remis", "Bientôt dû", "En retard"].includes(e.statut_appareil ?? ""));

  // File « Suivi appareillage » : CAT = PPC et parcours incomplet (S16)
  const suiviAppareillage = examens.filter(
    (e) => e.cat === "Mettre une PPC" && !(e.contacte_appareillage && e.societe_appareillage && e.appareillage_pose_le)
  );

  const now = Date.now();
  const penalty = (e: Examen): { days: number; rate: number; amount: number } | null => {
    if (!e.restitution_prevue) return null;
    const end = e.restitution_effective ? new Date(e.restitution_effective).getTime() : now;
    const days = Math.floor((end - new Date(e.restitution_prevue).getTime()) / 86_400_000);
    if (days <= 0) return null;
    const isPgv = (e.type ?? "").includes("Polygraphie");
    const rate = fees.get(isPgv ? "late_fee_polygraphie" : "late_fee_holter") ?? (isPgv ? 100 : 150);
    return { days, rate, amount: days * rate };
  };

  const canBill = can(session, "paiements_all");
  const shared = { patientsIndex, personnelMap, lang };
  const medecins = personnel.filter((p) => p.role === "Médecin" && p.actif);
  const patientsList = [...patientsIndex.values()].map((p) => ({ notion_id: p.notion_id, nom: p.nom })).sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? ""));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Activity />}
        title={tr.examens.title}
        subtitle={tr.examens.subtitle}
        actions={<NouvelExamenButton patients={patientsList} interpretes={medecins} unites={unites} />}
      />
      <Section title={tr.examens.toInterpret} icon={<Microscope />} subtitle={tr.examens.toInterpretSub} rows={aInterpreter} cat {...shared} />
      <Section title={tr.examens.toSend} icon={<Send />} subtitle={tr.examens.toSendSub} rows={aEnvoyer} cat {...shared} />

      {/* Suivi appareillage (SAS) : la file se vide quand contact + société + pose sont faits */}
      <Card>
        <CardHeader icon={<Stethoscope />} title={tr.examens.aftercare} subtitle={tr.examens.aftercareSub} />
        {suiviAppareillage.length === 0 ? (
          <Empty message={tr.examens.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.common.reference}</th><th>{tr.common.patient}</th><th>{tr.examens.colCAT}</th><th>{tr.examens.colContacted}</th><th>{tr.examens.colCompany}</th><th>{tr.examens.colFitted}</th><th>{tr.examens.rdvPgvLabel}</th><th>{tr.examens.rdvPneumoLabel}</th><th></th>
            </THead>
            <TBody>
              {suiviAppareillage.map((e) => (
                <Tr key={e.notion_id}>
                  <td className="font-medium">{e.ref_examen ?? EMPTY}</td>
                  <td>{patientName(e.patient, patientsIndex)}</td>
                  <td><StatusBadge value={e.cat} map={CAT_EXAMEN} /></td>
                  <td>{e.contacte_appareillage ? <Badge tone="green">{tv(lang, "Oui")}</Badge> : <Badge tone="orange">{tv(lang, "Non")}</Badge>}</td>
                  <td className="text-xs">{e.societe_appareillage ?? EMPTY}</td>
                  <td className="whitespace-nowrap">{formatDate(e.appareillage_pose_le, lang)}</td>
                  <td className="whitespace-nowrap">{formatDate(e.rdv_suivi_pgv, lang)}</td>
                  <td className="whitespace-nowrap">{formatDate(e.rdv_pneumologue, lang)}</td>
                  <td><AppareillageButton examen={e} /></td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Appareils dehors, avec pénalité calculée sur les retards */}
      <Card>
        <CardHeader icon={<Watch />} title={tr.examens.devicesOut} subtitle={tr.examens.devicesOutSub} />
        {dehors.length === 0 ? (
          <Empty message={tr.examens.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.common.reference}</th><th>{tr.common.patient}</th><th>{tr.common.type}</th><th>{tr.appareils.colUnit}</th><th>{tr.examens.colPose}</th><th>{tr.examens.colReturn}</th><th>{tr.common.status}</th><th>{tr.examens.colPenalty}</th><th></th>
            </THead>
            <TBody>
              {dehors.map((e) => {
                const p = penalty(e);
                const dejaFacturee = penalitesExistantes.has(e.notion_id);
                return (
                  <Tr key={e.notion_id}>
                    <td className="font-medium">{e.ref_examen ?? EMPTY}</td>
                    <td>{patientName(e.patient, patientsIndex)}</td>
                    <td className="text-xs">{e.type ?? EMPTY}</td>
                    <td className="text-xs text-muted">{e.numero_appareil ?? EMPTY}</td>
                    <td className="whitespace-nowrap">{formatDate(e.date_pose, lang)}</td>
                    <td className="whitespace-nowrap">{formatDate(e.restitution_prevue, lang)}</td>
                    <td><StatusBadge value={e.statut_appareil} map={STATUT_APPAREIL} /></td>
                    <td>
                      {p ? (
                        <span className="whitespace-nowrap text-xs font-semibold text-danger">
                          {tr.examens.penaltyDays(p.days, formatEuro(p.amount, lang))}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">{EMPTY}</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <AppareilRenduButton examenId={e.notion_id} />
                        {canBill && p && !dejaFacturee && (
                          <FacturerPenaliteButton examenId={e.notion_id} days={p.days} amount={formatEuro(p.amount, lang)} />
                        )}
                      </div>
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
