import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPatientsIndex, patientName } from "@/lib/data";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatEuro, EMPTY } from "@/lib/utils";
import { tv } from "@/lib/i18n/dict";
import { Syringe } from "lucide-react";
import type { Perfusion } from "@/lib/types";

export default async function PerfusionsPage() {
  const session = await getSession();
  if (!can(session, "perfusions")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const supa = await supabaseServer();
  const [perfusions, patientsIndex] = await Promise.all([
    supa.from("perfusions").select("*").order("date_perfusion", { ascending: false }).limit(200)
      .then((r) => (r.data ?? []) as Perfusion[]),
    getPatientsIndex(),
  ]);

  const showHonoraires = can(session, "finances") || session.member.role === "ipa";

  return (
    <div className="space-y-4">
      <PageHeader icon={<Syringe />} title={tr.perfusions.title} subtitle={tr.perfusions.subtitle} />
      <Card>
        {perfusions.length === 0 ? (
          <Empty message={tr.perfusions.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.common.reference}</th><th>{tr.common.patient}</th><th>{tr.common.date}</th><th>{tr.perfusions.colComponents}</th><th>{tr.perfusions.colDuration}</th><th>{tr.perfusions.colBio}</th>{showHonoraires && <th className="text-right">{tr.perfusions.colFee}</th>}
            </THead>
            <TBody>
              {perfusions.map((p) => (
                <Tr key={p.notion_id}>
                  <td className="font-medium">{p.ref_perfusion ?? EMPTY}</td>
                  <td>{patientName(p.patient, patientsIndex)}</td>
                  <td className="whitespace-nowrap">{formatDate(p.date_perfusion, lang)}</td>
                  <td className="max-w-56 truncate text-xs" title={p.composants ?? ""}>{p.composants ?? EMPTY}</td>
                  <td className="text-xs">{p.duree ?? EMPTY}</td>
                  <td>{p.bilan_bio ? <Badge tone={p.bilan_bio === "Oui" ? "green" : "gray"}>{tv(lang, p.bilan_bio)}</Badge> : EMPTY}</td>
                  {showHonoraires && <td className="text-right tabular-nums">{formatEuro(p.honoraire_ipa, lang)}</td>}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
