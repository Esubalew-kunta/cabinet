import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPatientsIndex, patientName, getPersonnelMap, personName } from "@/lib/data";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { CAT_EXAMEN, CONCLUSION_EXAMEN } from "@/lib/labels";
import { formatDate, EMPTY } from "@/lib/utils";
import { InterpreterButton, EnvoyerExamenButton, AppareillageButton } from "@/components/interactive";
import { Activity, Microscope, Send, Stethoscope } from "lucide-react";
import { tv } from "@/lib/i18n/dict";
import type { Examen } from "@/lib/types";

/**
 * L'atelier d'interprétation : les examens rendus qu'il faut lire, envoyer,
 * et le suivi appareillage (apnée). La pose/restitution des appareils vit
 * sur la page Appareils.
 */
export default async function ExamensPage() {
  const session = await getSession();
  if (!can(session, "examens")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const supa = await supabaseServer();
  const [examens, patientsIndex, personnelMap] = await Promise.all([
    supa.from("examens").select("*").order("restitution_effective", { ascending: false }).limit(200)
      .then((r) => (r.data ?? []) as Examen[]),
    getPatientsIndex(),
    getPersonnelMap(),
  ]);

  const aInterpreter = examens.filter((e) => e.statut_appareil === "Rendu" && !e.date_interpretation);
  const aEnvoyer = examens.filter((e) => e.date_interpretation && !e.date_envoi);
  const suiviAppareillage = examens.filter(
    (e) => e.cat === "Mettre une PPC" && !(e.contacte_appareillage && e.societe_appareillage && e.appareillage_pose_le)
  );

  return (
    <div className="space-y-4">
      <PageHeader icon={<Activity />} title={tr.examens.title} subtitle={tr.examens.subtitle} />

      {/* À interpréter */}
      <Card>
        <CardHeader icon={<Microscope />} title={tr.examens.toInterpret} subtitle={tr.examens.toInterpretSub} />
        {aInterpreter.length === 0 ? (
          <Empty message={tr.examens.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.common.reference}</th><th>{tr.common.patient}</th><th>{tr.common.type}</th><th>{tr.examens.colIndication}</th><th>{tr.medecin.colReturnedOn}</th><th>{tr.examens.colInterpreter}</th><th></th>
            </THead>
            <TBody>
              {aInterpreter.map((e) => (
                <Tr key={e.notion_id}>
                  <td className="font-medium">{e.ref_examen ?? EMPTY}</td>
                  <td>{patientName(e.patient, patientsIndex)}</td>
                  <td className="text-xs">{e.type ?? EMPTY}</td>
                  <td className="text-xs">{e.indication ?? EMPTY}</td>
                  <td className="whitespace-nowrap">{formatDate(e.restitution_effective, lang)}</td>
                  <td className="text-xs">{personName(e.interprete, personnelMap)}</td>
                  <td><InterpreterButton examen={e} /></td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* À envoyer */}
      <Card>
        <CardHeader icon={<Send />} title={tr.examens.toSend} subtitle={tr.examens.toSendSub} />
        {aEnvoyer.length === 0 ? (
          <Empty message={tr.examens.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.common.reference}</th><th>{tr.common.patient}</th><th>{tr.common.type}</th><th>{tr.examens.resultsLabel}</th><th>{tr.examens.conclusionLabel}</th><th>{tr.examens.colCAT}</th><th></th>
            </THead>
            <TBody>
              {aEnvoyer.map((e) => (
                <Tr key={e.notion_id}>
                  <td className="font-medium">{e.ref_examen ?? EMPTY}</td>
                  <td>{patientName(e.patient, patientsIndex)}</td>
                  <td className="text-xs">{e.type ?? EMPTY}</td>
                  <td className="max-w-56 truncate text-xs" title={e.resultats ?? ""}>{e.resultats ?? EMPTY}</td>
                  <td>{e.conclusion ? <StatusBadge value={e.conclusion} map={CONCLUSION_EXAMEN} /> : EMPTY}</td>
                  <td>{e.cat ? <StatusBadge value={e.cat} map={CAT_EXAMEN} /> : EMPTY}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <InterpreterButton examen={e} edit />
                      <EnvoyerExamenButton examenId={e.notion_id} />
                    </div>
                  </td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Suivi appareillage (apnée du sommeil) */}
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
    </div>
  );
}
