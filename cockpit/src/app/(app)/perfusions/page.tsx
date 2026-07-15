import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPatientsIndex, patientName, getPersonnel, getSettingsMap } from "@/lib/data";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatEuro, EMPTY } from "@/lib/utils";
import { tv } from "@/lib/i18n/dict";
import { partMedecin, tauxPartMedecin } from "@/lib/nutrition";
import { NouvellePerfusionButton, ModifierPerfusionButton } from "@/components/interactive";
import { Syringe } from "lucide-react";
import type { Perfusion, Paiement } from "@/lib/types";

/**
 * Nutrition — les séances, et ce qu'il faut reverser.
 *
 * Demande de juil. 2026 : « combien donner au médecin qui a traité le patient, sur ce que
 * le patient a payé ». La part se calcule sur l'ENCAISSÉ du paiement lié (`montant_payé`),
 * pas sur le facturé — cf. src/lib/nutrition.ts. Elle est dérivée à la lecture : changer le
 * taux dans /admin recalcule tout, rien n'est stocké ni à resynchroniser.
 */
export default async function PerfusionsPage() {
  const session = await getSession();
  if (!can(session, "perfusions")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const supa = await supabaseServer();
  const [perfusions, patientsIndex, personnel, settings] = await Promise.all([
    supa.from("perfusions").select("*").order("date_perfusion", { ascending: false }).limit(200)
      .then((r) => (r.data ?? []) as Perfusion[]),
    getPatientsIndex(),
    getPersonnel(),
    getSettingsMap(),
  ]);

  // Les paiements liés portent l'encaissé : c'est la base du calcul.
  const ids = perfusions.map((p) => p.notion_id);
  const paiements =
    ids.length > 0
      ? await supa
          .from("paiements")
          .select("perfusion, montant_du, montant_paye")
          .overlaps("perfusion", ids)
          .then((r) => (r.data ?? []) as Pick<Paiement, "perfusion" | "montant_du" | "montant_paye">[])
      : [];

  // Une séance peut porter plusieurs lignes de paiement (acomptes) : on somme.
  const encaisseParPerfusion = new Map<string, { du: number; paye: number }>();
  for (const pay of paiements) {
    for (const perfId of pay.perfusion ?? []) {
      const s = encaisseParPerfusion.get(perfId) ?? { du: 0, paye: 0 };
      s.du += Number(pay.montant_du ?? 0);
      s.paye += Number(pay.montant_paye ?? 0);
      encaisseParPerfusion.set(perfId, s);
    }
  }

  const taux = tauxPartMedecin(settings.get("nutrition_part_medecin_pct"));
  const nomDe = new Map(personnel.map((p) => [p.notion_id, p.nom ?? "?"]));

  const lignes = perfusions.map((p) => {
    const argent = encaisseParPerfusion.get(p.notion_id) ?? { du: 0, paye: 0 };
    return { p, du: argent.du, ...partMedecin(argent.paye, taux, p.honoraire_ipa) };
  });

  // L'argent ne se montre qu'à qui le gère (règle existante de la page).
  const showMoney = can(session, "finances") || session.member.role === "ipa";

  const totalEncaisse = lignes.reduce((s, l) => s + l.encaisse, 0);
  const totalPart = lignes.reduce((s, l) => s + l.part, 0);

  // À reverser, par praticien : la question posée, dans sa forme utile.
  const parPraticien = new Map<string, number>();
  for (const l of lignes) {
    if (l.part <= 0) continue;
    const key = l.p.praticien?.[0] ?? "__inconnu__";
    parPraticien.set(key, (parPraticien.get(key) ?? 0) + l.part);
  }

  const patientsList = [...patientsIndex.values()]
    .map((p) => ({ notion_id: p.notion_id, nom: p.nom }))
    .sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? ""));
  const praticiens = personnel.filter((p) => p.actif).map((p) => ({ notion_id: p.notion_id, nom: p.nom }));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Syringe />}
        title={tr.perfusions.title}
        subtitle={tr.perfusions.subtitle}
        actions={<NouvellePerfusionButton patients={patientsList} praticiens={praticiens} />}
      />

      {showMoney && lignes.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label={tr.perfusions.statCollected} value={formatEuro(totalEncaisse, lang)} />
            <StatCard label={tr.perfusions.statToPay} value={formatEuro(totalPart, lang)} tone={totalPart > 0 ? "warning" : "default"} />
            <StatCard label={tr.perfusions.statClinic} value={formatEuro(totalEncaisse - totalPart, lang)} tone="success" />
          </div>
          {parPraticien.size > 0 && (
            <Card>
              <CardHeader icon={<Syringe />} title={tr.perfusions.payoutTitle} subtitle={tr.perfusions.payoutSub(taux)} />
              <div className="divide-y divide-border">
                {[...parPraticien.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([pid, montant]) => (
                    <div key={pid} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className={pid === "__inconnu__" ? "text-muted italic" : ""}>
                        {pid === "__inconnu__" ? tr.perfusions.noPractitioner : nomDe.get(pid) ?? "?"}
                      </span>
                      <span className="font-semibold tabular-nums">{formatEuro(montant, lang)}</span>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </>
      )}

      <Card>
        {lignes.length === 0 ? (
          <Empty message={tr.perfusions.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.common.reference}</th>
              <th>{tr.common.patient}</th>
              <th>{tr.common.date}</th>
              <th>{tr.perfusions.practitioner}</th>
              <th>{tr.perfusions.colComponents}</th>
              <th>{tr.perfusions.colBio}</th>
              {showMoney && <th className="text-right">{tr.perfusions.colPaid}</th>}
              {showMoney && <th className="text-right">{tr.perfusions.colShare}</th>}
              <th></th>
            </THead>
            <TBody>
              {lignes.map(({ p, du, encaisse, part, manuel }) => (
                <Tr key={p.notion_id}>
                  <td className="font-medium">{p.ref_perfusion ?? EMPTY}</td>
                  <td>{patientName(p.patient, patientsIndex)}</td>
                  <td className="whitespace-nowrap">{formatDate(p.date_perfusion, lang)}</td>
                  <td className="text-xs">
                    {p.praticien?.[0] ? (
                      nomDe.get(p.praticien[0]) ?? "?"
                    ) : (
                      <Badge tone="orange">{tr.perfusions.noPractitioner}</Badge>
                    )}
                  </td>
                  <td className="max-w-56 truncate text-xs" title={p.composants ?? ""}>{p.composants ?? EMPTY}</td>
                  <td>{p.bilan_bio ? <Badge tone={p.bilan_bio === "Oui" ? "green" : "gray"}>{tv(lang, p.bilan_bio)}</Badge> : EMPTY}</td>
                  {showMoney && (
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {formatEuro(encaisse, lang)}
                      {/* Facturé mais pas encore encaissé : la part est 0, et il faut voir pourquoi. */}
                      {du > encaisse && (
                        <span className="ml-1.5 text-[11px] text-muted">{tr.perfusions.ofBilled(formatEuro(du, lang))}</span>
                      )}
                    </td>
                  )}
                  {showMoney && (
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {part > 0 ? formatEuro(part, lang) : EMPTY}
                      {manuel && <span className="ml-1.5 text-[11px] text-muted">{tr.perfusions.manualFee}</span>}
                    </td>
                  )}
                  <td className="text-right"><ModifierPerfusionButton perfusion={p} praticiens={praticiens} /></td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {showMoney && <p className="text-xs text-muted">{tr.perfusions.shareHint(taux)}</p>}
    </div>
  );
}
