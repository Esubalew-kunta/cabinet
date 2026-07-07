import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPatientsIndex, patientName, getPersonnelMap, personName } from "@/lib/data";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { STATUT_APPAREIL } from "@/lib/labels";
import { formatDate, EMPTY } from "@/lib/utils";
import { AppareilRenduButton } from "@/components/interactive";
import { Activity, Microscope, Send, Watch } from "lucide-react";
import type { Lang } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/dict";
import type { Examen, Patient } from "@/lib/types";

function Section({
  title, icon, subtitle, rows, action, patientsIndex, personnelMap, lang,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle: string;
  rows: Examen[];
  action?: boolean;
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
            <th>{tr.common.reference}</th><th>{tr.common.patient}</th><th>{tr.common.type}</th><th>{tr.examens.colIndication}</th><th>{tr.examens.colPose}</th><th>{tr.examens.colReturn}</th><th>{tr.examens.colInterpreter}</th><th>{tr.common.status}</th>{action && <th></th>}
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
  const [examens, patientsIndex, personnelMap] = await Promise.all([
    supa.from("examens").select("*").order("date_pose", { ascending: false }).limit(200)
      .then((r) => (r.data ?? []) as Examen[]),
    getPatientsIndex(),
    getPersonnelMap(),
  ]);

  const aInterpreter = examens.filter((e) => e.statut_appareil === "Rendu" && !e.date_interpretation);
  const aEnvoyer = examens.filter((e) => e.date_interpretation && !e.date_envoi);
  const dehors = examens.filter((e) => ["Remis", "Bientôt dû", "En retard"].includes(e.statut_appareil ?? ""));

  const shared = { patientsIndex, personnelMap, lang };

  return (
    <div className="space-y-4">
      <PageHeader icon={<Activity />} title={tr.examens.title} subtitle={tr.examens.subtitle} />
      <Section title={tr.examens.toInterpret} icon={<Microscope />} subtitle={tr.examens.toInterpretSub} rows={aInterpreter} {...shared} />
      <Section title={tr.examens.toSend} icon={<Send />} subtitle={tr.examens.toSendSub} rows={aEnvoyer} {...shared} />
      <Section title={tr.examens.devicesOut} icon={<Watch />} subtitle={tr.examens.devicesOutSub} rows={dehors} action {...shared} />
    </div>
  );
}
