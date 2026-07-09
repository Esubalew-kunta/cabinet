import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnel, getPersonnelMap, getPatientsIndex, personName, isSoignant } from "@/lib/data";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { STATUT_INTAKE, STATUT_MEDECIN, STATUT_CR, STATUT_APPAREIL, STATUT_PAIEMENT, STATUT_TACHE, PRIORITE } from "@/lib/labels";
import { formatDate, formatEuro, EMPTY } from "@/lib/utils";
import { tv } from "@/lib/i18n/dict";
import {
  VerifierDossierButton,
  StatutSelect,
  StatutCRSelect,
  LienCRButton,
  OrdonnanceToggle,
  NouveauDossierButton,
  NouvelleTacheButton,
  NouvelExamenButton,
} from "@/components/interactive";
import { Activity, ArrowLeft, CreditCard, ExternalLink, FileText, FolderOpen, GitBranch, ListChecks, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import type { Dossier, Examen, Paiement, Tache, Appareil } from "@/lib/types";

/**
 * Une page par cas : la porte secrétariat, le cycle de vie du compte rendu,
 * les examens et paiements du patient, et la chaîne de référence
 * (« Créer un dossier de suite »). RLS : un médecin n'ouvre que ses dossiers visibles.
 */
export default async function DossierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!can(session, "dossiers_all") && !can(session, "dossiers_own")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();
  const { id } = await params;

  const supa = await supabaseServer();
  const { data: dossierRow } = await supa.from("dossiers").select("*").eq("notion_id", id).maybeSingle();
  const dossier = dossierRow as Dossier | null;

  if (!dossier) {
    return (
      <div className="space-y-4">
        <Link href="/secretariat" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-3.5" /> {tr.dossierDetail.back}
        </Link>
        <Card><Empty message={tr.dossierDetail.notFound} /></Card>
      </div>
    );
  }

  const patientId = dossier.patient?.[0] ?? null;
  const [patientsIndex, personnelMap, personnel] = await Promise.all([
    getPatientsIndex(),
    getPersonnelMap(),
    getPersonnel(),
  ]);
  const patient = patientId ? patientsIndex.get(patientId) : undefined;

  const [examens, paiements, taches, enfants, parent] = await Promise.all([
    patientId
      ? supa.from("examens").select("*").contains("patient", [patientId]).order("date_pose", { ascending: false }).limit(20)
          .then((r) => (r.data ?? []) as Examen[])
      : Promise.resolve([] as Examen[]),
    patientId && can(session, "paiements_all")
      ? supa.from("paiements").select("*").contains("patient", [patientId]).order("created_time", { ascending: false }).limit(20)
          .then((r) => (r.data ?? []) as Paiement[])
      : Promise.resolve([] as Paiement[]),
    supa.from("taches").select("*").contains("dossier_lie", [id]).neq("statut", "Terminé").limit(20)
      .then((r) => (r.data ?? []) as Tache[]),
    supa.from("dossiers").select("*").contains("dossier_parent", [id]).order("created_time", { ascending: false })
      .then((r) => (r.data ?? []) as Dossier[]),
    dossier.dossier_parent?.[0]
      ? supa.from("dossiers").select("notion_id, id_dossier, motif").eq("notion_id", dossier.dossier_parent[0]).maybeSingle()
          .then((r) => r.data as Pick<Dossier, "notion_id" | "id_dossier" | "motif"> | null)
      : Promise.resolve(null),
  ]);

  // Parc d'appareils (pour poser un appareil directement depuis le cas)
  const canAssignDevice = can(session, "examens");
  const appareils = canAssignDevice
    ? await supa.from("appareils").select("notion_id, ref_appareil, type, etat").then((r) => (r.data ?? []) as Appareil[])
    : [];

  const medecins = personnel.filter(isSoignant);
  const patients = patient ? [{ notion_id: patient.notion_id, nom: patient.nom }] : [];
  const canSecretariat = can(session, "dossiers_all");
  const isVerified = dossier.visible_medecin;

  return (
    <div className="space-y-4">
      <Link href={canSecretariat ? "/secretariat" : "/medecin"} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="size-3.5" /> {tr.dossierDetail.back}
      </Link>

      <PageHeader
        icon={<FolderOpen />}
        title={tr.dossierDetail.title(dossier.id_dossier ?? "")}
        subtitle={
          patient ? (
            <Link href={`/patients/${patient.notion_id}`} className="text-primary hover:underline">
              {patient.nom}
            </Link>
          ) : (
            EMPTY
          )
        }
        actions={
          <NouveauDossierButton
            patients={patients}
            medecins={medecins}
            defaultPatient={patientId ?? undefined}
            parentDossier={dossier.notion_id}
            variant="secondary"
          />
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Informations + porte */}
        <Card>
          <CardHeader
            icon={isVerified ? <LockKeyholeOpen /> : <LockKeyhole />}
            title={tr.dossierDetail.infoTitle}
            subtitle={isVerified ? tr.dossierDetail.gateOpen : tr.dossierDetail.gateClosed}
            action={canSecretariat ? <VerifierDossierButton dossierId={dossier.notion_id} verified={isVerified} /> : undefined}
          />
          <CardBody className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted">{tr.secretariat.colMotif}</p>
                <p className="font-medium">{tv(lang, dossier.motif) ?? EMPTY}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{tr.dossierDetail.colSource}</p>
                <p>{dossier.source ? <Badge tone="blue">{tv(lang, dossier.source)}</Badge> : EMPTY}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{tr.secretariat.colSite}</p>
                <p>{dossier.site ?? EMPTY}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{tr.medecin.colRdv}</p>
                <p className="whitespace-nowrap">{formatDate(dossier.rendez_vous, lang)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{tr.common.doctor}</p>
                <p>{personName(dossier.medecin_assigne, personnelMap)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{tr.common.priority}</p>
                <p><StatusBadge value={dossier.priorite} map={PRIORITE} /></p>
              </div>
              <div>
                <p className="text-xs text-muted">{tr.patientDetail.colIntake}</p>
                {canSecretariat ? (
                  <StatutSelect
                    id={dossier.notion_id}
                    value={dossier.statut_intake}
                    kind="intake"
                    options={["Nouveau", "Rapprochement", "Rédaction", "Revue", "Info manquante", "Prêt", "En attente", "En cours", "Terminé"]}
                  />
                ) : (
                  <StatusBadge value={dossier.statut_intake} map={STATUT_INTAKE} />
                )}
              </div>
              <div>
                <p className="text-xs text-muted">{tr.medecin.colStatusMed}</p>
                {isVerified ? (
                  <StatutSelect
                    id={dossier.notion_id}
                    value={dossier.statut_medecin}
                    kind="medecin"
                    options={["À lire", "En rédaction", "À valider", "En cours", "Terminé"]}
                  />
                ) : (
                  <StatusBadge value={dossier.statut_medecin} map={STATUT_MEDECIN} />
                )}
              </div>
            </div>
            {dossier.resume_motif && <p className="rounded-lg bg-background p-3 text-sm">{dossier.resume_motif}</p>}
            {dossier.infos_manquantes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {dossier.infos_manquantes.map((i) => (
                  <Badge key={i} tone="orange">{i}</Badge>
                ))}
              </div>
            )}
            {parent && (
              <p className="text-xs text-muted">
                {tr.dossierDetail.colParent}{" "}
                <Link href={`/dossiers/${parent.notion_id}`} className="font-medium text-primary hover:underline">
                  {parent.id_dossier} · {tv(lang, parent.motif)}
                </Link>
              </p>
            )}
          </CardBody>
        </Card>

        {/* Compte rendu */}
        <Card>
          <CardHeader icon={<FileText />} title={tr.dossierDetail.crTitle} subtitle={tr.dossierDetail.crSub} />
          <CardBody className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-xs text-muted">{tr.common.status}</p>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge value={dossier.statut_cr} map={STATUT_CR} />
                  <StatutCRSelect dossierId={dossier.notion_id} value={dossier.statut_cr} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">{tr.dossierDetail.crSentOn}</p>
                <p className="whitespace-nowrap">{formatDate(dossier.cr_envoye_le, lang)}</p>
              </div>
              <div className="flex items-end gap-2">
                {dossier.lien_cr && (
                  <a href={dossier.lien_cr} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    {tr.dossierDetail.crLink} <ExternalLink className="size-3" />
                  </a>
                )}
                <LienCRButton dossierId={dossier.notion_id} value={dossier.lien_cr} />
              </div>
            </div>
            <div>
              <OrdonnanceToggle dossierId={dossier.notion_id} value={dossier.ordonnance_remise} />
              <p className="mt-1 text-xs text-muted">{tr.dossierDetail.ordonnanceHint}</p>
            </div>
          </CardBody>
        </Card>

        {/* Examens du patient */}
        <Card>
          <CardHeader
            icon={<Activity />}
            title={tr.dossierDetail.examsTitle}
            subtitle={patient?.nom ?? undefined}
            action={canAssignDevice && patientId ? (
              <NouvelExamenButton
                patients={patients}
                interpretes={medecins}
                unites={appareils}
                defaultPatient={patientId}
                label={tr.dossierDetail.assignDevice}
              />
            ) : undefined}
          />
          {examens.length === 0 ? (
            <Empty message={tr.patientDetail.examsEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.common.reference}</th><th>{tr.common.type}</th><th>{tr.patientDetail.colPose}</th><th>{tr.patientDetail.colReturn}</th><th>{tr.common.status}</th>
              </THead>
              <TBody>
                {examens.map((e) => (
                  <Tr key={e.notion_id}>
                    <td className="font-medium">{e.ref_examen ?? EMPTY}</td>
                    <td className="text-xs">{e.type ?? EMPTY}</td>
                    <td className="whitespace-nowrap">{formatDate(e.date_pose, lang)}</td>
                    <td className="whitespace-nowrap">{formatDate(e.restitution_prevue, lang)}</td>
                    <td><StatusBadge value={e.statut_appareil} map={STATUT_APPAREIL} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Paiements du patient (montants : zone admin/secrétariat) */}
        {can(session, "paiements_all") && (
          <Card>
            <CardHeader icon={<CreditCard />} title={tr.dossierDetail.paymentsTitle} subtitle={patient?.nom ?? undefined} />
            {paiements.length === 0 ? (
              <Empty message={tr.patientDetail.paymentsEmpty} />
            ) : (
              <Table>
                <THead>
                  <th>{tr.secretariat.colService}</th><th className="text-right">{tr.secretariat.colDue}</th><th className="text-right">{tr.secretariat.colRest}</th><th>{tr.common.status}</th>
                </THead>
                <TBody>
                  {paiements.map((p) => (
                    <Tr key={p.notion_id}>
                      <td className="text-xs">{tv(lang, p.type_prestation) ?? EMPTY}</td>
                      <td className="text-right tabular-nums">{formatEuro(p.montant_du, lang)}</td>
                      <td className="text-right tabular-nums font-medium">{formatEuro(p.solde, lang)}</td>
                      <td><StatusBadge value={p.statut_paiement} map={STATUT_PAIEMENT} /></td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        )}

        {/* Dossiers de suite */}
        <Card>
          <CardHeader icon={<GitBranch />} title={tr.dossierDetail.childrenTitle} subtitle={tr.dossierDetail.referralSub} />
          {enfants.length === 0 ? (
            <Empty message={tr.patientDetail.dossiersEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.secretariat.colDossier}</th><th>{tr.secretariat.colMotif}</th><th>{tr.common.doctor}</th><th>{tr.common.status}</th>
              </THead>
              <TBody>
                {enfants.map((d) => (
                  <Tr key={d.notion_id}>
                    <td>
                      <Link href={`/dossiers/${d.notion_id}`} className="font-medium text-primary hover:underline">
                        {d.id_dossier ?? EMPTY}
                      </Link>
                    </td>
                    <td className="text-xs">{tv(lang, d.motif) ?? EMPTY}</td>
                    <td className="text-xs">{personName(d.medecin_assigne, personnelMap)}</td>
                    <td><StatusBadge value={d.statut_intake} map={STATUT_INTAKE} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Tâches liées */}
        <Card>
          <CardHeader
            icon={<ListChecks />}
            title={tr.dossierDetail.tasksTitle}
            action={
              can(session, "taches") ? (
                <NouvelleTacheButton
                  personnel={personnel.filter((p) => p.actif)}
                  patients={patients}
                  defaultPatient={patientId ?? undefined}
                  defaultDossier={dossier.notion_id}
                />
              ) : undefined
            }
          />
          {taches.length === 0 ? (
            <Empty message={tr.patientDetail.tasksEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.secretariat.colTask}</th><th>{tr.common.due}</th><th>{tr.patientDetail.colOwner}</th><th>{tr.common.status}</th>
              </THead>
              <TBody>
                {taches.map((t) => (
                  <Tr key={t.notion_id}>
                    <td className="font-medium">{t.titre}</td>
                    <td className="whitespace-nowrap">{formatDate(t.echeance, lang)}</td>
                    <td className="text-xs">{personName(t.responsable, personnelMap)}</td>
                    <td><StatusBadge value={t.statut} map={STATUT_TACHE} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
