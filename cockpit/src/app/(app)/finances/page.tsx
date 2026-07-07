import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnel, getPatientsIndex, patientName, getPersonnelMap, personName } from "@/lib/data";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { STATUT_PAIEMENT, SUIVI_PAIEMENT } from "@/lib/labels";
import { formatEuro, formatDate, cn, EMPTY } from "@/lib/utils";
import { tv } from "@/lib/i18n/dict";
import { NouveauPaiementButton, EncaisserButton } from "@/components/interactive";
import { Bell, CreditCard, Receipt, Stethoscope } from "lucide-react";
import type { Paiement } from "@/lib/types";

function monthRange(mois: string): { start: string; end: string } {
  const [y, m] = mois.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const end = new Date(Date.UTC(y, m, 1)).toISOString();
  return { start, end };
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string }>;
}) {
  const session = await getSession();
  if (!can(session, "finances")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const now = new Date();
  const defaultMois = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const { mois = defaultMois } = await searchParams;
  const { start, end } = monthRange(mois);

  const supa = await supabaseServer();
  const [paiementsMois, impayes, personnel, patientsIndex, personnelMap] = await Promise.all([
    supa.from("paiements").select("*").gte("created_time", start).lt("created_time", end)
      .order("created_time", { ascending: false })
      .then((r) => (r.data ?? []) as Paiement[]),
    supa.from("paiements").select("*").in("statut_paiement", ["Impayé", "Partiel"])
      .order("echeance", { ascending: true, nullsFirst: false }).limit(50)
      .then((r) => (r.data ?? []) as Paiement[]),
    getPersonnel(),
    getPatientsIndex(),
    getPersonnelMap(),
  ]);

  // Résumé par médecin : nb de patients + total facturé (pas de logique de commission, décision réunion)
  const medecins = personnel.filter((p) => p.role === "Médecin");
  type Ligne = { nom: string; patients: Set<string>; facture: number; encaisse: number };
  const parMedecin = new Map<string, Ligne>();
  let sansMedecin: Ligne | null = null;

  for (const p of paiementsMois) {
    const medecinId = p.responsable?.[0];
    let ligne: Ligne;
    if (medecinId && personnelMap.has(medecinId)) {
      if (!parMedecin.has(medecinId)) {
        parMedecin.set(medecinId, { nom: personnelMap.get(medecinId)!, patients: new Set(), facture: 0, encaisse: 0 });
      }
      ligne = parMedecin.get(medecinId)!;
    } else {
      // pas de médecin sur le paiement → rattacher via le médecin assigné du patient
      const patient = p.patient?.[0] ? patientsIndex.get(p.patient[0]) : undefined;
      const viaPatient = patient?.medecin_assigne?.[0];
      if (viaPatient && personnelMap.has(viaPatient)) {
        if (!parMedecin.has(viaPatient)) {
          parMedecin.set(viaPatient, { nom: personnelMap.get(viaPatient)!, patients: new Set(), facture: 0, encaisse: 0 });
        }
        ligne = parMedecin.get(viaPatient)!;
      } else {
        if (!sansMedecin) sansMedecin = { nom: tr.finances.noDoctor, patients: new Set(), facture: 0, encaisse: 0 };
        ligne = sansMedecin;
      }
    }
    for (const pid of p.patient ?? []) ligne.patients.add(pid);
    ligne.facture += Number(p.montant_du ?? 0);
    ligne.encaisse += Number(p.montant_paye ?? 0);
  }

  const lignes = [...parMedecin.values(), ...(sansMedecin ? [sansMedecin] : [])].sort((a, b) => b.facture - a.facture);
  const totalFacture = lignes.reduce((s, l) => s + l.facture, 0);
  const totalEncaisse = lignes.reduce((s, l) => s + l.encaisse, 0);

  // Sélecteur de mois (6 derniers)
  const moisOptions: string[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    moisOptions.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const moisLabel = (m: string) =>
    new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { month: "long", year: "numeric" }).format(
      new Date(m + "-01T12:00:00Z")
    );

  const patientsList = Array.from(patientsIndex.values())
    .filter((p) => p.statut !== "Inactif")
    .map((p) => ({ notion_id: p.notion_id, nom: p.nom }))
    .sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? ""));
  const medecinsActifs = medecins.filter((m) => m.actif);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<CreditCard />}
        title={tr.finances.title}
        subtitle={tr.finances.subtitle}
        actions={<NouveauPaiementButton patients={patientsList} medecins={medecinsActifs} />}
      />

      <div className="flex flex-wrap gap-1.5">
        {moisOptions.map((m) => (
          <Link
            key={m}
            href={`/finances?mois=${m}`}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize shadow-sm transition-colors",
              m === mois ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-muted hover:text-foreground"
            )}
          >
            {moisLabel(m)}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={`${tr.finances.billed} · ${moisLabel(mois)}`} value={formatEuro(totalFacture, lang)} />
        <StatCard label={tr.finances.collected} value={formatEuro(totalEncaisse, lang)} tone="success" />
        <StatCard
          label={tr.finances.remaining}
          value={formatEuro(totalFacture - totalEncaisse, lang)}
          tone={totalFacture - totalEncaisse > 0 ? "danger" : "success"}
        />
      </div>

      <Card>
        <CardHeader icon={<Stethoscope />} title={tr.finances.byDoctorTitle} subtitle={tr.finances.byDoctorSub(moisLabel(mois))} />
        {lignes.length === 0 ? (
          <Empty message={tr.finances.byDoctorEmpty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.common.doctor}</th><th className="text-right">{tr.common.patients}</th><th className="text-right">{tr.finances.colTotalBilled}</th><th className="text-right">{tr.finances.collected}</th><th className="text-right">{tr.secretariat.colRest}</th>
            </THead>
            <TBody>
              {lignes.map((l) => (
                <Tr key={l.nom}>
                  <td className="font-medium">{l.nom}</td>
                  <td className="text-right tabular-nums">{l.patients.size}</td>
                  <td className="text-right tabular-nums font-medium">{formatEuro(l.facture, lang)}</td>
                  <td className="text-right tabular-nums text-success">{formatEuro(l.encaisse, lang)}</td>
                  <td className={cn("text-right tabular-nums", l.facture - l.encaisse > 0 ? "text-danger" : "text-success")}>
                    {formatEuro(l.facture - l.encaisse, lang)}
                  </td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Receipt />} title={tr.finances.monthPaymentsTitle(moisLabel(mois))} subtitle={tr.finances.monthPaymentsSub} />
          {paiementsMois.length === 0 ? (
            <Empty message={tr.finances.monthPaymentsEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.common.patient}</th><th>{tr.finances.colService}</th><th>{tr.common.doctor}</th><th className="text-right">{tr.secretariat.colDue}</th><th className="text-right">{tr.secretariat.colPaid}</th><th>{tr.finances.colMode}</th><th>{tr.common.status}</th>
              </THead>
              <TBody>
                {paiementsMois.map((p) => (
                  <Tr key={p.notion_id}>
                    <td className="font-medium">{patientName(p.patient, patientsIndex)}</td>
                    <td className="text-xs">{tv(lang, p.type_prestation) ?? EMPTY}</td>
                    <td className="text-xs">{personName(p.responsable, personnelMap)}</td>
                    <td className="text-right tabular-nums">{formatEuro(p.montant_du, lang)}</td>
                    <td className="text-right tabular-nums">{formatEuro(p.montant_paye, lang)}</td>
                    <td className="text-xs">{tv(lang, p.mode_paiement) ?? EMPTY}</td>
                    <td><StatusBadge value={p.statut_paiement} map={STATUT_PAIEMENT} /></td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader icon={<Bell />} title={tr.finances.followupTitle} subtitle={tr.finances.followupSub} />
          {impayes.length === 0 ? (
            <Empty message={tr.finances.followupEmpty} />
          ) : (
            <Table>
              <THead>
                <th>{tr.common.patient}</th><th>{tr.common.due}</th><th className="text-right">{tr.secretariat.colRest}</th><th>{tr.finances.colFollowup}</th><th></th>
              </THead>
              <TBody>
                {impayes.map((p) => (
                  <Tr key={p.notion_id}>
                    <td className="font-medium">{patientName(p.patient, patientsIndex)}</td>
                    <td className="whitespace-nowrap">{formatDate(p.echeance, lang)}</td>
                    <td className="text-right tabular-nums font-medium text-danger">{formatEuro(p.solde, lang)}</td>
                    <td><StatusBadge value={p.suivi} map={SUIVI_PAIEMENT} /></td>
                    <td><EncaisserButton paiementId={p.notion_id} montantDu={p.solde} montantPaye={p.montant_paye} /></td>
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
