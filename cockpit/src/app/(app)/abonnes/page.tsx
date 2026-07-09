import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { STATUT_ABONNE } from "@/lib/labels";
import { formatDate, EMPTY } from "@/lib/utils";
import { tv } from "@/lib/i18n/dict";
import { Mail } from "lucide-react";
import type { Abonne } from "@/lib/types";

/**
 * La liste de diffusion du cabinet. Les inscriptions arrivent via le bouton
 * « Recevoir les conseils santé » de l'email de remerciement (formulaire n8n
 * → base Notion « Abonnés » → miroir Supabase). Lecture seule côté cockpit.
 */
export default async function AbonnesPage() {
  const session = await getSession();
  if (!can(session, "abonnes")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const supa = await supabaseServer();
  const abonnes = await supa
    .from("abonnes")
    .select("*")
    .order("date_inscription", { ascending: false })
    .then((r) => (r.data ?? []) as Abonne[]);

  const actifs = abonnes.filter((a) => (a.statut ?? "Actif") === "Actif").length;

  return (
    <div className="space-y-4">
      <PageHeader icon={<Mail />} title={tr.abonnes.title} subtitle={tr.abonnes.subtitle} />

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <StatCard label={tr.abonnes.total} value={String(abonnes.length)} />
        <StatCard label={tr.abonnes.active} value={String(actifs)} tone="success" />
      </div>

      <Card>
        <CardHeader icon={<Mail />} title={tr.abonnes.title} />
        {abonnes.length === 0 ? (
          <Empty message={tr.abonnes.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.abonnes.colFirstName}</th><th>{tr.abonnes.colName}</th><th>{tr.abonnes.colEmail}</th><th>{tr.abonnes.colStatus}</th><th>{tr.abonnes.colSource}</th><th>{tr.abonnes.colDate}</th>
            </THead>
            <TBody>
              {abonnes.map((a) => (
                <Tr key={a.notion_id}>
                  <td className="font-medium">{a.prenom || EMPTY}</td>
                  <td>{a.nom || EMPTY}</td>
                  <td>
                    {a.email ? (
                      <a href={`mailto:${a.email}`} className="text-brand underline-offset-2 hover:underline">
                        {a.email}
                      </a>
                    ) : (
                      EMPTY
                    )}
                  </td>
                  <td><StatusBadge value={a.statut ?? "Actif"} map={STATUT_ABONNE} /></td>
                  <td className="text-xs">{a.source ? tv(lang, a.source) : EMPTY}</td>
                  <td className="whitespace-nowrap text-xs">{a.date_inscription ? formatDate(a.date_inscription, lang) : EMPTY}</td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
