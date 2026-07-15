import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnel, getPersonnelMap, personName, isSoignant } from "@/lib/data";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import {
  STATUT_PATIENT, NIVEAU_VIGILANCE, STATUT_INTAKE, STATUT_MEDECIN,
  STATUT_APPAREIL, STATUT_PAIEMENT, STATUT_TACHE, PRIORITE,
} from "@/lib/labels";
import { formatDate, formatEuro, EMPTY } from "@/lib/utils";
import { tv } from "@/lib/i18n/dict";
import { statutRetour, pretDeExamen } from "@/lib/appareils";
import { EncaisserButton, ModifierPatientButton, NouveauDossierButton, NouvelleTacheButton } from "@/components/interactive";
import { ExternalLink, ArrowLeft, Phone, Mail, MapPin, Cake, StickyNote, FolderOpen, Activity, CreditCard, Syringe, ListChecks } from "lucide-react";
import type { Patient, Dossier, Examen, Paiement, Perfusion, Tache } from "@/lib/types";

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!can(session, "patients_all") && !can(session, "patients_own")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const { id } = await params;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const supa = await supabaseServer();

  const { data: patientRow } = await supa.from("patients").select("*").eq("notion_id", id).maybeSingle();
  if (!patientRow) notFound();
  const patient = patientRow as Patient;

  const canSeeAllPayments = can(session, "paiements_all");
  const canSeeOwnPayments = can(session, "paiements_own");

  const [dossiers, examens, paiementsFull, paiementsStatus, perfusions, taches, personnelMap] = await Promise.all([
    supa.from("dossiers").select("*").contains("patient", [id]).order("created_time", { ascending: false })
      .then((r) => (r.data ?? []) as Dossier[]),
    supa.from("examens").select("*").contains("patient", [id]).order("date_pose", { ascending: false })
      .then((r) => (r.data ?? []) as Examen[]),
    canSeeAllPayments
      ? supa.from("paiements").select("*").contains("patient", [id]).order("created_time", { ascending: false })
          .then((r) => (r.data ?? []) as Paiement[])
      : Promise.resolve([] as Paiement[]),
    !canSeeAllPayments && canSeeOwnPayments
      ? supa.from("v_paiements_mes_patients").select("*").contains("patient", [id])
          .then((r) => (r.data ?? []) as Paiement[])
      : Promise.resolve([] as Paiement[]),
    can(session, "perfusions")
      ? supa.from("perfusions").select("*").contains("patient", [id]).order("date_perfusion", { ascending: false })
          .then((r) => (r.data ?? []) as Perfusion[])
      : Promise.resolve([] as Perfusion[]),
    supa.from("taches").select("*").contains("patient_lie", [id]).neq("statut", "Terminé")
      .then((r) => (r.data ?? []) as Tache[]),
    getPersonnelMap(),
  ]);
  const personnel = await getPersonnel();
  const medecins = personnel.filter(isSoignant);
  const canManage = can(session, "patients_all");

  const paiements = canSeeAllPayments ? paiementsFull : paiementsStatus;
  const totalDu = paiements.reduce((s, p) => s + Number(p.montant_du ?? 0), 0);
  const totalPaye = paiements.reduce((s, p) => s + Number(p.montant_paye ?? 0), 0);
  const showAmounts = canSeeAllPayments || paiements.some((p) => p.montant_du !== null);

  const contact = [
    { icon: Phone, value: patient.telephone ?? patient.phone ?? patient.phone_1 },
    { icon: Mail, value: patient.email ?? patient.email_1 },
  ].filter((c) => c.value);

  return (
    <div className="space-y-4">
      <Link
        href="/patients"
        className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {tr.patientDetail.back}
      </Link>

      {/* Identité */}
      <Card>
        <CardBody className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-xl font-semibold md:text-2xl">{patient.nom ?? tr.common.nameless}</h1>
              <StatusBadge value={patient.statut} map={STATUT_PATIENT} />
              <StatusBadge value={patient.niveau_vigilance} map={NIVEAU_VIGILANCE} />
            </div>
            {patient.nom_complet && <p className="text-sm text-muted">{patient.nom_complet}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-muted">PSID-{patient.psid ?? "?"}</span>
              {patient.date_naissance && (
                <span className="inline-flex items-center gap-1.5">
                  <Cake className="size-3.5 text-muted" /> {formatDate(patient.date_naissance, lang)}
                </span>
              )}
              {contact.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <c.icon className="size-3.5 text-muted" /> {c.value}
                </span>
              ))}
              {patient.adresse && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-muted" /> {patient.adresse}
                </span>
              )}
            </div>
            {patient.notes_secretariat && (
              <p className="mt-2 inline-flex items-start gap-1.5 rounded-lg bg-background px-2.5 py-1.5 text-xs text-muted">
                <StickyNote className="mt-0.5 size-3.5 shrink-0" /> {patient.notes_secretariat}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {patient.probleme_principal && <Badge tone="blue">{patient.probleme_principal}</Badge>}
              {patient.type_patient && <Badge tone="gray">{patient.type_patient}</Badge>}
              <span className="self-center text-xs text-muted">
                {tr.patientDetail.doctorLabel} <strong>{personName(patient.medecin_assigne, personnelMap)}</strong>
              </span>
            </div>
          </div>
          <div className="space-y-1.5 text-right text-sm">
            <p><span className="text-muted">{tr.patientDetail.lastRdv}</span> {formatDate(patient.dernier_rdv, lang)}</p>
            <p><span className="text-muted">{tr.patientDetail.nextRdv}</span> <strong>{formatDate(patient.prochain_rdv, lang)}</strong></p>
            <div className="flex justify-end gap-2 pt-1">
              {canManage && (
                <>
                  <ModifierPatientButton patient={patient} />
                  <NouveauDossierButton
                    patients={[{ notion_id: patient.notion_id, nom: patient.nom }]}
                    medecins={medecins}
                    defaultPatient={patient.notion_id}
                    variant="secondary"
                  />
                </>
              )}
              {patient.lien_doctolib && (
                <a href={patient.lien_doctolib} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-primary-soft px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary-soft/70">
                  {tr.patientDetail.doctolib} <ExternalLink className="size-3" />
                </a>
              )}
              {patient.lien_dossier_securise && (
                <a href={patient.lien_dossier_securise} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-soft/70">
                  {tr.patientDetail.secureFolder} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Solde */}
      {(canSeeAllPayments || canSeeOwnPayments) && paiements.length > 0 && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-x-8 gap-y-2">
            {showAmounts ? (
              <>
                <p className="text-sm"><span className="text-muted">{tr.patientDetail.billed}</span> <strong className="tabular-nums">{formatEuro(totalDu, lang)}</strong></p>
                <p className="text-sm"><span className="text-muted">{tr.patientDetail.paid}</span> <strong className="tabular-nums text-success">{formatEuro(totalPaye, lang)}</strong></p>
                <p className="text-sm"><span className="text-muted">{tr.patientDetail.rest}</span> <strong className={`tabular-nums ${totalDu - totalPaye > 0 ? "text-danger" : "text-success"}`}>{formatEuro(totalDu - totalPaye, lang)}</strong></p>
              </>
            ) : (
              <p className="text-sm text-muted">{tr.patientDetail.statusOnly}</p>
            )}
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<FolderOpen />} title={tr.patientDetail.dossiersTitle} subtitle={tr.patientDetail.dossiersCount(dossiers.length)} />
          {dossiers.length === 0 ? <Empty message={tr.patientDetail.dossiersEmpty} /> : (
            <Table>
              <THead><th>{tr.secretariat.colDossier}</th><th>{tr.secretariat.colMotif}</th><th>{tr.medecin.colRdv}</th><th>{tr.patientDetail.colIntake}</th><th>{tr.common.doctor}</th></THead>
              <TBody>
                {dossiers.map((d) => (
                  <Tr key={d.notion_id}>
                    <td>
                      <Link href={`/dossiers/${d.notion_id}`} className="font-medium text-primary hover:underline">
                        {d.id_dossier ?? EMPTY}
                      </Link>
                    </td>
                    <td className="text-xs">{tv(lang, d.motif) ?? EMPTY}</td>
                    <td className="whitespace-nowrap">{formatDate(d.rendez_vous, lang)}</td>
                    <td><StatusBadge value={d.statut_intake} map={STATUT_INTAKE} /></td>
                    <td><StatusBadge value={d.statut_medecin} map={STATUT_MEDECIN} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader icon={<Activity />} title={tr.patientDetail.examsTitle} subtitle={tr.patientDetail.examsCount(examens.length)} />
          {examens.length === 0 ? <Empty message={tr.patientDetail.examsEmpty} /> : (
            <Table>
              <THead><th>{tr.common.reference}</th><th>{tr.common.type}</th><th>{tr.patientDetail.colPose}</th><th>{tr.patientDetail.colReturn}</th><th>{tr.common.status}</th></THead>
              <TBody>
                {examens.map((e) => (
                  <Tr key={e.notion_id}>
                    <td className="font-medium">{e.ref_examen ?? EMPTY}</td>
                    <td className="text-xs">{e.type ?? EMPTY}</td>
                    <td className="whitespace-nowrap">{formatDate(e.date_pose, lang)}</td>
                    <td className="whitespace-nowrap">{formatDate(e.restitution_prevue, lang)}</td>
                    {/* Dérivé des dates : la colonne `statut_appareil` ne reçoit plus
                        « Bientôt dû » ni « En retard » (cf. lib/appareils.ts). */}
                    <td><StatusBadge value={statutRetour(pretDeExamen(e, aujourdhui), aujourdhui)} map={STATUT_APPAREIL} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {(canSeeAllPayments || canSeeOwnPayments) && (
          <Card>
            <CardHeader icon={<CreditCard />} title={tr.patientDetail.paymentsTitle} subtitle={tr.patientDetail.paymentsSub} />
            {paiements.length === 0 ? <Empty message={tr.patientDetail.paymentsEmpty} /> : (
              <Table>
                <THead>
                  <th>{tr.common.reference}</th><th>{tr.finances.colService}</th>
                  {showAmounts && <><th className="text-right">{tr.secretariat.colDue}</th><th className="text-right">{tr.secretariat.colPaid}</th><th className="text-right">{tr.secretariat.colRest}</th></>}
                  <th>{tr.patientDetail.colMode}</th><th>{tr.common.status}</th>
                  {canSeeAllPayments && <th></th>}
                </THead>
                <TBody>
                  {paiements.map((p) => (
                    <Tr key={p.notion_id}>
                      <td className="text-xs">{p.ref_paiement ?? EMPTY}</td>
                      <td className="text-xs">{tv(lang, p.type_prestation) ?? EMPTY}</td>
                      {showAmounts && (
                        <>
                          <td className="text-right tabular-nums">{formatEuro(p.montant_du, lang)}</td>
                          <td className="text-right tabular-nums">{formatEuro(p.montant_paye, lang)}</td>
                          <td className="text-right tabular-nums font-medium">{formatEuro(p.solde, lang)}</td>
                        </>
                      )}
                      <td className="text-xs">{tv(lang, p.mode_paiement) ?? EMPTY}</td>
                      <td><StatusBadge value={p.statut_paiement} map={STATUT_PAIEMENT} /></td>
                      {canSeeAllPayments && (
                        <td>
                          {p.statut_paiement !== "Payé" && (
                            <EncaisserButton paiementId={p.notion_id} montantDu={p.solde} montantPaye={p.montant_paye} />
                          )}
                        </td>
                      )}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        )}

        {perfusions.length > 0 && (
          <Card>
            <CardHeader icon={<Syringe />} title={tr.patientDetail.perfusionsTitle} subtitle={tr.patientDetail.perfusionsCount(perfusions.length)} />
            <Table>
              <THead><th>{tr.common.reference}</th><th>{tr.common.date}</th><th>{tr.patientDetail.colComponents}</th><th>{tr.patientDetail.colDuration}</th><th>{tr.patientDetail.colBio}</th></THead>
              <TBody>
                {perfusions.map((pf) => (
                  <Tr key={pf.notion_id}>
                    <td className="font-medium">{pf.ref_perfusion ?? EMPTY}</td>
                    <td className="whitespace-nowrap">{formatDate(pf.date_perfusion, lang)}</td>
                    <td className="text-xs">{pf.composants ?? EMPTY}</td>
                    <td className="text-xs">{pf.duree ?? EMPTY}</td>
                    <td className="text-xs">{tv(lang, pf.bilan_bio) ?? EMPTY}</td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>
        )}

        <Card>
          <CardHeader
            icon={<ListChecks />}
            title={tr.patientDetail.tasksTitle}
            subtitle={tr.patientDetail.tasksSub}
            action={
              canManage ? (
                <NouvelleTacheButton
                  personnel={personnel.filter((p) => p.actif)}
                  patients={[{ notion_id: patient.notion_id, nom: patient.nom }]}
                  defaultPatient={patient.notion_id}
                />
              ) : undefined
            }
          />
          {taches.length === 0 ? <Empty message={tr.patientDetail.tasksEmpty} /> : (
            <Table>
              <THead><th>{tr.taches.colTask}</th><th>{tr.patientDetail.colOwner}</th><th>{tr.common.due}</th><th>{tr.common.priority}</th><th>{tr.common.status}</th></THead>
              <TBody>
                {taches.map((t) => (
                  <Tr key={t.notion_id}>
                    <td className="font-medium">{t.titre}</td>
                    <td className="text-xs">{personName(t.responsable, personnelMap)}</td>
                    <td className="whitespace-nowrap">{formatDate(t.echeance, lang)}</td>
                    <td><StatusBadge value={t.priorite} map={PRIORITE} /></td>
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
