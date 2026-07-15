import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPersonnel, getPatientsIndex, patientName } from "@/lib/data";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { AutoSubmitSelect } from "@/components/ui/auto-submit-select";
import { PRIORITE, CATEGORIE_TACHE, CATEGORIES_TACHE } from "@/lib/labels";
import { tv, RECURRENCE } from "@/lib/i18n/dict";
import { formatDate, cn, EMPTY } from "@/lib/utils";
import {
  NouvelleTacheButton,
  StatutSelect,
  ReassignerSelect,
  TacheTermineeButton,
  SupprimerTacheButton,
} from "@/components/interactive";
import { ListChecks } from "lucide-react";
import type { Tache } from "@/lib/types";

const FILTRES = ["ouvertes", "pool", "retard", "toutes", "recurrentes", "terminees"] as const;

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
  searchParams: Promise<{ filtre?: string; domaine?: string; categorie?: string; qui?: string }>;
}) {
  const session = await getSession();
  if (!can(session, "taches")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const { filtre = "ouvertes", domaine, categorie, qui } = await searchParams;
  const supa = await supabaseServer();

  // Filtre « qui » : par défaut = mes tâches (si le compte est relié à une fiche),
  // « __all__ » = toute l'équipe, sinon la personne choisie.
  const myId = session.member.personnel_notion_id;
  const quiEff = qui ?? myId ?? "__all__";

  let query = supa.from("taches").select("*");
  if (filtre === "ouvertes" || filtre === "pool" || filtre === "retard") query = query.neq("statut", "Terminé");
  if (filtre === "terminees") query = query.eq("statut", "Terminé");
  if (filtre === "recurrentes") query = query.eq("calendrier", "Récurrente");
  if (domaine) query = query.eq("domaine", domaine);
  if (categorie) query = query.eq("categorie", categorie);
  if (quiEff && quiEff !== "__all__") query = query.contains("responsable", [quiEff]);

  const [{ data }, ouvertes, personnel, patientsIndex, ownerId, maJournee] = await Promise.all([
    query.order("echeance", { ascending: true, nullsFirst: false }).limit(200),
    // Toutes les tâches ouvertes (pour le résumé par personne, hors filtres)
    supa.from("taches").select("responsable, echeance").neq("statut", "Terminé").limit(500)
      .then((r) => (r.data ?? []) as Pick<Tache, "responsable" | "echeance">[]),
    getPersonnel(),
    getPatientsIndex(),
    getOwnerPersonnelId(),
    // « Ma journée » : MES tâches datées et ouvertes. Volontairement indépendant des filtres
    // de la table — c'est la liste de la personne connectée, pas une vue de la table.
    myId
      ? supa
          .from("taches")
          .select("*")
          .neq("statut", "Terminé")
          .not("echeance", "is", null)
          .contains("responsable", [myId])
          .order("echeance", { ascending: true })
          .limit(50)
          .then((r) => (r.data ?? []) as Tache[])
      : Promise.resolve([] as Tache[]),
  ]);
  let taches = (data ?? []) as Tache[];

  // En retard : échéance passée et pas marquée Terminé.
  const now = Date.now();
  const isOverdue = (t: Pick<Tache, "echeance"> & { statut?: string | null }) =>
    Boolean(t.echeance) && new Date(t.echeance as string).getTime() < now && t.statut !== "Terminé";
  if (filtre === "retard") taches = taches.filter((t) => isOverdue(t));

  // Pool (« À prendre ») : sans responsable, ou au propriétaire par défaut.
  const isPool = (t: Tache) => {
    const r = t.responsable ?? [];
    return r.length === 0 || (ownerId !== null && r.length === 1 && r[0] === ownerId);
  };
  if (filtre === "pool") taches = taches.filter(isPool);

  // Résumé par personne : « Rita 3 (1 en retard) · … » sur toutes les tâches ouvertes.
  const parPersonne = new Map<string, { open: number; overdue: number }>();
  for (const t of ouvertes) {
    const key = t.responsable?.[0] ?? "__pool__";
    const s = parPersonne.get(key) ?? { open: 0, overdue: 0 };
    s.open++;
    if (t.echeance && new Date(t.echeance).getTime() < now) s.overdue++;
    parPersonne.set(key, s);
  }

  // « Ma journée » : en retard / aujourd'hui / à venir (7 j). Au-delà d'une semaine, ce
  // n'est plus une checklist du jour — ça reste dans la table en dessous.
  const todayISO = new Date(now).toISOString().slice(0, 10);
  const dans7j = new Date(now + 7 * 86_400_000).toISOString().slice(0, 10);
  const journee: Record<"retard" | "aujourdhui" | "avenir", Tache[]> = { retard: [], aujourdhui: [], avenir: [] };
  for (const t of maJournee) {
    const d = (t.echeance ?? "").slice(0, 10);
    if (!d) continue;
    if (d < todayISO) journee.retard.push(t);
    else if (d === todayISO) journee.aujourdhui.push(t);
    else if (d <= dans7j) journee.avenir.push(t);
  }
  const journeeVide = journee.retard.length + journee.aujourdhui.length + journee.avenir.length === 0;

  const canDelete = session.member.is_owner || session.member.role === "admin";
  const actifs = personnel.filter((p) => p.actif);
  const patientsList = Array.from(patientsIndex.values())
    .filter((p) => p.statut !== "Inactif")
    .map((p) => ({ notion_id: p.notion_id, nom: p.nom }))
    .sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? ""));

  const urlFor = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { filtre, domaine, categorie, qui, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/taches?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<ListChecks />}
        title={tr.taches.title}
        subtitle={tr.taches.subtitle}
        actions={<NouvelleTacheButton personnel={actifs} patients={patientsList} ownerId={ownerId} />}
      />

      {/* Ma journée : chaque membre coche SES tâches, sans toucher aux filtres de la table.
          Un compte non relié à une fiche Personnel n'a pas de « siennes » — on n'affiche rien. */}
      {myId && !journeeVide && (
        <Card>
          <CardHeader
            icon={<ListChecks />}
            title={tr.taches.myDay}
            subtitle={tr.taches.myDaySub}
            action={
              <span className="shrink-0 rounded-full bg-background px-2.5 py-1 text-xs font-semibold text-muted">
                {tr.taches.myDayCount(journee.retard.length + journee.aujourdhui.length + journee.avenir.length)}
              </span>
            }
          />
          <CardBody className="space-y-3">
            {(["retard", "aujourdhui", "avenir"] as const).map((groupe) =>
              journee[groupe].length === 0 ? null : (
                <div key={groupe} className="space-y-1">
                  <div
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wide",
                      groupe === "retard" ? "text-danger" : "text-muted"
                    )}
                  >
                    {tr.taches.myDayGroups[groupe]} · {journee[groupe].length}
                  </div>
                  <ul className="space-y-1">
                    {journee[groupe].map((t) => (
                      <li key={t.notion_id} className="flex items-center gap-2">
                        <TacheTermineeButton tacheId={t.notion_id} statut={t.statut} />
                        <Link
                          href={`/taches/${t.notion_id}`}
                          className="min-w-0 flex-1 truncate text-sm hover:text-primary hover:underline"
                        >
                          {t.titre}
                        </Link>
                        {t.categorie && <StatusBadge value={t.categorie} map={CATEGORIE_TACHE} />}
                        <span
                          className={cn(
                            "shrink-0 whitespace-nowrap text-xs",
                            groupe === "retard" ? "font-semibold text-danger" : "text-muted"
                          )}
                        >
                          {formatDate(t.echeance, lang)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </CardBody>
        </Card>
      )}

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
        <form className="ml-auto">
          <AutoSubmitSelect name="qui" defaultValue={qui ?? (myId ?? "__all__")}>
            {myId && <option value={myId}>{tr.taches.myTasks}</option>}
            <option value="__all__">{tr.common.everyone}</option>
            {actifs.filter((p) => p.notion_id !== myId).map((p) => (
              <option key={p.notion_id} value={p.notion_id}>{p.nom}</option>
            ))}
          </AutoSubmitSelect>
          <input type="hidden" name="filtre" value={filtre} />
          {categorie && <input type="hidden" name="categorie" value={categorie} />}
        </form>
      </div>

      {/* Catégories (réunion juil. 2026) : Administration · Patient · Mobilier · Paiement */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={urlFor({ categorie: undefined })}>
          <Badge
            tone={categorie ? "gray" : "blue"}
            className={cn("transition-opacity hover:opacity-80", !categorie && "ring-1 ring-primary/40")}
          >
            {tr.taches.allCategories}
          </Badge>
        </Link>
        {CATEGORIES_TACHE.map((c) => (
          <Link key={c} href={urlFor({ categorie: categorie === c ? undefined : c })}>
            <Badge
              tone={CATEGORIE_TACHE[c]}
              className={cn(
                "transition-opacity hover:opacity-80",
                categorie === c ? "ring-1 ring-primary/40" : "opacity-70"
              )}
            >
              {tv(lang, c)}
            </Badge>
          </Link>
        ))}
      </div>

      {/* Qui a quoi : résumé des tâches ouvertes par personne */}
      {parPersonne.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[...parPersonne.entries()]
            .sort((a, b) => b[1].open - a[1].open)
            .map(([pid, s]) => {
              const nom = pid === "__pool__"
                ? tr.taches.poolBadge
                : personnel.find((p) => p.notion_id === pid)?.nom ?? "?";
              return (
                <Link key={pid} href={urlFor({ qui: pid === "__pool__" ? undefined : pid, filtre: "ouvertes" })}>
                  <Badge tone={s.overdue > 0 ? "red" : "gray"} className="transition-opacity hover:opacity-80">
                    {nom} {s.open}
                    {s.overdue > 0 ? ` (${tr.taches.overdueCount(s.overdue)})` : ""}
                  </Badge>
                </Link>
              );
            })}
        </div>
      )}

      <Card>
        {taches.length === 0 ? (
          <Empty message={tr.taches.empty} />
        ) : (
          <Table>
            <THead>
              <th></th><th>{tr.taches.colTask}</th><th>{tr.dialogs.categoryField}</th><th>{tr.common.due}</th><th>{tr.common.patient}</th><th>{tr.taches.colOwner}</th><th>{tr.common.priority}</th><th>{tr.common.status}</th>{canDelete && <th></th>}
            </THead>
            <TBody>
              {taches.map((t) => (
                <Tr key={t.notion_id}>
                  <td className="w-9">
                    {t.statut !== "Terminé" && <TacheTermineeButton tacheId={t.notion_id} statut={t.statut} />}
                  </td>
                  <td className="max-w-64 font-medium">
                    <Link href={`/taches/${t.notion_id}`} className="hover:text-primary hover:underline">
                      {t.titre}
                    </Link>
                    {isPool(t) && t.statut !== "Terminé" && (
                      <Badge tone="orange" className="ml-2">{tr.taches.poolBadge}</Badge>
                    )}
                    {t.calendrier === "Récurrente" && (
                      <Badge tone="violet" className="ml-2">
                        {t.recurrence ? RECURRENCE[lang][t.recurrence] ?? tr.dialogs.recurringBadge : tr.dialogs.recurringBadge}
                      </Badge>
                    )}
                  </td>
                  <td>
                    {t.categorie ? <StatusBadge value={t.categorie} map={CATEGORIE_TACHE} /> : EMPTY}
                  </td>
                  <td className={cn("whitespace-nowrap", isOverdue(t) && "font-semibold text-danger")}>
                    {formatDate(t.echeance, lang)}
                    {isOverdue(t) && <Badge tone="red" className="ml-2">{tr.taches.filters.retard}</Badge>}
                  </td>
                  <td className="text-xs">
                    {t.patient_lie?.[0] ? (
                      <Link href={`/patients/${t.patient_lie[0]}`} className="text-primary hover:underline">
                        {patientName(t.patient_lie, patientsIndex)}
                      </Link>
                    ) : EMPTY}
                  </td>
                  <td>
                    <ReassignerSelect tacheId={t.notion_id} value={t.responsable?.[0] ?? null} personnel={actifs} />
                  </td>
                  <td><StatusBadge value={t.priorite} map={PRIORITE} /></td>
                  <td>
                    <StatutSelect
                      id={t.notion_id}
                      value={t.statut}
                      kind="tache"
                      options={["À faire", "En cours", "Terminé"]}
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
