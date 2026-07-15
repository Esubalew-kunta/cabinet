import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnel, getPersonnelMap, getPatientsIndex, patientName, personName } from "@/lib/data";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { PRIORITE, CATEGORIE_TACHE } from "@/lib/labels";
import { RECURRENCE } from "@/lib/i18n/dict";
import { formatDate, EMPTY } from "@/lib/utils";
import {
  StatutSelect,
  ReassignerSelect,
  TacheTermineeButton,
  SupprimerTacheButton,
  ModifierTacheButton,
  ArreterRecurrenceButton,
} from "@/components/interactive";
import { ArrowLeft, ListChecks } from "lucide-react";
import type { Tache } from "@/lib/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-center gap-3 border-b border-border py-2.5 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="col-span-2 text-sm">{children}</span>
    </div>
  );
}

/** Fiche d'une tâche : détail complet + édition. Cible des liens d'email (B3). */
export default async function TacheDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!can(session, "taches")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();
  const { id } = await params;

  const supa = await supabaseServer();
  const { data: row } = await supa.from("taches").select("*").eq("notion_id", id).maybeSingle();
  const tache = row as Tache | null;

  const [personnel, personnelMap, patientsIndex] = await Promise.all([
    getPersonnel(),
    getPersonnelMap(),
    getPatientsIndex(),
  ]);
  const canDelete = session.member.is_owner || session.member.role === "admin";
  const actifs = personnel.filter((p) => p.actif).map((p) => ({ notion_id: p.notion_id, nom: p.nom }));

  if (!tache) {
    return (
      <div className="space-y-4">
        <Link href="/taches" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-3.5" /> {tr.taches.title}
        </Link>
        <Card><CardBody>{tr.taches.notFound}</CardBody></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/taches" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="size-3.5" /> {tr.taches.title}
      </Link>

      <PageHeader
        icon={<ListChecks />}
        title={tache.titre ?? EMPTY}
        actions={
          <div className="flex items-center gap-2">
            <ModifierTacheButton tache={tache} />
            {tache.statut !== "Terminé" && <TacheTermineeButton tacheId={tache.notion_id} statut={tache.statut} />}
            {canDelete && <SupprimerTacheButton tacheId={tache.notion_id} />}
          </div>
        }
      />

      <Card>
        <CardHeader icon={<ListChecks />} title={tr.taches.title} />
        <CardBody>
          <Row label={tr.common.status}>
            <StatutSelect id={tache.notion_id} value={tache.statut} kind="tache" options={["À faire", "En cours", "Terminé"]} />
          </Row>
          <Row label={tr.taches.colOwner}>
            <ReassignerSelect tacheId={tache.notion_id} value={tache.responsable?.[0] ?? null} personnel={actifs} />
          </Row>
          <Row label={tr.common.due}>{tache.echeance ? formatDate(tache.echeance, lang) : EMPTY}</Row>
          <Row label={tr.common.priority}><StatusBadge value={tache.priorite} map={PRIORITE} /></Row>
          <Row label={tr.dialogs.categoryField}>
            {tache.categorie ? <StatusBadge value={tache.categorie} map={CATEGORIE_TACHE} /> : EMPTY}
          </Row>
          <Row label={tr.dialogs.recurrence}>
            {tache.calendrier === "Récurrente" ? (
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone="violet">
                  {tache.recurrence ? RECURRENCE[lang][tache.recurrence] ?? tr.dialogs.recurringBadge : tr.dialogs.recurringBadge}
                </Badge>
                <ArreterRecurrenceButton tacheId={tache.notion_id} />
              </span>
            ) : (
              tr.taches.oneOff
            )}
          </Row>
          <Row label={tr.dialogs.noteField}>{tache.note || EMPTY}</Row>
          <Row label={tr.common.patient}>
            {tache.patient_lie?.[0] ? (
              <Link href={`/patients/${tache.patient_lie[0]}`} className="text-primary hover:underline">
                {patientName(tache.patient_lie, patientsIndex)}
              </Link>
            ) : EMPTY}
          </Row>
          <Row label={tr.taches.linkedCase}>
            {tache.dossier_lie?.[0] ? (
              <Link href={`/dossiers/${tache.dossier_lie[0]}`} className="text-primary hover:underline">
                {tr.taches.openCase}
              </Link>
            ) : EMPTY}
          </Row>
          <Row label={tr.taches.createdBy}>
            {tache.cree_par?.length ? personName(tache.cree_par, personnelMap) : EMPTY}
            {tache.created_time && <Badge tone="gray" className="ml-2">{formatDate(tache.created_time, lang)}</Badge>}
          </Row>
        </CardBody>
      </Card>
    </div>
  );
}
