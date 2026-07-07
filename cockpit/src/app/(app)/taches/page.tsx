import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPersonnel, getPatientsIndex, patientName } from "@/lib/data";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { AutoSubmitSelect } from "@/components/ui/auto-submit-select";
import { PRIORITE, DOMAINE_TACHE } from "@/lib/labels";
import { RECURRENCE, tv } from "@/lib/i18n/dict";
import { formatDate, cn, EMPTY } from "@/lib/utils";
import {
  NouvelleTacheButton,
  StatutSelect,
  ReassignerSelect,
  TacheTermineeButton,
  PrendreTacheButton,
  SupprimerTacheButton,
} from "@/components/interactive";
import { ListChecks } from "lucide-react";
import type { Tache } from "@/lib/types";

const FILTRES = ["ouvertes", "pool", "toutes", "recurrentes", "terminees"] as const;

/** Id de la fiche Personnel du propriétaire (Dr Amraoui) — mémo par requête. */
async function getOwnerPersonnelId(): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("app_members")
    .select("personnel_notion_id")
    .eq("is_owner", true)
    .not("personnel_notion_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.personnel_notion_id ?? null;
}

export default async function TachesPage({
  searchParams,
}: {
  searchParams: Promise<{ filtre?: string; domaine?: string; qui?: string }>;
}) {
  const session = await getSession();
  if (!can(session, "taches")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const { filtre = "ouvertes", domaine, qui } = await searchParams;
  const supa = await supabaseServer();

  let query = supa.from("taches").select("*");
  if (filtre === "ouvertes" || filtre === "pool") query = query.neq("statut", "Terminé");
  if (filtre === "terminees") query = query.eq("statut", "Terminé");
  if (filtre === "recurrentes") query = query.eq("calendrier", "Récurrente");
  if (domaine) query = query.eq("domaine", domaine);
  if (qui) query = query.contains("responsable", [qui]);

  const [{ data }, personnel, patientsIndex, ownerId] = await Promise.all([
    query.order("echeance", { ascending: true, nullsFirst: false }).limit(200),
    getPersonnel(),
    getPatientsIndex(),
    getOwnerPersonnelId(),
  ]);
  let taches = (data ?? []) as Tache[];

  // Pool (« À prendre ») : sans responsable, ou au propriétaire par défaut.
  const isPool = (t: Tache) => {
    const r = t.responsable ?? [];
    return r.length === 0 || (ownerId !== null && r.length === 1 && r[0] === ownerId);
  };
  if (filtre === "pool") taches = taches.filter(isPool);

  const canDelete = session.member.is_owner || session.member.role === "admin";
  const actifs = personnel.filter((p) => p.actif);
  const patientsList = Array.from(patientsIndex.values())
    .filter((p) => p.statut !== "Inactif")
    .map((p) => ({ notion_id: p.notion_id, nom: p.nom }))
    .sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? ""));

  const urlFor = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { filtre, domaine, qui, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/taches?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<ListChecks />}
        title={tr.taches.title}
        subtitle={tr.taches.subtitle}
        actions={<NouvelleTacheButton personnel={actifs} patients={patientsList} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-surface p-0.5 shadow-sm">
          {FILTRES.map((f) => (
            <Link
              key={f}
              href={urlFor({ filtre: f })}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                filtre === f ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground"
              )}
            >
              {tr.taches.filters[f]}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(DOMAINE_TACHE).map((d) => (
            <Link key={d} href={urlFor({ domaine: domaine === d ? undefined : d })}>
              <Badge
                tone={domaine === d ? DOMAINE_TACHE[d] : "gray"}
                className={cn("transition-opacity", domaine === d ? "" : "opacity-60 hover:opacity-100")}
              >
                {tv(lang, d)}
              </Badge>
            </Link>
          ))}
        </div>
        <form className="ml-auto">
          <AutoSubmitSelect name="qui" defaultValue={qui ?? ""}>
            <option value="">{tr.common.everyone}</option>
            {actifs.map((p) => (
              <option key={p.notion_id} value={p.notion_id}>{p.nom}</option>
            ))}
          </AutoSubmitSelect>
          <input type="hidden" name="filtre" value={filtre} />
          {domaine && <input type="hidden" name="domaine" value={domaine} />}
        </form>
      </div>

      <Card>
        {taches.length === 0 ? (
          <Empty message={tr.taches.empty} />
        ) : (
          <Table>
            <THead>
              <th></th><th>{tr.taches.colTask}</th><th>{tr.taches.colDomain}</th><th>{tr.taches.colRecurrence}</th><th>{tr.common.due}</th><th>{tr.common.patient}</th><th>{tr.taches.colOwner}</th><th>{tr.common.priority}</th><th>{tr.common.status}</th>{canDelete && <th></th>}
            </THead>
            <TBody>
              {taches.map((t) => (
                <Tr key={t.notion_id}>
                  <td className="w-9">
                    {t.statut !== "Terminé" && <TacheTermineeButton tacheId={t.notion_id} statut={t.statut} />}
                  </td>
                  <td className="max-w-64 font-medium">
                    {t.titre}
                    {isPool(t) && t.statut !== "Terminé" && (
                      <Badge tone="orange" className="ml-2">{tr.taches.poolBadge}</Badge>
                    )}
                  </td>
                  <td><StatusBadge value={t.domaine} map={DOMAINE_TACHE} /></td>
                  <td className="text-xs text-muted">
                    {t.calendrier === "Récurrente"
                      ? RECURRENCE[lang][t.recurrence ?? ""] ?? t.recurrence
                      : tr.taches.oneOff}
                  </td>
                  <td className="whitespace-nowrap">{formatDate(t.echeance, lang)}</td>
                  <td className="text-xs">
                    {t.patient_lie?.[0] ? (
                      <Link href={`/patients/${t.patient_lie[0]}`} className="text-primary hover:underline">
                        {patientName(t.patient_lie, patientsIndex)}
                      </Link>
                    ) : EMPTY}
                  </td>
                  <td>
                    {isPool(t) && t.statut !== "Terminé" ? (
                      <PrendreTacheButton tacheId={t.notion_id} />
                    ) : (
                      <ReassignerSelect tacheId={t.notion_id} value={t.responsable?.[0] ?? null} personnel={actifs} />
                    )}
                  </td>
                  <td><StatusBadge value={t.priorite} map={PRIORITE} /></td>
                  <td>
                    <StatutSelect
                      id={t.notion_id}
                      value={t.statut}
                      kind="tache"
                      options={["À faire", "En cours", "En attente", "Bloqué", "Terminé"]}
                    />
                  </td>
                  {canDelete && (
                    <td className="w-9">
                      <SupprimerTacheButton tacheId={t.notion_id} />
                    </td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-muted">{tr.taches.hint}</p>
    </div>
  );
}
