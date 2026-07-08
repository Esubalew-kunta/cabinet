import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnel, getPatientsIndex, patientName, isSoignant } from "@/lib/data";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { PRIORITE, STATUT_TACHE, STATUT_APPAREIL, STATUT_PAIEMENT, STATUT_INTAKE } from "@/lib/labels";
import { formatDate, formatEuro, EMPTY } from "@/lib/utils";
import {
  VerifierDossierButton,
  StatutSelect,
  NouvelleTacheButton,
  NouveauPatientButton,
  NouveauDossierButton,
  EncaisserButton,
  AppareilRenduButton,
} from "@/components/interactive";
import { tv } from "@/lib/i18n/dict";
import { ArrowRight, CalendarClock, ClipboardList, CreditCard, Inbox, ListChecks, TriangleAlert, Watch } from "lucide-react";
import type { Dossier, Tache, Examen, Paiement } from "@/lib/types";

export default async function SecretariatPage() {
  const session = await getSession();
  if (!can(session, "dossiers_all")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const supa = await supabaseServer();
  const today = new Date().toISOString();

  const [aTraiter, rdvAVenir, infosManquantes, taches, appareils, paiements, personnel, patientsIndex] =
    await Promise.all([
      supa
        .from("dossiers")
        .select("*")
        .not("statut_intake", "in", '("Prêt","Terminé","En cours")')
        .not("revue_secretaire", "cs", '{"Vérifié"}')
        .order("created_time", { ascending: false })
        .limit(30)
        .then((r) => (r.data ?? []) as Dossier[]),
      supa
        .from("dossiers")
        .select("*")
        .gte("rendez_vous", today)
        .order("rendez_vous", { ascending: true })
        .limit(15)
        .then((r) => (r.data ?? []) as Dossier[]),
      supa
        .from("dossiers")
        .select("*")
        .neq("infos_manquantes", "{}")
        .not("statut_intake", "in", '("Terminé")')
        .order("created_time", { ascending: false })
        .limit(20)
        .then((r) => (r.data ?? []) as Dossier[]),
      supa
        .from("taches")
        .select("*")
        .neq("statut", "Terminé")
        .order("echeance", { ascending: true, nullsFirst: false })
        .limit(15)
        .then((r) => (r.data ?? []) as Tache[]),
      supa
        .from("examens")
        .select("*")
        .in("statut_appareil", ["Remis", "Bientôt dû", "En retard"])
        .order("restitution_prevue", { ascending: true })
        .limit(20)
        .then((r) => (r.data ?? []) as Examen[]),
      supa
        .from("paiements")
        .select("*")
        .in("statut_paiement", ["Impayé", "Partiel", "Inconnu"])
        .order("echeance", { ascending: true, nullsFirst: false })
        .limit(20)
        .then((r) => (r.data ?? []) as Paiement[]),
      getPersonnel(),
      getPatientsIndex(),
    ]);

  const medecins = personnel.filter(isSoignant);
  const problemes = [
    "Palpitations ou arythmie suspectée", "FA suivi", "Revue Holter", "Suivi hypertension",
    "Cardiologie préventive", "Syncope ou vertige", "Gêne thoracique non urgente", "Suivi post-ablation",
    "Suivi pacemaker ou appareil", "Variabilité tension PGV", "Antécédents familiaux ou dépistage", "Mixte ou à clarifier",
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<ClipboardList />}
        title={tr.secretariat.title}
        subtitle={tr.secretariat.subtitle}
        actions={
          <>
            <NouveauPatientButton medecins={medecins} problemes={problemes} />
            <NouveauDossierButton
              patients={[...patientsIndex.values()]
                .map((p) => ({ notion_id: p.notion_id, nom: p.nom }))
                .sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? ""))}
              medecins={medecins}
            />
            <NouvelleTacheButton personnel={personnel.filter((p) => p.actif)} />
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Inbox />} title={tr.secretariat.inboxTitle} subtitle={tr.secretariat.inboxSub} />
          {aTraiter.length === 0 ? (
            <Empty message={tr.secretariat.inboxEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.secretariat.colDossier}</th><th>{tr.common.patient}</th><th>{tr.secretariat.colMotif}</th><th>{tr.dialogs.source}</th><th>{tr.common.status}</th><th>{tr.common.priority}</th><th></th>
              </THead>
              <TBody>
                {aTraiter.map((d) => (
                  <Tr key={d.notion_id}>
                    <td>
                      <Link href={`/dossiers/${d.notion_id}`} className="font-medium text-primary hover:underline">
                        {d.id_dossier ?? EMPTY}
                      </Link>
                    </td>
                    <td>{patientName(d.patient, patientsIndex)}</td>
                    <td>{tv(lang, d.motif) ?? EMPTY}</td>
                    <td>{d.source ? <Badge tone="blue">{tv(lang, d.source)}</Badge> : <span className="text-xs text-muted">{EMPTY}</span>}</td>
                    <td>
                      <StatutSelectCell d={d} />
                    </td>
                    <td><StatusBadge value={d.priorite} map={PRIORITE} /></td>
                    <td><VerifierDossierButton dossierId={d.notion_id} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader icon={<CalendarClock />} title={tr.secretariat.upcomingTitle} subtitle={tr.secretariat.upcomingSub} />
          {rdvAVenir.length === 0 ? (
            <Empty message={tr.secretariat.upcomingEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.common.date}</th><th>{tr.common.patient}</th><th>{tr.secretariat.colMotif}</th><th>{tr.secretariat.colSite}</th><th>{tr.common.status}</th>
              </THead>
              <TBody>
                {rdvAVenir.map((d) => (
                  <Tr key={d.notion_id}>
                    <td className="whitespace-nowrap font-medium">{formatDate(d.rendez_vous, lang)}</td>
                    <td>
                      <Link href={`/dossiers/${d.notion_id}`} className="text-primary hover:underline">
                        {patientName(d.patient, patientsIndex)}
                      </Link>
                    </td>
                    <td>{tv(lang, d.motif) ?? EMPTY}</td>
                    <td className="text-xs text-muted">{d.site ?? EMPTY}</td>
                    <td><StatusBadge value={d.statut_intake} map={STATUT_INTAKE} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader icon={<TriangleAlert />} title={tr.secretariat.missingTitle} subtitle={tr.secretariat.missingSub} />
          {infosManquantes.length === 0 ? (
            <Empty message={tr.secretariat.missingEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.secretariat.colDossier}</th><th>{tr.common.patient}</th><th>{tr.secretariat.missingCol}</th><th>{tr.common.status}</th>
              </THead>
              <TBody>
                {infosManquantes.map((d) => (
                  <Tr key={d.notion_id}>
                    <td>
                      <Link href={`/dossiers/${d.notion_id}`} className="font-medium text-primary hover:underline">
                        {d.id_dossier ?? EMPTY}
                      </Link>
                    </td>
                    <td>{patientName(d.patient, patientsIndex)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {d.infos_manquantes.map((i) => (
                          <Badge key={i} tone="orange">{i}</Badge>
                        ))}
                      </div>
                    </td>
                    <td><StatusBadge value={d.statut_intake} map={STATUT_INTAKE} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={<ListChecks />}
            title={tr.secretariat.tasksTitle}
            subtitle={tr.secretariat.tasksSub}
            action={
              <Link href="/taches" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {tr.common.seeAll} <ArrowRight className="size-3" />
              </Link>
            }
          />
          {taches.length === 0 ? (
            <Empty message={tr.secretariat.tasksEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.secretariat.colTask}</th><th>{tr.common.due}</th><th>{tr.common.priority}</th><th>{tr.common.status}</th>
              </THead>
              <TBody>
                {taches.map((t) => (
                  <Tr key={t.notion_id}>
                    <td className="font-medium">{t.titre}</td>
                    <td className="whitespace-nowrap">{formatDate(t.echeance, lang)}</td>
                    <td><StatusBadge value={t.priorite} map={PRIORITE} /></td>
                    <td><StatusBadge value={t.statut} map={STATUT_TACHE} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader icon={<Watch />} title={tr.secretariat.devicesTitle} subtitle={tr.secretariat.devicesSub} />
          {appareils.length === 0 ? (
            <Empty message={tr.secretariat.devicesEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.common.reference}</th><th>{tr.common.patient}</th><th>{tr.common.type}</th><th>{tr.secretariat.colReturn}</th><th>{tr.common.status}</th><th></th>
              </THead>
              <TBody>
                {appareils.map((a) => (
                  <Tr key={a.notion_id}>
                    <td className="font-medium">{a.ref_examen ?? EMPTY}</td>
                    <td>{patientName(a.patient, patientsIndex)}</td>
                    <td className="text-xs">{a.type ?? EMPTY}</td>
                    <td className="whitespace-nowrap">{formatDate(a.restitution_prevue, lang)}</td>
                    <td><StatusBadge value={a.statut_appareil} map={STATUT_APPAREIL} /></td>
                    <td><AppareilRenduButton examenId={a.notion_id} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader icon={<CreditCard />} title={tr.secretariat.paymentsTitle} subtitle={tr.secretariat.paymentsSub} />
          {paiements.length === 0 ? (
            <Empty message={tr.secretariat.paymentsEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.common.patient}</th><th>{tr.secretariat.colService}</th><th className="text-right">{tr.secretariat.colDue}</th><th className="text-right">{tr.secretariat.colPaid}</th><th className="text-right">{tr.secretariat.colRest}</th><th>{tr.common.status}</th><th></th>
              </THead>
              <TBody>
                {paiements.map((p) => (
                  <Tr key={p.notion_id}>
                    <td className="font-medium">{patientName(p.patient, patientsIndex)}</td>
                    <td className="text-xs">{p.type_prestation ?? EMPTY}</td>
                    <td className="text-right tabular-nums">{formatEuro(p.montant_du, lang)}</td>
                    <td className="text-right tabular-nums">{formatEuro(p.montant_paye, lang)}</td>
                    <td className="text-right tabular-nums font-medium">{formatEuro(p.solde, lang)}</td>
                    <td><StatusBadge value={p.statut_paiement} map={STATUT_PAIEMENT} /></td>
                    <td>
                      <EncaisserButton paiementId={p.notion_id} montantDu={p.solde} montantPaye={p.montant_paye} />
                    </td>
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

function StatutSelectCell({ d }: { d: Dossier }) {
  return (
    <StatutSelect
      id={d.notion_id}
      value={d.statut_intake}
      kind="intake"
      options={["Nouveau", "Rapprochement", "Rédaction", "Revue", "Info manquante", "Prêt", "En attente", "En cours", "Terminé"]}
    />
  );
}
