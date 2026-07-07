import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnel, getPersonnelMap, personName } from "@/lib/data";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { STATUT_PATIENT, NIVEAU_VIGILANCE } from "@/lib/labels";
import { formatDate, EMPTY } from "@/lib/utils";
import { NouveauPatientButton, AssignerMedecinSelect } from "@/components/interactive";
import { ExternalLink, Search, Users } from "lucide-react";
import type { Patient } from "@/lib/types";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!can(session, "patients_all") && !can(session, "patients_own")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const { q } = await searchParams;
  const supa = await supabaseServer();

  let query = supa.from("patients").select("*").order("nom");
  if (q) {
    const term = q.trim();
    if (/^\d+$/.test(term)) query = query.eq("psid", Number(term));
    else query = query.or(`nom.ilike.%${term}%,nom_complet.ilike.%${term}%`);
  }
  const { data } = await query.limit(200);
  const patients = (data ?? []) as Patient[];

  const personnel = await getPersonnel();
  const personnelMap = await getPersonnelMap();
  const medecins = personnel.filter((p) => p.role === "Médecin" && p.actif);
  const canManage = can(session, "patients_all");
  const problemes = [
    "Palpitations ou arythmie suspectée", "FA suivi", "Revue Holter", "Suivi hypertension",
    "Cardiologie préventive", "Syncope ou vertige", "Gêne thoracique non urgente", "Suivi post-ablation",
    "Suivi pacemaker ou appareil", "Variabilité tension PGV", "Antécédents familiaux ou dépistage", "Mixte ou à clarifier",
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Users />}
        title={tr.patients.title}
        subtitle={tr.patients.countFor(patients.length, q)}
        actions={canManage && <NouveauPatientButton medecins={medecins} problemes={problemes} />}
      />

      <form className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={tr.patients.searchPlaceholder}
          className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted hover:border-ring/70 focus:outline-2 focus:outline-ring"
        />
      </form>

      <Card>
        {patients.length === 0 ? (
          <Empty message={q ? tr.patients.emptySearch : tr.patients.emptyNoData} />
        ) : (
          <Table>
            <THead>
              <th>PSID</th><th>{tr.patients.colName}</th><th>{tr.patients.colProblem}</th><th>{tr.common.doctor}</th><th>{tr.patients.colVigilance}</th><th>{tr.patients.colNextRdv}</th><th>{tr.common.status}</th><th>Doctolib</th>
            </THead>
            <TBody>
              {patients.map((p) => (
                <Tr key={p.notion_id}>
                  <td className="tabular-nums text-xs text-muted">{p.psid ?? EMPTY}</td>
                  <td>
                    <Link href={`/patients/${p.notion_id}`} className="font-medium text-primary hover:underline">
                      {p.nom ?? tr.common.nameless}
                    </Link>
                  </td>
                  <td className="text-xs">{p.probleme_principal ?? EMPTY}</td>
                  <td>
                    {canManage ? (
                      <AssignerMedecinSelect
                        patientId={p.notion_id}
                        value={p.medecin_assigne?.[0] ?? null}
                        medecins={medecins}
                      />
                    ) : (
                      <span className="text-xs">{personName(p.medecin_assigne, personnelMap)}</span>
                    )}
                  </td>
                  <td><StatusBadge value={p.niveau_vigilance} map={NIVEAU_VIGILANCE} /></td>
                  <td className="whitespace-nowrap">{formatDate(p.prochain_rdv, lang)}</td>
                  <td><StatusBadge value={p.statut} map={STATUT_PATIENT} /></td>
                  <td>
                    {p.lien_doctolib ? (
                      <a
                        href={p.lien_doctolib}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {tr.common.open} <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted">{EMPTY}</span>
                    )}
                  </td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
