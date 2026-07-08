import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnelMap } from "@/lib/data";
import { Card, CardHeader, CardBody, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SyncBanner } from "@/components/sync-banner";
import { formatDate, formatEuro } from "@/lib/utils";
import { tv, type Lang } from "@/lib/i18n/dict";
import { ParametreValeur } from "@/components/interactive";
import { CreditCard, FileText, FolderOpen, ListChecks, RefreshCw, Settings2, SlidersHorizontal, Users, Watch } from "lucide-react";
import type { SyncRun } from "@/lib/types";

type Rapport = {
  notion_id: string;
  titre: string | null;
  type: string | null;
  date_rapport: string | null;
  a_lire: number | null;
  a_envoyer: number | null;
  appareils_en_retard: number | null;
  paiements_a_relancer: number | null;
  dossiers_a_valider: number | null;
};
type Parametre = { notion_id: string; parametre: string | null; valeur: string | null; description: string | null };

function CountList({ counts, lang, emptyLabel }: { counts: Map<string, number>; lang: Lang; emptyLabel: string }) {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (entries.length === 0) return <p className="text-sm text-muted">{emptyLabel}</p>;
  return (
    <div className="space-y-2">
      {entries.map(([label, n]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-40 truncate text-xs" title={label}>{tv(lang, label)}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-primary/70 transition-[width]" style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <span className="w-6 text-right text-xs tabular-nums text-muted">{n}</span>
        </div>
      ))}
    </div>
  );
}

export default async function AdminPage() {
  const session = await getSession();
  if (!can(session, "admin_stats")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const supa = await supabaseServer();
  const personnelMap = await getPersonnelMap();

  const [patients, dossiers, examens, paiements, taches, syncRuns, rapports, parametres, stock] = await Promise.all([
    supa.from("patients").select("notion_id, statut, probleme_principal").then((r) => r.data ?? []),
    supa.from("dossiers").select("notion_id, statut_intake").then((r) => r.data ?? []),
    supa.from("examens").select("notion_id, statut_appareil").then((r) => r.data ?? []),
    supa.from("paiements").select("notion_id, statut_paiement, montant_du, montant_paye").then((r) => r.data ?? []),
    supa.from("taches").select("notion_id, statut, responsable").neq("statut", "Terminé").then((r) => r.data ?? []),
    supa.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(5).then((r) => (r.data ?? []) as SyncRun[]),
    supa.from("rapports").select("*").order("date_rapport", { ascending: false }).limit(6).then((r) => (r.data ?? []) as Rapport[]),
    supa.from("parametres").select("notion_id, parametre, valeur, description").order("parametre").then((r) => (r.data ?? []) as Parametre[]),
    supa.from("stock").select("quantite, seuil_minimum").then((r) => (r.data ?? []) as { quantite: number | null; seuil_minimum: number | null }[]),
  ]);
  const isAdmin = session.member.is_owner || session.member.role === "admin";
  const stockBas = stock.filter((s) => Number(s.quantite ?? 0) <= Number(s.seuil_minimum ?? 0)).length;

  const patientsActifs = patients.filter((p) => p.statut === "Actif").length;
  const dossiersEnAttente = dossiers.filter((d) => !["Terminé"].includes(d.statut_intake ?? "")).length;
  const appareilsEnRetard = examens.filter((e) => e.statut_appareil === "En retard").length;
  const totalEncaisse = paiements.reduce((s, p) => s + Number(p.montant_paye ?? 0), 0);

  const count = <T,>(rows: T[], key: (r: T) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r) ?? "?";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  const tachesParPersonne = new Map<string, number>();
  for (const t of taches) {
    const ids = (t.responsable ?? []) as string[];
    const nom = ids.length ? personnelMap.get(ids[0]) ?? "?" : tr.common.notAssigned;
    tachesParPersonne.set(nom, (tachesParPersonne.get(nom) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={<Settings2 />} title={tr.admin.title} subtitle={tr.admin.subtitle} />

      <SyncBanner lastRun={syncRuns[0] ?? null} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={tr.admin.activePatients} value={patientsActifs} />
        <StatCard label={tr.admin.pendingDossiers} value={dossiersEnAttente} tone={dossiersEnAttente > 0 ? "warning" : "default"} />
        <StatCard label={tr.admin.overdueDevices} value={appareilsEnRetard} tone={appareilsEnRetard > 0 ? "danger" : "success"} />
        <StatCard label={tr.admin.lowStock} value={stockBas} tone={stockBas > 0 ? "warning" : "success"} />
        <StatCard label={tr.admin.totalCollected} value={formatEuro(totalEncaisse, lang)} tone="success" />
      </div>

      {/* Rapports n8n (C1 quotidien / C2 hebdomadaire) — enfin affichés */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<FileText />} title={tr.admin.rapportsTitle} subtitle={tr.admin.rapportsSub} />
          <CardBody>
            {rapports.length === 0 ? (
              <p className="text-sm text-muted">{tr.admin.rapportsEmpty}</p>
            ) : (
              <ul className="space-y-3">
                {rapports.map((r) => (
                  <li key={r.notion_id} className="rounded-lg border border-border bg-background/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {r.type === "Hebdomadaire" ? tr.admin.rapWeekly : tr.admin.rapDaily}
                        <span className="ml-2 text-xs font-normal text-muted">{formatDate(r.date_rapport, lang)}</span>
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {[
                        [r.a_lire, tr.admin.rapToRead],
                        [r.a_envoyer, tr.admin.rapToSend],
                        [r.dossiers_a_valider, tr.admin.rapToValidate],
                        [r.appareils_en_retard, tr.admin.rapLate],
                        [r.paiements_a_relancer, tr.admin.rapToChase],
                      ]
                        .filter(([n]) => n !== null && n !== undefined)
                        .map(([n, label]) => `${n} ${label}`)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Éditeur de Paramètres (tarifs de pénalité, offsets, test_mode) */}
        <Card>
          <CardHeader icon={<SlidersHorizontal />} title={tr.admin.paramsTitle} subtitle={tr.admin.paramsSub} />
          <CardBody>
            {parametres.length === 0 ? (
              <p className="text-sm text-muted">{tr.admin.paramsEmpty}</p>
            ) : (
              <ul className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                {parametres.map((p) => (
                  <li key={p.notion_id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-medium">{p.parametre}</p>
                      {p.description && <p className="truncate text-xs text-muted">{p.description}</p>}
                    </div>
                    {isAdmin ? (
                      <ParametreValeur parametreId={p.notion_id} valeur={p.valeur} />
                    ) : (
                      <span className="font-mono text-xs">{p.valeur}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader icon={<FolderOpen />} title={tr.admin.dossiersByStatus} />
          <CardBody><CountList counts={count(dossiers, (d) => d.statut_intake)} lang={lang} emptyLabel={tr.admin.noData} /></CardBody>
        </Card>
        <Card>
          <CardHeader icon={<ListChecks />} title={tr.admin.tasksByPerson} />
          <CardBody><CountList counts={tachesParPersonne} lang={lang} emptyLabel={tr.admin.noData} /></CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Users />} title={tr.admin.patientsByProblem} />
          <CardBody><CountList counts={count(patients, (p) => p.probleme_principal)} lang={lang} emptyLabel={tr.admin.noData} /></CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Watch />} title={tr.admin.devicesByStatus} />
          <CardBody><CountList counts={count(examens, (e) => e.statut_appareil)} lang={lang} emptyLabel={tr.admin.noData} /></CardBody>
        </Card>
        <Card>
          <CardHeader icon={<CreditCard />} title={tr.admin.paymentsByStatus} />
          <CardBody><CountList counts={count(paiements, (p) => p.statut_paiement)} lang={lang} emptyLabel={tr.admin.noData} /></CardBody>
        </Card>
        <Card>
          <CardHeader icon={<RefreshCw />} title={tr.admin.lastSyncs} />
          <CardBody>
            {syncRuns.length === 0 ? (
              <p className="text-sm text-muted">{tr.admin.noRun}</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {syncRuns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="text-muted">{new Date(r.started_at).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB")}</span>
                    <span className={r.status === "success" ? "text-success" : r.status === "error" ? "text-danger" : "text-muted"}>
                      {r.status === "success" ? tr.admin.ok : r.status === "error" ? tr.common.error : tr.admin.running}
                      {r.detail ? ` · ${Object.values(r.detail).reduce((a, b) => a + Number(b), 0)} ${tr.admin.rows}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
