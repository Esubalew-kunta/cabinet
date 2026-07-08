import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnel, getPatientsIndex, patientName, isSoignant } from "@/lib/data";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { AutoSubmitSelect } from "@/components/ui/auto-submit-select";
import { PRIORITE, NIVEAU_VIGILANCE } from "@/lib/labels";
import { formatDate, EMPTY } from "@/lib/utils";
import { StatutSelect, NouvelleTacheButton } from "@/components/interactive";
import { ArrowRight, ListChecks, Microscope, Stethoscope, Users } from "lucide-react";
import type { Dossier, Tache, Examen, Patient } from "@/lib/types";

export default async function MedecinPage({
  searchParams,
}: {
  searchParams: Promise<{ medecin?: string }>;
}) {
  const session = await getSession();
  const { member } = session;
  const isSupervisor = member.is_owner || member.role === "admin";
  // L'IPA est traitée comme un médecin (décision 8 juil.)
  if (!isSupervisor && member.role !== "medecin" && member.role !== "ipa") redirect(homeFor(member));
  const { lang, tr } = await getTr();

  const params = await searchParams;
  const supa = await supabaseServer();
  const personnel = await getPersonnel();
  const medecins = personnel.filter(isSoignant);

  // Le médecin voit les siens (RLS fait déjà foi) ; owner/admin peuvent filtrer.
  const focusId = isSupervisor
    ? params.medecin || member.personnel_notion_id || null
    : member.personnel_notion_id;

  const filterByMedecin = <T extends { medecin_assigne?: string[] }>(rows: T[]): T[] =>
    focusId ? rows.filter((r) => (r.medecin_assigne ?? []).includes(focusId)) : rows;

  const [dossiersRaw, patientsIndex, tachesRaw, examensRaw] = await Promise.all([
    supa
      .from("dossiers")
      .select("*")
      .eq("visible_medecin", true)
      .neq("statut_medecin", "Terminé")
      .order("rendez_vous", { ascending: true, nullsFirst: false })
      .limit(60)
      .then((r) => (r.data ?? []) as Dossier[]),
    getPatientsIndex(),
    supa
      .from("taches")
      .select("*")
      .neq("statut", "Terminé")
      .order("echeance", { ascending: true, nullsFirst: false })
      .limit(60)
      .then((r) => (r.data ?? []) as Tache[]),
    supa
      .from("examens")
      .select("*")
      .eq("statut_appareil", "Rendu")
      .is("date_interpretation", null)
      .order("restitution_effective", { ascending: true })
      .limit(20)
      .then((r) => (r.data ?? []) as Examen[]),
  ]);

  const dossiers = filterByMedecin(dossiersRaw);
  const mesTaches = focusId
    ? tachesRaw.filter((t) => (t.responsable ?? []).includes(focusId))
    : tachesRaw;
  const mesPatients: Patient[] = Array.from(patientsIndex.values())
    .filter((p) => p.statut !== "Inactif")
    .filter((p) => (focusId ? (p.medecin_assigne ?? []).includes(focusId) : true))
    .sort((a, b) => (a.prochain_rdv ?? "9999").localeCompare(b.prochain_rdv ?? "9999"))
    .slice(0, 30);
  const aInterpreter = focusId
    ? examensRaw.filter(
        (e) =>
          (e.interprete ?? []).includes(focusId) ||
          (e.responsable ?? []).includes(focusId) ||
          (e.patient ?? []).some((pid) => (patientsIndex.get(pid)?.medecin_assigne ?? []).includes(focusId))
      )
    : examensRaw;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Stethoscope />}
        title={tr.medecin.title}
        subtitle={tr.medecin.subtitle}
        actions={
          <>
            {isSupervisor && (
              <form className="flex items-center gap-1.5">
                <label className="text-xs text-muted">{tr.medecin.view}</label>
                <AutoSubmitSelect name="medecin" defaultValue={focusId ?? ""}>
                  <option value="">{tr.medecin.allDoctors}</option>
                  {medecins.map((m) => (
                    <option key={m.notion_id} value={m.notion_id}>
                      {m.nom}
                    </option>
                  ))}
                </AutoSubmitSelect>
              </form>
            )}
            <NouvelleTacheButton personnel={personnel.filter((p) => p.actif)} />
          </>
        }
      />

      <Card>
        <CardHeader icon={<Stethoscope />} title={tr.medecin.inboxTitle} subtitle={tr.medecin.inboxSub} />
        {dossiers.length === 0 ? (
          <Empty message={tr.medecin.inboxEmpty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.secretariat.colDossier}</th><th>{tr.common.patient}</th><th>{tr.secretariat.colMotif}</th><th>{tr.medecin.colSummary}</th><th>{tr.medecin.colRdv}</th><th>{tr.common.priority}</th><th>{tr.medecin.colStatusMed}</th>
            </THead>
            <TBody>
              {dossiers.map((d) => (
                <Tr key={d.notion_id}>
                  <td>
                    <Link href={`/dossiers/${d.notion_id}`} className="font-medium text-primary hover:underline">
                      {d.id_dossier ?? EMPTY}
                    </Link>
                  </td>
                  <td>
                    {d.patient?.[0] ? (
                      <Link href={`/patients/${d.patient[0]}`} className="text-primary hover:underline">
                        {patientName(d.patient, patientsIndex)}
                      </Link>
                    ) : (
                      EMPTY
                    )}
                  </td>
                  <td>{d.motif ?? EMPTY}</td>
                  <td className="max-w-56 truncate text-xs text-muted" title={d.resume_motif ?? ""}>
                    {d.resume_motif ?? EMPTY}
                  </td>
                  <td className="whitespace-nowrap">{formatDate(d.rendez_vous, lang)}</td>
                  <td><StatusBadge value={d.priorite} map={PRIORITE} /></td>
                  <td>
                    <StatutSelect
                      id={d.notion_id}
                      value={d.statut_medecin}
                      kind="medecin"
                      options={["À lire", "À valider", "En rédaction", "En attente", "En cours", "Terminé"]}
                    />
                  </td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon={<Users />}
            title={tr.medecin.patientsTitle}
            subtitle={tr.medecin.patientsSub}
            action={
              <Link href="/patients" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {tr.common.seeAll} <ArrowRight className="size-3" />
              </Link>
            }
          />
          {mesPatients.length === 0 ? (
            <Empty message={tr.medecin.patientsEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.common.patient}</th><th>{tr.medecin.colProblem}</th><th>{tr.medecin.colVigilance}</th><th>{tr.medecin.colNextRdv}</th>
              </THead>
              <TBody>
                {mesPatients.map((p) => (
                  <Tr key={p.notion_id}>
                    <td>
                      <Link href={`/patients/${p.notion_id}`} className="font-medium text-primary hover:underline">
                        {p.nom}
                      </Link>
                    </td>
                    <td className="text-xs">{p.probleme_principal ?? EMPTY}</td>
                    <td><StatusBadge value={p.niveau_vigilance} map={NIVEAU_VIGILANCE} /></td>
                    <td className="whitespace-nowrap">{formatDate(p.prochain_rdv, lang)}</td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader icon={<Microscope />} title={tr.medecin.examsTitle} subtitle={tr.medecin.examsSub} />
            {aInterpreter.length === 0 ? (
              <Empty message={tr.medecin.examsEmpty} />
            ) : (
              <Table>
                <THead>
                  <th>{tr.common.reference}</th><th>{tr.common.patient}</th><th>{tr.common.type}</th><th>{tr.medecin.colReturnedOn}</th>
                </THead>
                <TBody>
                  {aInterpreter.map((e) => (
                    <Tr key={e.notion_id}>
                      <td className="font-medium">{e.ref_examen ?? EMPTY}</td>
                      <td>{patientName(e.patient, patientsIndex)}</td>
                      <td className="text-xs">{e.type ?? EMPTY}</td>
                      <td className="whitespace-nowrap">{formatDate(e.restitution_effective, lang)}</td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              icon={<ListChecks />}
              title={tr.medecin.myTasksTitle}
              subtitle={tr.medecin.myTasksSub}
              action={
                <Link href="/taches" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  {tr.common.seeAll} <ArrowRight className="size-3" />
                </Link>
              }
            />
            {mesTaches.length === 0 ? (
              <Empty message={tr.medecin.myTasksEmpty} />
            ) : (
              <Table>
                <THead>
                  <th>{tr.taches.colTask}</th><th>{tr.common.due}</th><th>{tr.common.status}</th>
                </THead>
                <TBody>
                  {mesTaches.slice(0, 10).map((t) => (
                    <Tr key={t.notion_id}>
                      <td className="font-medium">{t.titre}</td>
                      <td className="whitespace-nowrap">{formatDate(t.echeance, lang)}</td>
                      <td>
                        <StatutSelect
                          id={t.notion_id}
                          value={t.statut}
                          kind="tache"
                          options={["À faire", "En cours", "En attente", "Bloqué", "Terminé"]}
                        />
                      </td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
